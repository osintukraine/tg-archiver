"""
Channel suggestions: public submit form + admin list/approve/reject.

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

from config.settings import settings

from ..database import get_db
from ..dependencies.auth import AdminUser
from ..utils.promotion import request_promotion
from ..utils.rate_limit import get_client_ip, rate_limit_dependency
from .admin.message_actions import log_admin_action

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
    status: Optional[Literal["pending", "approved", "rejected", "all"]] = None,
    limit: int = Query(50, ge=1, le=200),
    offset: int = Query(0, ge=0),
    db: AsyncSession = Depends(get_db),
):
    # submitted_by_ip is deliberately not returned (submitter privacy)
    flt = None if status in (None, "all") else status
    params = {"status": flt, "limit": limit, "offset": offset}
    where = "WHERE (CAST(:status AS text) IS NULL OR s.status = :status)"
    rows = await db.execute(
        text(f"""
            SELECT s.id, s.channel_link, s.channel_name, s.telegram_username, s.source_origin,
                   s.reason, s.value_description, s.status, s.created_at, s.reviewed_at,
                   s.assigned_folder, s.rejection_reason, u.username AS reviewed_by
            FROM channel_submissions s
            LEFT JOIN users u ON u.id = s.reviewed_by
            {where}
            ORDER BY s.created_at DESC, s.id DESC
            LIMIT :limit OFFSET :offset
        """),
        params,
    )
    total = await db.scalar(
        text(f"SELECT COUNT(*) FROM channel_submissions s {where}"), {"status": flt}
    )
    return {"items": [dict(r._mapping) for r in rows], "total": total}


class ApproveBody(BaseModel):
    folder: Optional[str] = Field(None, max_length=100)


class RejectBody(BaseModel):
    reason: Optional[str] = Field(None, max_length=2000)


def _resolve_username(row) -> str:
    """Public username of a submission, or HTTP 400 (invite links cannot be added by name)."""
    if row.telegram_username:
        return row.telegram_username
    try:
        link = normalize_channel_link(row.channel_link or "")
    except ValueError:
        link = ""
    if not link.startswith("@"):
        raise HTTPException(
            status_code=400,
            detail="Submission has no public username (invite link): join the channel "
            "manually in the archive folder, then reject or ignore this submission",
        )
    return link[1:]


async def _get_pending(db: AsyncSession, submission_id: int):
    row = (
        await db.execute(
            text("""
                SELECT id, channel_link, telegram_username, status
                FROM channel_submissions WHERE id = :id
            """),
            {"id": submission_id},
        )
    ).first()
    if row is None:
        raise HTTPException(status_code=404, detail="Submission not found")
    if row.status != "pending":
        raise HTTPException(status_code=409, detail=f"Submission already {row.status}")
    return row


def _reviewer_id(admin) -> Optional[int]:
    return admin.user_id if isinstance(admin.user_id, int) else None


async def _finish_review(db, submission_id, admin, request, status, folder, reason, action, details):
    """Set the review outcome only if still pending, audit it, commit."""
    done = await db.execute(
        text("""
            UPDATE channel_submissions
            SET status = :status, reviewed_by = :by, reviewed_at = NOW(),
                assigned_folder = :folder, rejection_reason = :reason
            WHERE id = :id AND status = 'pending'
        """),
        {"status": status, "by": _reviewer_id(admin), "folder": folder,
         "reason": reason, "id": submission_id},
    )
    if done.rowcount == 0:
        raise HTTPException(status_code=409, detail="Submission already reviewed")
    await log_admin_action(db, action, submission_id, admin, request, details,
                           resource_type="submission")
    await db.commit()


@router.post("/admin/channel-submissions/{submission_id}/approve")
async def approve_channel_submission(
    submission_id: int,
    admin: AdminUser,
    request: Request,
    body: ApproveBody = ApproveBody(),
    db: AsyncSession = Depends(get_db),
):
    """Add the suggested channel to the archive folder (via the listener), then mark approved."""
    row = await _get_pending(db, submission_id)
    username = _resolve_username(row)
    # raises 504 (listener unavailable) / 400 (listener failure); the row stays pending
    result = await request_promotion(username, body.folder)
    folder = result.get("folder_name") or body.folder or settings.FOLDER_ARCHIVE_ALL_PATTERN
    await _finish_review(db, submission_id, admin, request, "approved", folder, None,
                         "submission.approved", {"username": username, "folder": folder})
    return {"success": True, "folder": folder, "already_existed": result.get("already_existed", False)}


@router.post("/admin/channel-submissions/{submission_id}/reject")
async def reject_channel_submission(
    submission_id: int,
    admin: AdminUser,
    request: Request,
    body: RejectBody = RejectBody(),
    db: AsyncSession = Depends(get_db),
):
    row = await _get_pending(db, submission_id)
    reason = (body.reason or "").strip() or None
    username = row.telegram_username or row.channel_link
    await _finish_review(db, submission_id, admin, request, "rejected", None, reason,
                         "submission.rejected", {"username": username, "reason": reason})
    return {"success": True}
