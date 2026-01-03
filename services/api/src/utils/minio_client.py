"""
MinIO Client Utility

Provides secure media URL generation with pre-signed URL support.
All media access should go through this module for consistent security.
"""

import os
import logging
from datetime import timedelta
from functools import lru_cache
from typing import Optional
from urllib.parse import urlparse

from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

# MinIO connection (internal Docker network)
MINIO_ENDPOINT = os.environ.get("MINIO_URL", "minio:9000").replace("http://", "").replace("https://", "")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = os.environ.get("MINIO_BUCKET", "tg-media")
MINIO_SECURE = os.environ.get("MINIO_SECURE", "false").lower() == "true"

# Public URL for browser access (through Caddy proxy or direct)
# In production: https://yourdomain.com (Caddy proxies /media/* to MinIO)
# In development: http://localhost:9000 (direct MinIO access)
MINIO_PUBLIC_URL = os.environ.get("MINIO_PUBLIC_URL", "http://localhost:9000")

# Pre-signed URL settings
PRESIGNED_URL_EXPIRY_HOURS = int(os.environ.get("PRESIGNED_URL_EXPIRY_HOURS", "4"))
USE_PRESIGNED_URLS = os.environ.get("USE_PRESIGNED_URLS", "false").lower() == "true"


# ============================================================================
# Client Management
# ============================================================================

_minio_client: Optional[Minio] = None


def get_minio_client() -> Minio:
    """
    Get or create MinIO client singleton.

    Returns:
        Minio: Configured MinIO client instance

    Note:
        Client is cached for the lifetime of the process.
        Uses internal Docker network endpoint for server-to-server communication.
    """
    global _minio_client

    if _minio_client is None:
        _minio_client = Minio(
            endpoint=MINIO_ENDPOINT,
            access_key=MINIO_ACCESS_KEY,
            secret_key=MINIO_SECRET_KEY,
            secure=MINIO_SECURE,
        )
        logger.info(f"MinIO client initialized: {MINIO_ENDPOINT}, bucket: {MINIO_BUCKET}")

    return _minio_client


def close_minio_client():
    """
    Close MinIO client (for graceful shutdown).

    Note:
        Minio client doesn't have explicit close, but we can reset the singleton.
    """
    global _minio_client
    _minio_client = None


# ============================================================================
# URL Generation
# ============================================================================

def get_media_url(s3_key: str, presigned: bool = None) -> str:
    """
    Get URL for media file access.

    Generates either:
    - Pre-signed URL: Time-limited, authenticated access (more secure)
    - Public URL: Direct access through MINIO_PUBLIC_URL (requires Caddy auth or public bucket)

    Args:
        s3_key: S3 object key (e.g., "media/ab/cd/abcd1234.jpg")
        presigned: Force presigned (True) or public (False) URL.
                   If None, uses USE_PRESIGNED_URLS env var.

    Returns:
        str: Full URL to access the media file

    Example:
        >>> get_media_url("media/ab/cd/abcd1234.jpg")
        "http://localhost:9000/tg-media/media/ab/cd/abcd1234.jpg"

        >>> get_media_url("media/ab/cd/abcd1234.jpg", presigned=True)
        "http://localhost:9000/tg-media/media/ab/cd/abcd1234.jpg?X-Amz-..."
    """
    use_presigned = presigned if presigned is not None else USE_PRESIGNED_URLS

    if use_presigned:
        return get_presigned_url(s3_key)
    else:
        return get_public_url(s3_key)


def get_public_url(s3_key: str) -> str:
    """
    Get public (non-presigned) URL for media file.

    Uses MINIO_PUBLIC_URL which should be:
    - Development: http://localhost:9000 (direct MinIO access)
    - Production: https://yourdomain.com (Caddy proxies /media/* to MinIO)

    Args:
        s3_key: S3 object key

    Returns:
        str: Public URL to access the media file
    """
    # Normalize key (remove leading slash if present)
    key = s3_key.lstrip("/")

    return f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/{key}"


def get_presigned_url(
    s3_key: str,
    expiry_hours: int = None,
) -> str:
    """
    Generate pre-signed URL for secure, time-limited media access.

    Pre-signed URLs include a cryptographic signature that:
    - Expires after specified duration
    - Cannot be tampered with
    - Doesn't require MinIO to be publicly accessible

    Args:
        s3_key: S3 object key
        expiry_hours: URL expiry in hours (default: PRESIGNED_URL_EXPIRY_HOURS env var)

    Returns:
        str: Pre-signed URL with authentication query parameters

    Raises:
        S3Error: If object doesn't exist or client error occurs

    Note:
        Pre-signed URLs are generated using the MINIO_PUBLIC_URL as the base,
        so they work from browsers accessing through the public endpoint.
    """
    expiry = expiry_hours or PRESIGNED_URL_EXPIRY_HOURS
    key = s3_key.lstrip("/")

    client = get_minio_client()

    try:
        # Generate presigned URL
        presigned = client.presigned_get_object(
            bucket_name=MINIO_BUCKET,
            object_name=key,
            expires=timedelta(hours=expiry),
        )

        # The presigned URL uses the endpoint from client config (internal Docker URL)
        # We need to replace it with the public URL for browser access
        parsed = urlparse(presigned)
        public_parsed = urlparse(MINIO_PUBLIC_URL)

        # Replace scheme and netloc with public URL
        public_presigned = presigned.replace(
            f"{parsed.scheme}://{parsed.netloc}",
            f"{public_parsed.scheme}://{public_parsed.netloc}"
        )

        logger.debug(f"Generated presigned URL for {key}, expires in {expiry}h")
        return public_presigned

    except S3Error as e:
        logger.error(f"Failed to generate presigned URL for {key}: {e}")
        # Fall back to public URL if presigned fails
        return get_public_url(s3_key)


def get_media_path(s3_key: str) -> str:
    """
    Get media path for Caddy proxy routing.

    Returns relative path that Caddy can proxy to MinIO.
    Used when MINIO_PUBLIC_URL is the main domain (e.g., https://yourdomain.com)
    and Caddy handles /media/* routes.

    Args:
        s3_key: S3 object key

    Returns:
        str: Relative path like "/media/ab/cd/abcd1234.jpg"
    """
    key = s3_key.lstrip("/")

    # If key already starts with "media/", use as-is
    if key.startswith("media/"):
        return f"/{key}"

    return f"/media/{key}"


# ============================================================================
# Bucket Operations
# ============================================================================

def ensure_bucket_exists():
    """
    Ensure the media bucket exists, create if not.

    Called during application startup to verify storage is ready.
    """
    client = get_minio_client()

    try:
        if not client.bucket_exists(MINIO_BUCKET):
            client.make_bucket(MINIO_BUCKET)
            logger.info(f"Created bucket: {MINIO_BUCKET}")
        else:
            logger.info(f"Bucket exists: {MINIO_BUCKET}")
    except S3Error as e:
        logger.error(f"Bucket operation failed: {e}")
        raise


def check_object_exists(s3_key: str) -> bool:
    """
    Check if an object exists in the bucket.

    Args:
        s3_key: S3 object key

    Returns:
        bool: True if object exists, False otherwise
    """
    client = get_minio_client()
    key = s3_key.lstrip("/")

    try:
        client.stat_object(MINIO_BUCKET, key)
        return True
    except S3Error:
        return False
