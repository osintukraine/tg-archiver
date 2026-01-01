"""
MinIO Client Pool - Dynamic client management for multi-box storage.

Manages MinIO client instances per storage box, caching clients for reuse.
Reads configuration from database storage_boxes table.
"""

import logging
from typing import Dict, Optional
from minio import Minio
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from models.storage import StorageBox

logger = logging.getLogger(__name__)


class MinioClientPool:
    """
    Pool of MinIO clients, one per storage box.

    Lazily creates and caches MinIO clients based on storage_boxes configuration.
    Safe for single-threaded async context (typical for this codebase).

    Note: Not thread-safe. For multi-threaded use, add external synchronization.

    Usage:
        pool = MinioClientPool(access_key="minioadmin", secret_key="minioadmin")
        client = await pool.get_client(session, "russia-1")
        client.fput_object(bucket, key, path)
    """

    def __init__(
        self,
        access_key: str,
        secret_key: str,
        secure: bool = False,
        bucket_name: str = "osint-media",
    ):
        """
        Initialize the pool.

        Args:
            access_key: MinIO access key (same for all boxes)
            secret_key: MinIO secret key (same for all boxes)
            secure: Use HTTPS for MinIO connections
            bucket_name: Default bucket name
        """
        self._access_key = access_key
        self._secret_key = secret_key
        self._secure = secure
        self._bucket_name = bucket_name
        self._clients: Dict[str, Minio] = {}
        self._endpoints: Dict[str, str] = {}  # box_id -> endpoint cache

    async def get_client(
        self,
        session: AsyncSession,
        box_id: str,
    ) -> Minio:
        """
        Get MinIO client for a storage box.

        Creates client on first access, caches for subsequent calls.
        Refreshes endpoint from database if not cached.

        Args:
            session: Database session for loading box config
            box_id: Storage box ID (e.g., "russia-1")

        Returns:
            Minio: Configured MinIO client

        Raises:
            ValueError: If box_id not found in database
        """
        # Return cached client if endpoint unchanged
        if box_id in self._clients:
            cached_endpoint = self._endpoints.get(box_id)
            # Re-fetch endpoint to detect config changes
            current_endpoint = await self._get_endpoint(session, box_id)
            if cached_endpoint == current_endpoint:
                return self._clients[box_id]
            # Endpoint changed, recreate client
            logger.info(f"MinIO endpoint changed for {box_id}: {cached_endpoint} -> {current_endpoint}")

        # Load box config and create client
        endpoint = await self._get_endpoint(session, box_id)
        client = Minio(
            endpoint,
            access_key=self._access_key,
            secret_key=self._secret_key,
            secure=self._secure,
        )

        # Ensure bucket exists
        if not client.bucket_exists(self._bucket_name):
            client.make_bucket(self._bucket_name)
            logger.info(f"Created bucket {self._bucket_name} on {endpoint}")

        # Cache client and endpoint
        self._clients[box_id] = client
        self._endpoints[box_id] = endpoint

        logger.debug(f"Created MinIO client for {box_id} at {endpoint}")
        return client

    async def _get_endpoint(self, session: AsyncSession, box_id: str) -> str:
        """Get MinIO endpoint from database (host:port format for Minio client)."""
        result = await session.execute(
            select(StorageBox).where(StorageBox.id == box_id)
        )
        box = result.scalar_one_or_none()

        if not box:
            raise ValueError(f"Storage box not found: {box_id}")

        # minio_url returns "http://host:port", but Minio client needs "host:port"
        url = box.minio_url
        return url.replace("http://", "").replace("https://", "")

    def invalidate(self, box_id: Optional[str] = None):
        """
        Invalidate cached clients.

        Args:
            box_id: Specific box to invalidate, or None for all
        """
        if box_id:
            self._clients.pop(box_id, None)
            self._endpoints.pop(box_id, None)
        else:
            self._clients.clear()
            self._endpoints.clear()

    @property
    def bucket_name(self) -> str:
        """Default bucket name."""
        return self._bucket_name
