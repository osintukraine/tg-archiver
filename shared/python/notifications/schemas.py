"""Event schemas for notification system."""
from datetime import datetime
from typing import Any, Literal, Optional
from pydantic import BaseModel, Field


PriorityLevel = Literal["urgent", "high", "default", "low", "min"]


class NotificationEvent(BaseModel):
    """Event emitted by services to notification system."""

    service: str = Field(..., description="Service emitting event (listener, processor, api)")
    type: str = Field(..., description="Event type (e.g., message.archived, spam.detected)")
    data: dict[str, Any] = Field(default_factory=dict, description="Event-specific payload")
    priority: PriorityLevel = Field(default="default", description="Notification priority")
    tags: list[str] = Field(default_factory=list, description="Tags for filtering")
    timestamp: str = Field(default_factory=lambda: datetime.utcnow().isoformat(), description="ISO 8601 timestamp")

    class Config:
        json_schema_extra = {
            "example": {
                "service": "listener",
                "type": "channel.discovered",
                "data": {"channel_id": -1001234567890, "username": "UkraineNews"},
                "priority": "default",
                "tags": ["discovery", "folder-sync"],
                "timestamp": "2025-11-06T10:30:00Z"
            }
        }
