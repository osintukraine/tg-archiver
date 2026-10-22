"""
MinIO Client Utility

S3 (SeaweedFS) client plus the single place that builds browser-facing media URLs.
"""

import os
import logging
from typing import Optional

from minio import Minio
from minio.error import S3Error

logger = logging.getLogger(__name__)

# ============================================================================
# Configuration
# ============================================================================

# S3 connection (internal Docker network; SeaweedFS S3 gateway by default).
# Same env vars as shared settings; MINIO_URL/MINIO_BUCKET kept as legacy fallbacks.
MINIO_ENDPOINT = (
    os.environ.get("MINIO_ENDPOINT") or os.environ.get("MINIO_URL") or "seaweedfs:8333"
).replace("http://", "").replace("https://", "")
MINIO_ACCESS_KEY = os.environ.get("MINIO_ACCESS_KEY", "minioadmin")
MINIO_SECRET_KEY = os.environ.get("MINIO_SECRET_KEY", "minioadmin")
MINIO_BUCKET = (
    os.environ.get("MINIO_BUCKET_NAME") or os.environ.get("MINIO_BUCKET") or "tg-archive-media"
)
MINIO_SECURE = os.environ.get("MINIO_SECURE", "false").lower() == "true"

# Public origin of the site (Caddy). Media is served at <origin>/<s3 key>, e.g.
# http://localhost/media/ab/cd/hash.jpg; Caddy proxies /media/* to SeaweedFS (anonymous read).
PUBLIC_BASE_URL = (os.environ.get("PUBLIC_BASE_URL") or "http://localhost").rstrip("/")

# Optional direct public S3 endpoint (e.g. http://localhost:8333). When set, media URLs are
# {MINIO_PUBLIC_URL}/{bucket}/{key} instead of Caddy paths. Empty = use Caddy paths.
MINIO_PUBLIC_URL = os.environ.get("MINIO_PUBLIC_URL", "").rstrip("/")


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

def get_media_url(s3_key: str, base_url: Optional[str] = None) -> str:
    """
    Browser-facing URL for a media object.

    Default: absolute Caddy URL ``<origin>/media/ab/cd/hash.jpg``, where origin is ``base_url``
    (pass ``str(request.base_url)`` so it matches the host the client used) or PUBLIC_BASE_URL.
    If MINIO_PUBLIC_URL is set: ``{MINIO_PUBLIC_URL}/{bucket}/{key}``.

    ponytail: no presigned URLs. The bucket is anonymous-read through Caddy, and the old
    option re-wrote the host after signing, which invalidated the SigV4 signature.
    """
    key = s3_key.lstrip("/")
    if MINIO_PUBLIC_URL:
        return f"{MINIO_PUBLIC_URL}/{MINIO_BUCKET}/{key}"
    origin = (base_url or PUBLIC_BASE_URL).rstrip("/")
    return f"{origin}{get_media_path(s3_key)}"


def get_media_path(s3_key: str) -> str:
    """
    Get the site-relative path Caddy routes to SeaweedFS (/media/*).

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
