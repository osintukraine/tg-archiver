"""
Feed Subscription Service - Track and manage feed subscriptions.

Provides:
- Upsert subscriptions on RSS endpoint access
- Summary generation from params
- CRUD operations for user management
- URL regeneration with token signing
"""

import hashlib
import json
import logging
from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID

from sqlalchemy import delete, select, update
from sqlalchemy.dialects.postgresql import insert
from sqlalchemy.ext.asyncio import AsyncSession

from models.feed_subscription import FeedSubscription

logger = logging.getLogger(__name__)


class FeedSubscriptionService:
    """Service for feed subscription operations."""

    def __init__(self, db: AsyncSession):
        self.db = db

    @staticmethod
    def hash_params(params: dict) -> bytes:
        """Generate SHA-256 hash of normalized params for deduplication."""
        clean_params = {k: v for k, v in params.items() if v is not None}
        normalized = json.dumps(clean_params, sort_keys=True, default=str)
        return hashlib.sha256(normalized.encode()).digest()

    @staticmethod
    def build_summary(feed_type: str, params: dict) -> str:
        """Generate human-readable summary from params."""
        parts = []

        if feed_type == "channel":
            username = params.get("username", "unknown")
            parts.append(f"@{username}")
        elif feed_type == "topic":
            topic = params.get("topic", "unknown")
            parts.append(f"Topic: {topic.title()}")
        else:  # search
            if params.get("q"):
                q = params["q"]
                if len(q) > 30:
                    q = q[:27] + "..."
                parts.append(f'"{q}"')
            if params.get("topic"):
                parts.append(params["topic"].title())
            if params.get("channel_username"):
                parts.append(f"@{params['channel_username']}")
            if params.get("channel_folder"):
                folder = params["channel_folder"].replace("%", "")
                parts.append(f"Folder: {folder}")
            if params.get("days"):
                parts.append(f"Last {params['days']}d")
            if params.get("has_media") is True:
                parts.append("With media")
            if params.get("language"):
                parts.append(params["language"].upper())

        if params.get("format") and params["format"] != "rss":
            parts.append(params["format"].upper())

        return " | ".join(parts) if parts else feed_type.title()

    async def upsert_subscription(
        self,
        token_id: UUID,
        feed_type: str,
        params: dict,
    ) -> UUID:
        """Record or update a feed subscription on access."""
        params_hash = self.hash_params(params)
        summary = self.build_summary(feed_type, params)
        clean_params = {k: v for k, v in params.items() if v is not None}

        stmt = insert(FeedSubscription).values(
            feed_token_id=token_id,
            params_hash=params_hash,
            feed_type=feed_type,
            feed_params=clean_params,
            summary=summary,
        )

        stmt = stmt.on_conflict_do_update(
            constraint="feed_subscriptions_token_params_unique",
            set_={
                "last_accessed_at": datetime.now(timezone.utc),
                "access_count": FeedSubscription.access_count + 1,
            },
        ).returning(FeedSubscription.id)

        result = await self.db.execute(stmt)
        subscription_id = result.scalar_one()
        await self.db.commit()

        logger.debug(f"Upserted subscription {subscription_id} for token {token_id}")
        return subscription_id

    async def get_token_subscriptions(
        self,
        token_id: UUID,
        include_archived: bool = False,
    ) -> list[FeedSubscription]:
        """Get subscriptions for a token."""
        query = select(FeedSubscription).where(
            FeedSubscription.feed_token_id == token_id
        )

        if not include_archived:
            cutoff = datetime.now(timezone.utc) - timedelta(days=30)
            query = query.where(FeedSubscription.last_accessed_at >= cutoff)

        query = query.order_by(FeedSubscription.last_accessed_at.desc())
        result = await self.db.execute(query)
        return list(result.scalars().all())

    async def get_subscription_by_id(
        self,
        subscription_id: UUID,
        token_id: UUID,
    ) -> Optional[FeedSubscription]:
        """Get a specific subscription, verifying token ownership."""
        result = await self.db.execute(
            select(FeedSubscription).where(
                FeedSubscription.id == subscription_id,
                FeedSubscription.feed_token_id == token_id,
            )
        )
        return result.scalar_one_or_none()

    async def update_label(
        self,
        subscription_id: UUID,
        token_id: UUID,
        label: Optional[str],
    ) -> bool:
        """Update subscription label."""
        result = await self.db.execute(
            update(FeedSubscription)
            .where(
                FeedSubscription.id == subscription_id,
                FeedSubscription.feed_token_id == token_id,
            )
            .values(label=label)
            .returning(FeedSubscription.id)
        )
        updated = result.scalar_one_or_none()
        if updated:
            await self.db.commit()
            return True
        return False

    async def delete_subscription(
        self,
        subscription_id: UUID,
        token_id: UUID,
    ) -> bool:
        """Delete a subscription."""
        result = await self.db.execute(
            delete(FeedSubscription)
            .where(
                FeedSubscription.id == subscription_id,
                FeedSubscription.feed_token_id == token_id,
            )
            .returning(FeedSubscription.id)
        )
        deleted = result.scalar_one_or_none()
        if deleted:
            await self.db.commit()
            return True
        return False

    async def cleanup_stale_subscriptions(self, days: int = 60) -> int:
        """Delete subscriptions inactive for more than N days."""
        cutoff = datetime.now(timezone.utc) - timedelta(days=days)
        result = await self.db.execute(
            delete(FeedSubscription)
            .where(FeedSubscription.last_accessed_at < cutoff)
            .returning(FeedSubscription.id)
        )
        deleted = result.fetchall()
        await self.db.commit()
        if deleted:
            logger.info(f"Cleaned up {len(deleted)} stale subscriptions ({days}+ days inactive)")
        return len(deleted)
