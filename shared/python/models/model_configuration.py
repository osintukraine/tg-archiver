"""
Model Configuration - Runtime model selection stored in database

Allows changing which model is used for each task without
restarting services or editing .env files.

Each task can have multiple model configurations with priority levels
for fallback strategies.
"""

from sqlalchemy import Column, Integer, String, Boolean, JSON, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from .base import Base


class ModelConfiguration(Base):
    """
    Runtime model configuration stored in database.

    This table controls which model is used for each task type.
    Changes take effect immediately without requiring service restarts.

    Example configurations:
    - task='embedding', model_id='all-minilm', priority=1  (primary)
    - task='osint_scoring', model_id='qwen2.5:3b', priority=1  (primary)
    - task='osint_scoring', model_id='llama3.2:3b', priority=2  (fallback)
    - task='osint_scoring', model_id='granite3.0:2b', priority=3  (fast fallback)
    """
    __tablename__ = "model_configuration"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Task type this configuration applies to
    task = Column(
        String(50),
        nullable=False,
        index=True,
        comment="Task type: embedding, osint_scoring, tag_generation, etc."
    )

    # Model to use for this task
    model_id = Column(
        String(100),
        nullable=False,
        comment="Model ID from MODEL_REGISTRY (e.g., 'all-minilm', 'qwen2.5:3b')"
    )

    # Whether this configuration is active
    enabled = Column(
        Boolean,
        default=True,
        nullable=False,
        comment="If false, this configuration is ignored"
    )

    # Priority for fallback (lower number = higher priority)
    priority = Column(
        Integer,
        default=0,
        nullable=False,
        comment="Priority: 1=primary, 2=first fallback, 3=second fallback, etc."
    )

    # Task-specific overrides (JSON)
    override_config = Column(
        JSON,
        comment="Optional overrides: {'temperature': 0.5, 'max_tokens': 100, ...}"
    )

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        onupdate=func.now()
    )

    # Ensure one priority level per task + model_id combination
    __table_args__ = (
        UniqueConstraint('task', 'model_id', name='uq_task_model'),
    )

    def __repr__(self):
        return (
            f"<ModelConfiguration("
            f"task={self.task}, "
            f"model={self.model_id}, "
            f"priority={self.priority}, "
            f"enabled={self.enabled}"
            f")>"
        )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "task": self.task,
            "model_id": self.model_id,
            "enabled": self.enabled,
            "priority": self.priority,
            "override_config": self.override_config,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }
