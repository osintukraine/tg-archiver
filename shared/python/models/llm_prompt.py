"""
LLM Prompt - Runtime-editable prompts stored in database

This model enables prompt management without container rebuilds:
- Edit prompts via NocoDB UI
- Version history with easy rollback
- Performance tracking per prompt
- Template variables for dynamic content

Example usage:
    prompt = await session.execute(
        select(LLMPrompt)
        .where(LLMPrompt.task == 'message_classification')
        .where(LLMPrompt.is_active == True)
        .order_by(LLMPrompt.version.desc())
        .limit(1)
    )
"""

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, UniqueConstraint, ARRAY
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.sql import func
from .base import Base


class LLMPrompt(Base):
    """
    Runtime-editable LLM prompts stored in database.

    Changes take effect immediately without requiring service restarts.
    Managed via NocoDB for easy editing by non-developers.

    Attributes:
        task: Task type (spam_detection, topic_classify, event_extract, etc.)
        name: Human-readable identifier
        prompt_type: 'system' or 'user_template'
        content: The actual prompt text
        version: For rollback capability
        is_active: Whether this prompt is currently used
        model_name: Override model for this prompt (e.g., 'qwen2.5:3b')
        model_parameters: Model parameters like temperature, max_tokens
        task_category: Category (processor, enrichment, event_detection)
        variables: Template variables like {{content}}, {{channel_name}}
        expected_output_format: 'json', 'text', etc.
        usage_count: How many times this prompt has been used
        avg_latency_ms: Average processing time
        error_count: Number of errors encountered
        last_error: Most recent error message
    """
    __tablename__ = "llm_prompts"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Task identification
    task = Column(
        String(50),
        nullable=False,
        index=True,
        comment="Task type: spam_detection, topic_classify, event_extract, etc."
    )
    name = Column(
        String(100),
        nullable=False,
        comment="Human-readable identifier for this prompt"
    )
    prompt_type = Column(
        String(20),
        nullable=False,
        comment="'system' or 'user_template'"
    )
    content = Column(
        Text,
        nullable=False,
        comment="The actual prompt text"
    )

    # Versioning
    version = Column(
        Integer,
        nullable=False,
        default=1,
        comment="Version number for rollback capability"
    )
    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        comment="Whether this prompt is currently used"
    )

    # Model selection (per-prompt override)
    model_name = Column(
        String(100),
        comment="Model to use for this prompt, e.g., 'qwen2.5:3b' - NULL = use global default"
    )
    model_parameters = Column(
        JSONB,
        default={},
        comment="Model parameters like temperature, max_tokens"
    )
    task_category = Column(
        String(50),
        comment="Category: processor, enrichment, event_detection"
    )

    # Metadata
    description = Column(
        Text,
        comment="What this prompt does"
    )
    variables = Column(
        ARRAY(String),
        comment="Template variables like {{content}}, {{channel_name}}"
    )
    expected_output_format = Column(
        Text,
        comment="'json', 'text', description of expected format"
    )

    # Performance tracking
    usage_count = Column(
        Integer,
        default=0,
        comment="How many times this prompt has been used"
    )
    avg_latency_ms = Column(
        Integer,
        comment="Average processing time in milliseconds"
    )
    error_count = Column(
        Integer,
        default=0,
        comment="Number of errors encountered"
    )
    last_error = Column(
        Text,
        comment="Most recent error message"
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
    created_by = Column(
        String(100),
        comment="Who created/modified this prompt"
    )

    # Unique constraint on task + version
    __table_args__ = (
        UniqueConstraint('task', 'version', name='uq_prompt_task_version'),
    )

    def __repr__(self):
        return (
            f"<LLMPrompt("
            f"task={self.task}, "
            f"name={self.name}, "
            f"version={self.version}, "
            f"active={self.is_active}"
            f")>"
        )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "task": self.task,
            "name": self.name,
            "prompt_type": self.prompt_type,
            "content": self.content,
            "version": self.version,
            "is_active": self.is_active,
            "model_name": self.model_name,
            "model_parameters": self.model_parameters or {},
            "task_category": self.task_category,
            "description": self.description,
            "variables": self.variables,
            "expected_output_format": self.expected_output_format,
            "usage_count": self.usage_count,
            "avg_latency_ms": self.avg_latency_ms,
            "error_count": self.error_count,
            "last_error": self.last_error,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
            "created_by": self.created_by,
        }
