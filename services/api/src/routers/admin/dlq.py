"""
Admin Dead Letter Queue Router

Visibility and recovery for messages the processor gave up on:
- List DLQ entries (newest first, cursor paginated)
- Replay an entry back onto its original stream
- Discard an entry

State-changing endpoints are covered by the CSRF middleware.
"""

import json
import logging
from typing import Any, Dict, List, Optional

import redis.asyncio as redis
from fastapi import APIRouter, HTTPException, Path, Query
from pydantic import BaseModel
from redis.exceptions import RedisError

from config.settings import settings

from ...dependencies import AdminUser

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/admin/dlq", tags=["Admin - DLQ"])

DLQ_STREAM_KEY = "telegram:messages:dlq"  # must match processor DeadLetterQueue
REPLAYABLE_STREAMS = frozenset(
    {"telegram:messages:realtime", "telegram:messages:backfill", "telegram:messages"}
)
STREAM_ID_PATTERN = r"^\d+(-\d+)?$"

_redis_client: Optional[redis.Redis] = None


def get_dlq_redis() -> redis.Redis:
    """Lazily create the shared Redis client (override in tests)."""
    global _redis_client
    if _redis_client is None:
        _redis_client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    return _redis_client


class DLQItem(BaseModel):
    """One dead-lettered message (summary)."""
    dlq_id: str
    original_stream: Optional[str] = None
    original_stream_id: Optional[str] = None
    error: Optional[str] = None
    retry_count: int = 0
    failed_at: Optional[str] = None
    message_id: Optional[int] = None
    channel_id: Optional[int] = None
    replayable: bool = False


class DLQListResponse(BaseModel):
    """Response for DLQ listing."""
    total: int
    items: List[DLQItem]
    next_before: Optional[str] = None


def _parse_json(raw: Optional[str]) -> Optional[Dict[str, Any]]:
    """Parse a JSON object field; None if missing or not a JSON object."""
    if not raw:
        return None
    try:
        parsed = json.loads(raw)
    except json.JSONDecodeError:
        return None
    return parsed if isinstance(parsed, dict) else None


def _to_int(value: Any) -> Optional[int]:
    try:
        return int(value)
    except (TypeError, ValueError):
        return None


def _to_item(dlq_id: str, data: Dict[str, str]) -> DLQItem:
    """Build a list item from a raw DLQ entry; tolerant of the old format."""
    # new format: full "fields"; old format: partial "message_data"
    payload = _parse_json(data.get("fields")) or _parse_json(data.get("message_data")) or {}
    return DLQItem(
        dlq_id=dlq_id,
        original_stream=data.get("original_stream"),
        original_stream_id=data.get("original_stream_id"),
        error=data.get("error"),
        retry_count=_to_int(data.get("retry_count")) or 0,
        failed_at=data.get("failed_at"),
        message_id=_to_int(payload.get("message_id")),
        channel_id=_to_int(payload.get("channel_id")),
        replayable="fields" in data and data.get("original_stream") in REPLAYABLE_STREAMS,
    )


@router.get("", response_model=DLQListResponse)
async def list_dlq(
    admin: AdminUser,
    limit: int = Query(50, ge=1, le=500),
    before: Optional[str] = Query(
        None, pattern=STREAM_ID_PATTERN, description="Return entries older than this DLQ id"
    ),
) -> DLQListResponse:
    """List dead-lettered messages, newest first. Pass `next_before` as `before` for the next page."""
    r = get_dlq_redis()
    try:
        total = await r.xlen(DLQ_STREAM_KEY)
        entries = await r.xrevrange(
            DLQ_STREAM_KEY, max=f"({before}" if before else "+", min="-", count=limit
        )
    except RedisError as e:
        logger.error(f"DLQ list failed: {e}")
        raise HTTPException(status_code=503, detail="Redis unavailable")

    items = [_to_item(dlq_id, data) for dlq_id, data in entries]
    next_before = items[-1].dlq_id if len(items) == limit else None
    return DLQListResponse(total=total, items=items, next_before=next_before)


async def _get_entry(r: redis.Redis, dlq_id: str) -> Dict[str, str]:
    """Fetch one DLQ entry or raise 404."""
    try:
        entries = await r.xrange(DLQ_STREAM_KEY, min=dlq_id, max=dlq_id, count=1)
    except RedisError as e:
        logger.error(f"DLQ read failed: {e}")
        raise HTTPException(status_code=503, detail="Redis unavailable")
    if not entries:
        raise HTTPException(status_code=404, detail="DLQ entry not found")
    return entries[0][1]


@router.post("/{dlq_id}/replay")
async def replay_dlq_entry(
    admin: AdminUser,
    dlq_id: str = Path(..., pattern=STREAM_ID_PATTERN),
) -> Dict[str, Any]:
    """Re-queue the stored original payload on its original stream, then remove the DLQ entry."""
    r = get_dlq_redis()
    data = await _get_entry(r, dlq_id)

    fields = _parse_json(data.get("fields"))
    if fields is None:
        raise HTTPException(
            status_code=409, detail="Entry is in the old format (no stored payload) and cannot be replayed"
        )
    stream = data.get("original_stream")
    if stream not in REPLAYABLE_STREAMS:
        raise HTTPException(status_code=422, detail=f"Unknown original stream: {stream!r}")

    try:
        new_id = await r.xadd(stream, {k: str(v) for k, v in fields.items()})
        await r.xdel(DLQ_STREAM_KEY, dlq_id)
    except RedisError as e:
        logger.error(f"DLQ replay failed for {dlq_id}: {e}")
        raise HTTPException(status_code=503, detail="Redis unavailable")

    logger.info(f"DLQ entry {dlq_id} replayed to {stream} as {new_id} by {admin.username}")
    return {"replayed": True, "dlq_id": dlq_id, "stream": stream, "new_stream_id": new_id}


@router.delete("/{dlq_id}")
async def discard_dlq_entry(
    admin: AdminUser,
    dlq_id: str = Path(..., pattern=STREAM_ID_PATTERN),
) -> Dict[str, Any]:
    """Discard a DLQ entry permanently."""
    r = get_dlq_redis()
    await _get_entry(r, dlq_id)
    try:
        await r.xdel(DLQ_STREAM_KEY, dlq_id)
    except RedisError as e:
        logger.error(f"DLQ discard failed for {dlq_id}: {e}")
        raise HTTPException(status_code=503, detail="Redis unavailable")

    logger.info(f"DLQ entry {dlq_id} discarded by {admin.username}")
    return {"deleted": True, "dlq_id": dlq_id}
