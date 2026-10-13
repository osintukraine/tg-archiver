"""
Channel suggestions: public submit form + admin listing.

POST /api/channel-submissions is public (CSRF-protected, rate limited per IP,
optional Cloudflare Turnstile when TURNSTILE_SECRET_KEY is set).
"""

import logging
import os
import re
from typing import Literal, Optional

import httpx
from fastapi import APIRouter, Depends, HTTPException, Query, Request
from pydantic import BaseModel, Field, field_validator
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db
from ..dependencies.auth import AdminUser
from ..utils.rate_limit import get_client_ip, rate_limit_dependency

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api", tags=["channel-submissions"])

TURNSTILE_VERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify"
SUBMISSIONS_PER_MINUTE = 3

# @name, name, t.me/name, telegram.me/name -> "@name"; +code or t.me/+code -> "+code"
_USERNAME_RE = re.compile(r"^[A-Za-z][A-Za-z0-9_]{4,31}$")
_INVITE_RE = re.compile(r"^\+[A-Za-z0-9_-]{8,64}$")
_URL_PREFIX_RE = re.compile(r"^(?:https?://)?(?:t|telegram)\.me/", re.IGNORECASE)
_IP_RE = re.compile(r"[0-9a-fA-F:.]+")


def normalize_channel_link(raw: str) -> str:
    """Return '@username' or '+invite', or raise ValueError."""
    link = _URL_PREFIX_RE.sub("", raw.strip(), count=1)
    if _INVITE_RE.match(link):
        return link
    name = link.removeprefix("@")
    if _USERNAME_RE.match(name):
        return f"@{name}"
    raise ValueError("Invalid channel link. Use @username, t.me/username or +invite_code")


class ChannelSubmissionCreate(BaseModel):
    channel_link: str = Field(..., max_length=255)
    channel_name: str = Field(..., min_length=1, max_length=255)
    source_origin: Literal["ua", "ru", "unknown"] = "unknown"
    reason: str = Field(..., min_length=10, max_length=2000)
    value_description: Optional[str] = Field(None, max_length=2000)
    turnstile_token: str = Field("", max_length=4096)

    @field_validator("channel_link")
    @classmethod
    def _link(cls, v: str) -> str:
        return normalize_channel_link(v)

    @field_validator("channel_name", "reason")
    @classmethod
    def _not_blank(cls, v: str) -> str:
        v = v.strip()
        if not v:
            raise ValueError("must not be blank")
        return v


async def _verify_turnstile(token: str, ip: str) -> None:
    """No-op unless TURNSTILE_SECRET_KEY is set; then the token must verify."""
    secret = os.getenv("TURNSTILE_SECRET_KEY", "")
    if not secret:
        return
    if not token:
        raise HTTPException(status_code=400, detail="Captcha required")
    try:
        async with httpx.AsyncClient(timeout=5.0) as client:
            r = await client.post(
                TURNSTILE_VERIFY_URL,
                data={"secret": secret, "response": token, "remoteip": ip},
            )
        ok = r.status_code == 200 and r.json().get("success") is True
    except (httpx.HTTPError, ValueError) as e:
        logger.warning("Turnstile verification failed to run: %s", e)
        raise HTTPException(status_code=503, detail="Captcha verification unavailable")
    if not ok:
        raise HTTPException(status_code=400, detail="Captcha verification failed")


@router.post(
    "/channel-submissions",
    status_code=201,
    dependencies=[Depends(rate_limit_dependency(SUBMISSIONS_PER_MINUTE, "channel_submissions"))],
)
async def create_channel_submission(
    body: ChannelSubmissionCreate,
    request: Request,
    db: AsyncSession = Depends(get_db),
):
    ip = get_client_ip(request)
    await _verify_turnstile(body.turnstile_token, ip)

    user_id = getattr(getattr(request.state, "user", None), "user_id", None)
    submitted_by = user_id if isinstance(user_id, int) and user_id > 0 else None
    username = body.channel_link[1:] if body.channel_link.startswith("@") else None

    row = await db.execute(
        text("""
            INSERT INTO channel_submissions
                (channel_link, channel_name, telegram_username, source_origin, reason,
                 value_description, submitted_by, submitted_by_ip)
            VALUES (:link, :name, :username, :origin, :reason, :value, :by,
                    CAST(:ip AS inet))
            RETURNING id
        """),
        {
            "link": body.channel_link,
            "name": body.channel_name,
            "username": username,
            "origin": body.source_origin,
            "reason": body.reason,
            "value": body.value_description,
            "by": submitted_by,
            "ip": ip if _IP_RE.fullmatch(ip or "") else None,
        },
    )
    submission_id = row.scalar_one()
    await db.commit()
    return {"id": submission_id, "status": "pending"}


@router.get("/admin/channel-submissions")
async def list_channel_submissions(
    admin: AdminUser,
    status: Optional[Literal["pending", "accepted", "rejected"]] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    rows = await db.execute(
        text("""
            SELECT id, channel_link, channel_name, source_origin, reason, value_description,
                   status, host(submitted_by_ip) AS submitted_by_ip, created_at
            FROM channel_submissions
            WHERE (CAST(:status AS text) IS NULL OR status = :status)
            ORDER BY created_at DESC, id DESC
            LIMIT :limit OFFSET :offset
        """),
        {"status": status, "limit": limit, "offset": offset},
    )
    return {"items": [dict(r._mapping) for r in rows]}
