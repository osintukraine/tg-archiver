"""
Folder Manager - Telegram folder creation and channel assignment.

Manages Telegram folders (DialogFilters) via Telethon API:
1. Creates new folders if they don't exist
2. Adds channels to folders after successful join
3. Syncs folder structure with monitored_folders table

Uses UpdateDialogFilterRequest to create/modify folders.
"""

import logging
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from telethon import TelegramClient
from telethon.errors import FloodWaitError
from telethon.tl.functions.messages import GetDialogFiltersRequest, UpdateDialogFilterRequest
from telethon.tl.types import (
    DialogFilter,
    InputPeerChannel,
    TextWithEntities,
)
from telethon.utils import get_peer_id

from models import MonitoredFolder

logger = logging.getLogger(__name__)


class FolderManager:
    """
    Manages Telegram folders and channel assignments.

    Creates folders dynamically during import and adds channels to them
    after successful joins.
    """

    # Maximum channels per folder (Telegram limit)
    MAX_CHANNELS_PER_FOLDER = 100

    def __init__(self, client: TelegramClient, db_session_factory):
        """
        Initialize FolderManager.

        Args:
            client: Authenticated Telethon client
            db_session_factory: Async session factory for database access
        """
        self.client = client
        self.db_session_factory = db_session_factory
        self._folder_cache: dict[str, int] = {}  # folder_name -> folder_id

    async def get_or_create_folder(
        self, folder_name: str, rule: str = "archive_all"
    ) -> Optional[int]:
        """
        Get existing folder ID or create a new folder.

        Args:
            folder_name: Name of the Telegram folder
            rule: Archival rule for the folder (archive_all, selective_archive)

        Returns:
            Telegram folder ID, or None if creation failed
        """
        # Check cache first
        if folder_name in self._folder_cache:
            return self._folder_cache[folder_name]

        try:
            # Get current folders from Telegram
            result = await self.client(GetDialogFiltersRequest())
            filters = result.filters

            # Find existing folder by name
            for folder in filters:
                if not hasattr(folder, "title"):
                    continue

                title_text = folder.title.text if hasattr(folder.title, "text") else str(folder.title)
                if title_text.lower() == folder_name.lower():
                    folder_id = folder.id
                    self._folder_cache[folder_name] = folder_id
                    logger.info(f"Found existing folder: {folder_name} (ID: {folder_id})")

                    # Update monitored_folders in database
                    await self._update_monitored_folder(
                        folder_name, folder_id, rule
                    )

                    return folder_id

            # Folder doesn't exist - create it
            return await self._create_folder(folder_name, rule, filters)

        except FloodWaitError as e:
            logger.warning(f"FloodWait getting folders - waiting {e.seconds}s")
            raise
        except Exception as e:
            logger.error(f"Error getting/creating folder '{folder_name}': {e}")
            return None

    async def _create_folder(
        self, folder_name: str, rule: str, existing_filters: list
    ) -> Optional[int]:
        """
        Create a new Telegram folder.

        Args:
            folder_name: Name for the new folder
            rule: Archival rule
            existing_filters: Current list of DialogFilters

        Returns:
            New folder ID, or None if creation failed
        """
        try:
            # Find next available folder ID
            # Telegram uses IDs 2-255 for custom folders (1 is reserved)
            used_ids = {f.id for f in existing_filters if hasattr(f, "id")}
            new_id = None
            for candidate in range(2, 256):
                if candidate not in used_ids:
                    new_id = candidate
                    break

            if new_id is None:
                logger.error("No available folder IDs (max 255 folders reached)")
                return None

            # Create the folder with TextWithEntities for title
            new_folder = DialogFilter(
                id=new_id,
                title=TextWithEntities(text=folder_name, entities=[]),
                pinned_peers=[],
                include_peers=[],
                exclude_peers=[],
                contacts=False,
                non_contacts=False,
                groups=False,
                broadcasts=True,  # Channels are broadcasts
                bots=False,
                exclude_muted=False,
                exclude_read=False,
                exclude_archived=False,
            )

            await self.client(UpdateDialogFilterRequest(id=new_id, filter=new_folder))

            logger.info(f"Created new folder: {folder_name} (ID: {new_id})")

            # Cache and save to database
            self._folder_cache[folder_name] = new_id
            await self._update_monitored_folder(folder_name, new_id, rule)

            return new_id

        except FloodWaitError:
            raise
        except Exception as e:
            logger.error(f"Error creating folder '{folder_name}': {e}")
            return None

    async def add_channel_to_folder(
        self, folder_id: int, channel_id: int, access_hash: int
    ) -> bool:
        """
        Add a channel to a Telegram folder.

        Args:
            folder_id: Telegram folder ID
            channel_id: Telegram channel ID
            access_hash: Channel access hash

        Returns:
            True if successful, False otherwise
        """
        try:
            # Get current folder state
            result = await self.client(GetDialogFiltersRequest())
            folder = None

            for f in result.filters:
                if hasattr(f, "id") and f.id == folder_id:
                    folder = f
                    break

            if not folder:
                logger.error(f"Folder ID {folder_id} not found")
                return False

            # Check if channel already in folder
            channel_peer = InputPeerChannel(channel_id=channel_id, access_hash=access_hash)
            peer_id = get_peer_id(channel_peer)

            existing_peer_ids = [get_peer_id(p) for p in folder.include_peers]
            if peer_id in existing_peer_ids:
                logger.debug(f"Channel {channel_id} already in folder {folder_id}")
                return True

            # Check folder capacity
            if len(folder.include_peers) >= self.MAX_CHANNELS_PER_FOLDER:
                logger.warning(
                    f"Folder {folder_id} at capacity ({self.MAX_CHANNELS_PER_FOLDER} channels)"
                )
                return False

            # Add channel to folder
            new_include_peers = list(folder.include_peers) + [channel_peer]

            updated_folder = DialogFilter(
                id=folder.id,
                title=folder.title,
                pinned_peers=list(folder.pinned_peers),
                include_peers=new_include_peers,
                exclude_peers=list(folder.exclude_peers),
                contacts=folder.contacts,
                non_contacts=folder.non_contacts,
                groups=folder.groups,
                broadcasts=folder.broadcasts,
                bots=folder.bots,
                exclude_muted=folder.exclude_muted,
                exclude_read=folder.exclude_read,
                exclude_archived=folder.exclude_archived,
            )

            await self.client(
                UpdateDialogFilterRequest(id=folder.id, filter=updated_folder)
            )

            logger.info(f"Added channel {channel_id} to folder {folder_id}")
            return True

        except FloodWaitError:
            raise
        except Exception as e:
            logger.error(f"Error adding channel to folder: {e}")
            return False

    async def _update_monitored_folder(
        self, folder_name: str, telegram_folder_id: int, rule: str
    ) -> None:
        """
        Update or create MonitoredFolder record in database.

        Args:
            folder_name: Folder name
            telegram_folder_id: Telegram's folder ID
            rule: Archival rule
        """
        async with self.db_session_factory() as session:
            result = await session.execute(
                select(MonitoredFolder).where(
                    MonitoredFolder.folder_name == folder_name
                )
            )
            existing = result.scalar_one_or_none()

            if existing:
                await session.execute(
                    update(MonitoredFolder)
                    .where(MonitoredFolder.id == existing.id)
                    .values(
                        telegram_folder_id=telegram_folder_id,
                        rule=rule,
                        active=True,
                    )
                )
            else:
                new_folder = MonitoredFolder(
                    folder_name=folder_name,
                    telegram_folder_id=telegram_folder_id,
                    rule=rule,
                    active=True,
                    created_via="import",
                )
                session.add(new_folder)

            await session.commit()
            logger.debug(f"Updated monitored_folders: {folder_name}")

    async def refresh_cache(self) -> None:
        """Refresh the folder cache from Telegram."""
        self._folder_cache.clear()

        try:
            result = await self.client(GetDialogFiltersRequest())
            for folder in result.filters:
                if hasattr(folder, "title") and hasattr(folder, "id"):
                    title_text = folder.title.text if hasattr(folder.title, "text") else str(folder.title)
                    self._folder_cache[title_text] = folder.id

            logger.debug(f"Refreshed folder cache: {len(self._folder_cache)} folders")
        except Exception as e:
            logger.error(f"Error refreshing folder cache: {e}")
