"""Ask the listener to add a channel to a Telegram folder (channels:promote)."""

import asyncio
import json
import uuid
from typing import Any, Dict, List, Optional, cast

import redis.asyncio as redis
from fastapi import HTTPException

from config.settings import settings

PROMOTE_TIMEOUT_SECONDS = 30


async def request_promotion(
    username: str, folder: Optional[str], discovered_channel_id: Optional[int] = None
) -> Dict[str, Any]:
    """Send channels:promote and wait for channels:promote:result.

    Returns the listener's result dict on success. Raises HTTPException 504 on
    timeout (listener down) and 400 when the listener reports failure.
    """
    request_id = str(uuid.uuid4())
    fields = {
        "request_id": request_id,
        "username": username,
        "folder": folder or settings.FOLDER_ARCHIVE_ALL_PATTERN,
    }
    if discovered_channel_id is not None:
        fields["discovered_channel_id"] = str(discovered_channel_id)

    client = redis.from_url(settings.REDIS_URL, decode_responses=True)
    try:
        await client.xadd("channels:promote", fields)
        for _ in range(PROMOTE_TIMEOUT_SECONDS):
            await asyncio.sleep(1)
            # redis-py types xread as int | list; with no BLOCK it always returns a list
            streams = cast(List[Any], await client.xread({"channels:promote:result": "0"}, count=100))
            for _stream, entries in streams:
                for _id, data in entries:
                    if data.get("request_id") == request_id:
                        result = json.loads(data.get("result", "{}"))
                        if not result.get("success"):
                            raise HTTPException(
                                status_code=400,
                                detail=f"Promotion failed: {result.get('error', 'Unknown error')}",
                            )
                        return result
        raise HTTPException(
            status_code=504,
            detail="Promotion request timed out - listener may be unavailable",
        )
    finally:
        await client.aclose()
