"""
Audit Logger - Platform Event Logging

Logs platform events (channel discovery, message archival, etc.) to the admin_actions table.
Used by services to create a unified audit trail visible in /admin/audit.

Usage:
    from audit.audit_logger import AuditLogger

    audit = AuditLogger()
    await audit.log_event(
        session=db,
        action="channel.discovered",
        resource_type="channel",
        resource_id=channel.id,
        details={"name": channel.name, "folder": channel.folder},
        source="listener",
    )
"""

import json
import logging
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


class AuditLogger:
    """
    Logs platform events to admin_actions table for unified audit trail.

    Event Categories:
    - channel.*: Channel discovery, removal, status changes
    - message.*: Message archival stats, processing events
    - system.*: Service startup, errors, configuration changes
    - backfill.*: Historical backfill progress
    """

    def __init__(self, service_name: str = "system"):
        """
        Initialize audit logger.

        Args:
            service_name: Name of the service (listener, processor, api, etc.)
        """
        self.service_name = service_name

    async def log_event(
        self,
        session: AsyncSession,
        action: str,
        resource_type: str,
        resource_id: int = 0,
        details: Optional[dict[str, Any]] = None,
        source: Optional[str] = None,
        commit: bool = True,
    ) -> bool:
        """
        Log a platform event to the audit table.

        Args:
            session: Database session
            action: Event action (e.g., "channel.discovered", "message.batch_archived")
            resource_type: Type of resource (channel, message, system, batch)
            resource_id: ID of the affected resource (0 for system events)
            details: Additional event details as dict
            source: Override service name for this event
            commit: Whether to commit immediately (default True)

        Returns:
            True if logged successfully, False otherwise
        """
        try:
            event_details = details or {}
            event_details["service"] = source or self.service_name
            event_details["timestamp"] = datetime.utcnow().isoformat()

            await session.execute(text("""
                INSERT INTO admin_actions (
                    action, resource_type, resource_id,
                    details, admin_id, admin_email, ip_address, created_at
                )
                VALUES (
                    :action, :resource_type, :resource_id,
                    :details, :admin_id, NULL, :ip_address, NOW()
                )
            """), {
                "action": action,
                "resource_type": resource_type,
                "resource_id": resource_id,
                "details": json.dumps(event_details),
                "admin_id": f"service:{source or self.service_name}",
                "ip_address": "internal",
            })

            if commit:
                await session.commit()

            logger.debug(f"Audit logged: {action} on {resource_type}:{resource_id}")
            return True

        except Exception as e:
            logger.warning(f"Failed to log audit event {action}: {e}")
            return False

    async def log_channel_discovered(
        self,
        session: AsyncSession,
        channel_id: int,
        channel_name: str,
        username: Optional[str],
        folder: str,
        rule: str,
        verified: bool = False,
    ) -> bool:
        """Log channel discovery event."""
        return await self.log_event(
            session=session,
            action="channel.discovered",
            resource_type="channel",
            resource_id=channel_id,
            details={
                "name": channel_name,
                "username": username or "private",
                "folder": folder,
                "rule": rule,
                "verified": verified,
            },
        )

    async def log_channel_removed(
        self,
        session: AsyncSession,
        channel_id: int,
        channel_name: str,
        username: Optional[str],
        folder: str,
    ) -> bool:
        """Log channel removal event."""
        return await self.log_event(
            session=session,
            action="channel.removed",
            resource_type="channel",
            resource_id=channel_id,
            details={
                "name": channel_name,
                "username": username or "private",
                "folder": folder,
            },
        )

    async def log_messages_archived(
        self,
        session: AsyncSession,
        count: int,
        channel_name: Optional[str] = None,
        channel_id: Optional[int] = None,
        batch_id: Optional[str] = None,
    ) -> bool:
        """Log message archival batch event."""
        return await self.log_event(
            session=session,
            action="message.batch_archived",
            resource_type="batch",
            resource_id=0,
            details={
                "count": count,
                "channel_name": channel_name,
                "channel_id": channel_id,
                "batch_id": batch_id,
            },
        )

    async def log_backfill_started(
        self,
        session: AsyncSession,
        channel_id: int,
        channel_name: str,
        from_date: Optional[str] = None,
    ) -> bool:
        """Log backfill start event."""
        return await self.log_event(
            session=session,
            action="backfill.started",
            resource_type="channel",
            resource_id=channel_id,
            details={
                "name": channel_name,
                "from_date": from_date,
            },
        )

    async def log_backfill_completed(
        self,
        session: AsyncSession,
        channel_id: int,
        channel_name: str,
        messages_fetched: int,
        duration_seconds: Optional[float] = None,
    ) -> bool:
        """Log backfill completion event."""
        return await self.log_event(
            session=session,
            action="backfill.completed",
            resource_type="channel",
            resource_id=channel_id,
            details={
                "name": channel_name,
                "messages_fetched": messages_fetched,
                "duration_seconds": duration_seconds,
            },
        )

    async def log_service_started(
        self,
        session: AsyncSession,
        version: Optional[str] = None,
        config: Optional[dict] = None,
    ) -> bool:
        """Log service startup event."""
        return await self.log_event(
            session=session,
            action="system.service_started",
            resource_type="system",
            resource_id=0,
            details={
                "version": version,
                "config": config or {},
            },
        )

    async def log_error(
        self,
        session: AsyncSession,
        error_type: str,
        error_message: str,
        resource_type: str = "system",
        resource_id: int = 0,
        stack_trace: Optional[str] = None,
    ) -> bool:
        """Log error event."""
        return await self.log_event(
            session=session,
            action=f"system.error.{error_type}",
            resource_type=resource_type,
            resource_id=resource_id,
            details={
                "error": error_message,
                "stack_trace": stack_trace,
            },
        )

    async def log_sync_stats(
        self,
        session: AsyncSession,
        added: int,
        updated: int,
        removed: int,
        total_active: int,
    ) -> bool:
        """Log channel sync statistics."""
        return await self.log_event(
            session=session,
            action="channel.sync_completed",
            resource_type="system",
            resource_id=0,
            details={
                "added": added,
                "updated": updated,
                "removed": removed,
                "total_active": total_active,
            },
        )


# Global instance for convenience
_default_logger: Optional[AuditLogger] = None


def get_audit_logger(service_name: str = "system") -> AuditLogger:
    """Get or create the default audit logger instance."""
    global _default_logger
    if _default_logger is None:
        _default_logger = AuditLogger(service_name)
    return _default_logger
