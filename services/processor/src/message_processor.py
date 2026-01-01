"""
Message Processor - Simplified Pipeline for tg-archiver (No AI)

Orchestrates message processing pipeline WITHOUT any AI dependencies:
1. Entity extraction (regex-based, fast)
2. Media archival (SHA-256 dedup to MinIO)
3. Translation (if enabled)
4. PostgreSQL persistence

NO LLM classification, NO spam filtering, NO quarantine system.
All messages from monitored channels are archived.

Processing Flow:
┌─────────────┐
│ Raw Message │
└─────┬───────┘
      │
      ▼
┌─────────────┐
│   Extract   │ → Entities (hashtags, mentions, coords, etc.)
│  Entities   │
└─────┬───────┘
      │
      ▼
┌─────────────┐
│ Translation │ → If enabled and non-English
└─────┬───────┘
      │
      ▼
┌─────────────┐
│   Archive   │ → Media (if present, SHA-256 dedup)
│    Media    │
└─────┬───────┘
      │
      ▼
┌─────────────┐
│   Persist   │ → PostgreSQL (messages table)
│  to Database│
└─────┬───────┘
      │
      ▼
┌─────────────┐
│ Acknowledge │ → Remove from Redis queue
└─────────────┘
"""

import logging
import socket
import time
from datetime import datetime
from typing import Optional

from minio import Minio
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient

from config.settings import settings
from models.base import AsyncSessionLocal
from models.message import Message

from .entity_extractor import EntityExtractor
from .media_archiver import MediaArchiver
from .message_router import MessageRouter, ProcessingRule
from .redis_consumer import ProcessedMessage

# Import hash generation
import sys
sys.path.insert(0, '/app/shared/python')
from hashing import MessageHasher
from observability.metrics import (
    record_message_processed,
    record_entity_extraction,
    record_media_archived,
    record_message_archived_timestamp,
    messages_archived_total,
    messages_skipped_total,
    processing_duration_seconds,
)

logger = logging.getLogger(__name__)


