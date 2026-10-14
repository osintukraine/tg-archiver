"""Admin-editable overrides stored in the platform_config table.

Precedence: a row overrides the env/default value ONLY when last_modified_at IS NOT NULL,
i.e. an admin actually saved it. Seeded rows never override .env.

Failures (DB down, unparsable value) log a warning and return None, so callers fall back
to their env/default value; this never raises.
"""

import logging
import time
from typing import Any, Dict, Tuple

from sqlalchemy import text

logger = logging.getLogger(__name__)

# ponytail: per-process dict cache, so an admin edit takes up to CACHE_TTL_SECONDS to apply
# in each service. Ceiling: no cross-process invalidation; add Redis pub/sub if that matters.
CACHE_TTL_SECONDS = 60

_cache: Dict[str, Tuple[float, Any]] = {}

_SQL = text("SELECT value, data_type FROM platform_config WHERE key = :key AND last_modified_at IS NOT NULL")


def parse_value(value: str | None, data_type: str) -> Any:
    """Parse a stored string by data_type; raises ValueError on bad input."""
    if value is None:
        raise ValueError("no value")
    if data_type == "boolean":
        lowered = value.strip().lower()
        if lowered not in ("true", "false"):
            raise ValueError(f"not a boolean: {value!r}")
        return lowered == "true"
    if data_type == "integer":
        return int(value)
    if data_type == "float":
        return float(value)
    return value


async def get_override(key: str, session_factory=None) -> Any:
    """Return the admin-saved value for key, or None to use the env/default."""
    now = time.monotonic()
    hit = _cache.get(key)
    if hit and hit[0] > now:
        return hit[1]
    result = None
    try:
        if session_factory is None:
            from models.base import AsyncSessionLocal as session_factory
        async with session_factory() as session:
            row = (await session.execute(_SQL, {"key": key})).first()
        if row is not None:
            result = parse_value(row[0], row[1])
    except Exception as exc:
        logger.warning("platform_config override %s unavailable, using default: %s", key, exc)
        result = None
    _cache[key] = (now + CACHE_TTL_SECONDS, result)
    return result


def clear_cache() -> None:
    _cache.clear()