class MessageProcessor:
    """
    Simplified message processing pipeline - archives all messages without AI filtering.

    This processor implements a straightforward archival pipeline:
    1. Entity extraction via regex (hashtags, mentions, coordinates)
    2. Optional translation via DeepL
    3. Media archival to MinIO with SHA-256 deduplication
    4. PostgreSQL persistence with full-text search indexing

    No spam filtering, no topic classification, no importance ranking.
    Every message from monitored channels gets archived.
    """

    def __init__(
        self,
        message_router: MessageRouter,
        entity_extractor: EntityExtractor,
        media_archiver: Optional[MediaArchiver] = None,
        telegram_client: Optional[TelegramClient] = None,
        translation_service=None,
        notifier=None,
    ):
        """
        Initialize the message processor with required pipeline components.

        Args:
            message_router: Provides channel routing rules and translation settings.
            entity_extractor: Fast regex-based entity extraction.
            media_archiver: Handles media download and S3 storage with SHA-256 dedup.
            telegram_client: TelegramClient for downloading media files.
            translation_service: DeepL translation service for non-English content.
            notifier: NotificationClient for emitting real-time events.
        """
        self.message_router = message_router
        self.entity_extractor = entity_extractor
        self.media_archiver = media_archiver
        self.telegram_client = telegram_client
        self.translation_service = translation_service
        self.notifier = notifier

        # Statistics
        self.messages_processed = 0
        self.messages_archived = 0
        self.messages_skipped = 0
        self.media_archived = 0

    async def process(self, message: ProcessedMessage) -> bool:
        """
        Process a single message through the archival pipeline.

        All messages are archived (no spam filtering). Pipeline stages:
        1. Phantom message check (skip if no content AND no media)
        2. Entity extraction (regex-based)
        3. Translation (if enabled)
        4. Media archival (if media present)
        5. PostgreSQL persistence

        Args:
            message: ProcessedMessage from Redis stream

        Returns:
            bool: True if processing succeeded, False on exception
        """
        process_start_time = time.time()
        worker_id = socket.gethostname()

        self.messages_processed += 1

        # Log social graph metadata if present
        social_graph_info = []
        if message.author_user_id:
            social_graph_info.append(f"author={message.author_user_id}")
        if message.replied_to_message_id:
            social_graph_info.append(f"reply_to={message.replied_to_message_id}")
        if message.forward_from_channel_id:
            social_graph_info.append(f"forward_from={message.forward_from_channel_id}")
        if message.has_comments:
            social_graph_info.append(f"comments={message.comments_count}")

        social_graph_str = f" [{', '.join(social_graph_info)}]" if social_graph_info else ""

        logger.info(
            f"Processing message: stream_id={message.stream_id}, "
            f"message_id={message.message_id}, channel_id={message.channel_id}, "
            f"grouped_id={message.grouped_id}{social_graph_str}"
        )

        # Filter phantom messages (no content AND no media)
        has_content = message.content and message.content.strip()
        has_media = message.media_type or message.media_url

        if not has_content and not has_media:
            logger.warning(
                f"Skipping phantom message (no content AND no media): "
                f"message_id={message.message_id}, channel_id={message.channel_id}"
            )
            self.messages_skipped += 1
            return True

        try:
            async with AsyncSessionLocal() as session:
                # Step 1: Get channel info
                from sqlalchemy import select
                from models.channel import Channel

                channel_result = await session.execute(
                    select(Channel.username, Channel.rule, Channel.name, Channel.folder)
                    .where(Channel.telegram_id == message.channel_id)
                )
                channel_row = channel_result.first()

                channel_username = channel_row[0] if channel_row else None
                channel_rule = channel_row[1] if channel_row else "archive_all"
                channel_name = channel_row[2] if channel_row else None

                # Step 2: Get routing decision (for translation setting)
                routing_decision = await self.message_router.get_routing_decision(
                    channel_id=message.channel_id,
                    session=session,
                    translation_enabled=settings.TRANSLATION_ENABLED,
                )

                # Step 3: Entity Extraction (fast regex-based)
                entity_extraction_start = time.time()
                entities = self.entity_extractor.extract(message.content, exclude_channel=channel_username)
                entity_count = sum(len(v) if isinstance(v, list) else 1 for v in entities.values())
                entity_extraction_duration = time.time() - entity_extraction_start

                # Record entity extraction metrics
                for entity_type, entity_list in entities.items():
                    count = len(entity_list) if isinstance(entity_list, list) else 1
                    if count > 0:
                        record_entity_extraction(
                            entity_type=entity_type,
                            channel_id=message.channel_id,
                            count=count,
                            duration_seconds=entity_extraction_duration,
                        )

                logger.debug(f"Extracted {entity_count} entities")

                if self.notifier and entity_count > 0:
                    await self.notifier.emit(
                        "entity.extracted",
                        data={
                            "message_id": message.message_id,
                            "channel_id": message.channel_id,
                            "entity_count": entity_count,
                            "entity_types": list(entities.keys()),
                        },
                        priority="min",
                        tags=["entities", "extraction"]
                    )

                # Step 4: Translation (if enabled)
                translated_content = None
                translation_metadata = {}

                if message.content and routing_decision.should_translate:
                    if self.translation_service:
                        try:
                            result = await self.translation_service.translate(
                                text=message.content,
                                target_language="en",
                            )

                            translated_content = result.translated_text
                            translation_metadata = {
                                "provider": result.provider.value,
                                "source_lang": result.source_language,
                                "target_lang": result.target_language,
                                "cost_usd": result.cost_usd,
                            }

                            logger.debug(
                                f"Translated message {message.message_id}: "
                                f"{result.source_language} → {result.target_language}"
                            )

                        except Exception as e:
                            logger.error(f"Translation failed for message {message.message_id}: {e}")

                # Step 5: Media Archival
                media_file_ids = []

                if message.media_type:
                    if self.media_archiver and self.telegram_client:
                        try:
                            if message.album_message_ids and len(message.album_message_ids) > 1:
                                # ALBUM: Download ALL media files
                                logger.info(
                                    f"Archiving album with {len(message.album_message_ids)} media files"
                                )

                                media_file_ids = await self.media_archiver.archive_album(
                                    telegram_client=self.telegram_client,
                                    channel_id=message.channel_id,
                                    message_ids=message.album_message_ids,
                                    session=session,
                                )

                                if media_file_ids:
                                    logger.info(f"Archived album: {len(media_file_ids)} files")

                                    if self.notifier:
                                        await self.notifier.emit(
                                            "media.downloaded",
                                            data={
                                                "message_id": message.message_id,
                                                "channel_id": message.channel_id,
                                                "media_type": message.media_type,
                                                "grouped_id": message.grouped_id,
                                                "media_count": len(media_file_ids),
                                            },
                                            priority="low",
                                            tags=["media", "download", "album"]
                                        )
                            else:
                                # SINGLE MESSAGE: Download one media file
                                telegram_messages = await self.telegram_client.get_messages(
                                    entity=message.channel_id,
                                    ids=[message.message_id]
                                )

                                if telegram_messages and telegram_messages[0]:
                                    media_file_id = await self.media_archiver.archive_media(
                                        telegram_client=self.telegram_client,
                                        telegram_message=telegram_messages[0],
                                        message_db_id=None,
                                        session=session,
                                    )

                                    if media_file_id:
                                        media_file_ids = [media_file_id]
                                        logger.info(f"Archived media (file_id={media_file_id})")

                                        if self.notifier:
                                            await self.notifier.emit(
                                                "media.downloaded",
                                                data={
                                                    "message_id": message.message_id,
                                                    "channel_id": message.channel_id,
                                                    "media_type": message.media_type,
                                                    "media_file_id": media_file_id,
                                                },
                                                priority="low",
                                                tags=["media", "download"]
                                            )

                        except Exception as e:
                            logger.error(f"Failed to archive media: {e}")
                    else:
                        logger.warning("Media archival requested but archiver/client not available")

                # Step 6: Persist to PostgreSQL
                await self._persist_message(
                    message=message,
                    session=session,
                    entities=entities,
                    media_file_ids=media_file_ids,
                    content_translated=translated_content,
                    translation_metadata=translation_metadata,
                )

                self.messages_archived += 1

                # Record archival metrics
                messages_archived_total.labels(
                    channel_id=str(message.channel_id),
                    routing_rule=channel_rule or "archive_all",
                ).inc()

                record_message_archived_timestamp()

                if media_file_ids:
                    self.media_archived += len(media_file_ids)
                    for _ in media_file_ids:
                        record_media_archived(
                            media_type=message.media_type or "unknown",
                            channel_id=message.channel_id,
                            size_bytes=0,
                            deduplicated=False,
                        )

                processing_duration_seconds.labels(stage="total").observe(
                    time.time() - process_start_time
                )

                record_message_processed(
                    worker_id=worker_id,
                    channel_id=message.channel_id,
                    duration_seconds=time.time() - process_start_time,
                )

                logger.info(
                    f"Message archived: message_id={message.message_id}, "
                    f"has_media={bool(media_file_ids)}"
                )

                if self.notifier:
                    await self.notifier.emit(
                        "message.archived",
                        data={
                            "message_id": message.message_id,
                            "channel_id": message.channel_id,
                            "has_media": bool(media_file_ids),
                            "entity_count": len(entities),
                        },
                        priority="default",
                        tags=["archive", "message"]
                    )

                return True

        except Exception as e:
            logger.exception(f"Error processing message {message.stream_id}: {e}")
            return False

    async def _persist_message(
        self,
        message: ProcessedMessage,
        session: AsyncSession,
        entities: Optional[dict] = None,
        media_file_ids: Optional[list[int]] = None,
        content_translated: Optional[str] = None,
        translation_metadata: Optional[dict] = None,
    ) -> None:
        """
        Persist message to PostgreSQL messages table.

        Handles idempotent inserts using ON CONFLICT DO NOTHING.
        """
        # Parse telegram_date
        telegram_date = None
        if message.telegram_date:
            try:
                parsed = datetime.fromisoformat(message.telegram_date)
                telegram_date = parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
            except Exception as e:
                logger.warning(f"Failed to parse telegram_date: {e}")

        # Look up database channel ID
        from sqlalchemy import select
        from models.channel import Channel

        result = await session.execute(
            select(Channel.id, Channel.source_account).where(Channel.telegram_id == message.channel_id)
        )
        row = result.first()

        if not row:
            logger.error(f"Channel {message.channel_id} not found in database")
            raise ValueError(f"Channel {message.channel_id} not found in database")

        db_channel_id = row[0]
        current_source_account = row[1]

        # Update source_account if different
        if current_source_account != message.source_account:
            from sqlalchemy import update
            await session.execute(
                update(Channel)
                .where(Channel.id == db_channel_id)
                .values(source_account=message.source_account)
            )
            logger.info(
                f"Updated channel {message.channel_id} source_account: "
                f"{current_source_account} → {message.source_account}"
            )

        # Parse forward_date if present
        forward_date_parsed = None
        if message.forward_date:
            try:
                parsed = datetime.fromisoformat(message.forward_date)
                forward_date_parsed = parsed.replace(tzinfo=None) if parsed.tzinfo else parsed
            except Exception as e:
                logger.warning(f"Failed to parse forward_date: {e}")

        # Generate authenticity hashes
        content_hash, metadata_hash = MessageHasher.generate_hashes(
            message_id=message.message_id,
            channel_id=message.channel_id,
            telegram_date=telegram_date if telegram_date else datetime.utcnow(),
            content=message.content,
            sender_id=message.author_user_id,
            forward_from_id=message.forward_from_channel_id,
            forward_from_name=None,
            forward_date=forward_date_parsed,
        )

        # Create Message record (simplified - no spam/topic/importance fields)
        db_message = Message(
            message_id=message.message_id,
            channel_id=db_channel_id,
            content=message.content,
            telegram_date=telegram_date,
            views=message.views,
            forwards=message.forwards,
            grouped_id=message.grouped_id,
            # No spam detection fields
            is_spam=False,
            # No LLM Classification fields
            osint_topic=None,
            importance_level=None,
            # Entities
            entities=entities,
            # Media
            media_type=message.media_type,
            media_url_telegram=message.media_url,
            # Translation
            content_translated=content_translated,
            language_detected=translation_metadata.get("source_lang") if translation_metadata else None,
            translation_target=translation_metadata.get("target_lang") if translation_metadata else None,
            translation_provider=translation_metadata.get("provider") if translation_metadata else None,
            translation_cost_usd=translation_metadata.get("cost_usd") if translation_metadata else None,
            translation_timestamp=datetime.utcnow() if content_translated else None,
            # Social graph metadata
            author_user_id=message.author_user_id,
            replied_to_message_id=message.replied_to_message_id,
            forward_from_channel_id=message.forward_from_channel_id,
            forward_from_message_id=message.forward_from_message_id,
            forward_date=forward_date_parsed,
            # Comments/Discussion
            has_comments=message.has_comments,
            comments_count=message.comments_count,
            linked_chat_id=message.linked_chat_id,
            # Message Authenticity Hashing
            content_hash=content_hash,
            metadata_hash=metadata_hash,
            hash_algorithm=MessageHasher.HASH_ALGORITHM,
            hash_generated_at=datetime.utcnow(),
            hash_version=MessageHasher.HASH_VERSION,
            # Backfill tracking
            is_backfilled=message.is_backfilled,
        )

        # Use PostgreSQL ON CONFLICT for idempotent inserts
        from sqlalchemy.dialects.postgresql import insert

        try:
            insert_stmt = insert(Message).values(
                message_id=db_message.message_id,
                channel_id=db_message.channel_id,
                content=db_message.content,
                telegram_date=db_message.telegram_date,
                grouped_id=db_message.grouped_id,
                views=db_message.views,
                forwards=db_message.forwards,
                is_spam=db_message.is_spam,
                osint_topic=db_message.osint_topic,
                importance_level=db_message.importance_level,
                entities=db_message.entities,
                media_type=db_message.media_type,
                media_url_telegram=db_message.media_url_telegram,
                content_translated=db_message.content_translated,
                language_detected=db_message.language_detected,
                translation_target=db_message.translation_target,
                translation_provider=db_message.translation_provider,
                translation_cost_usd=db_message.translation_cost_usd,
                translation_timestamp=db_message.translation_timestamp,
                author_user_id=db_message.author_user_id,
                replied_to_message_id=db_message.replied_to_message_id,
                forward_from_channel_id=db_message.forward_from_channel_id,
                forward_from_message_id=db_message.forward_from_message_id,
                forward_date=db_message.forward_date,
                has_comments=db_message.has_comments,
                comments_count=db_message.comments_count,
                linked_chat_id=db_message.linked_chat_id,
                content_hash=db_message.content_hash,
                metadata_hash=db_message.metadata_hash,
                hash_algorithm=db_message.hash_algorithm,
                hash_generated_at=db_message.hash_generated_at,
                hash_version=db_message.hash_version,
                is_backfilled=db_message.is_backfilled,
            ).on_conflict_do_nothing(
                index_elements=['channel_id', 'message_id']
            ).returning(Message.id)

            result = await session.execute(insert_stmt)
            inserted_id = result.scalar_one_or_none()

            if inserted_id is None:
                # Message already exists
                logger.info(
                    f"Message {message.message_id} already exists (idempotent processing)"
                )
                # Fetch existing message ID for media link
                result = await session.execute(
                    select(Message.id).where(
                        Message.channel_id == db_channel_id,
                        Message.message_id == message.message_id
                    )
                )
                existing_id = result.scalar_one_or_none()
                if existing_id:
                    db_message.id = existing_id
                else:
                    return
            else:
                db_message.id = inserted_id
                logger.debug(f"Message inserted: id={inserted_id}")

            # Create message_media links
            if media_file_ids:
                from models.media import MessageMedia

                if not db_message.id:
                    raise ValueError(f"message_id is None for message {message.message_id}")

                for media_file_id in media_file_ids:
                    media_insert_stmt = insert(MessageMedia).values(
                        message_id=db_message.id,
                        media_id=media_file_id,
                    ).on_conflict_do_nothing(
                        index_elements=['message_id', 'media_id']
                    )
                    await session.execute(media_insert_stmt)

                logger.debug(f"Created {len(media_file_ids)} message_media link(s)")

            await session.commit()

        except Exception as e:
            await session.rollback()
            logger.error(f"Failed to persist message {message.message_id}: {e}")
            raise

    def get_stats(self) -> dict:
        """Get comprehensive processing statistics."""
        archive_rate = (
            self.messages_archived / self.messages_processed
            if self.messages_processed > 0
            else 0.0
        )

        stats = {
            "messages_processed": self.messages_processed,
            "messages_archived": self.messages_archived,
            "messages_skipped": self.messages_skipped,
            "media_archived": self.media_archived,
            "archive_rate": archive_rate,
            "entity_extractor_stats": self.entity_extractor.get_stats(),
            "message_router_cache": self.message_router.get_cache_stats(),
        }

        return stats
