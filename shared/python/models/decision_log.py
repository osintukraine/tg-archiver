"""
DecisionLog Model - Full audit trail for all LLM/processing decisions.

Every classification decision is logged here with:
- Full chain-of-thought analysis from LLM
- Decision details as JSONB
- Verification status for quality assurance
- Reprocessing support for continuous improvement

This enables:
- Auditing why any message was classified a certain way
- Automated verification rules
- Human review workflows
- Reprocessing with improved prompts
"""

from datetime import datetime
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    ForeignKey,
    Integer,
    String,
    Text,
    BigInteger,
    func,
)
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base


class DecisionLog(Base):
    """
    Audit log for LLM/processing decisions.

    Each row represents a single classification decision made by the platform.
    Supports verification workflow and reprocessing chain.

    Attributes:
        message_id: Reference to the classified message
        decision_type: Type of decision (spam_filter, osint_score, etc.)
        decision_value: JSONB with full decision details
        llm_analysis: Chain-of-thought reasoning from <analysis> tags
        verification_status: Workflow state for quality assurance
    """

    __tablename__ = "decision_log"

    # Primary key
    id: Mapped[int] = mapped_column(Integer, primary_key=True)

    # What was decided on
    message_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("messages.id", ondelete="CASCADE"), nullable=True, index=True
    )
    channel_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("channels.id", ondelete="SET NULL"), nullable=True, index=True
    )
    telegram_message_id: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)

    # Decision metadata
    decision_type: Mapped[str] = mapped_column(String(50), nullable=False, index=True)
    decision_value: Mapped[dict[str, Any]] = mapped_column(JSONB, nullable=False)
    decision_source: Mapped[str] = mapped_column(String(50), nullable=False)

    # Full reasoning (the gold!)
    llm_analysis: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_reasoning: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    llm_raw_response: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Performance metrics
    processing_time_ms: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    model_used: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    prompt_version: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    tokens_used: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Classifier mode tracking (unified vs modular A/B comparison)
    classifier_mode: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    per_task_latency: Mapped[Optional[dict[str, Any]]] = mapped_column(JSONB, nullable=True)
    early_exit: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)

    # Verification workflow
    verification_status: Mapped[str] = mapped_column(
        String(20), default="unverified", nullable=False, index=True
    )
    verified_by: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    verified_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    verification_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Reprocessing chain
    reprocess_requested: Mapped[bool] = mapped_column(Boolean, default=False, nullable=False)
    reprocess_priority: Mapped[int] = mapped_column(Integer, default=0, nullable=False)
    reprocessed_at: Mapped[Optional[datetime]] = mapped_column(DateTime(timezone=True), nullable=True)
    previous_decision_id: Mapped[Optional[int]] = mapped_column(
        Integer, ForeignKey("decision_log.id"), nullable=True
    )

    # Lifecycle
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False, index=True
    )

    # Relationships
    message: Mapped[Optional["Message"]] = relationship("Message", back_populates="decisions")
    channel: Mapped[Optional["Channel"]] = relationship("Channel")
    previous_decision: Mapped[Optional["DecisionLog"]] = relationship(
        "DecisionLog", remote_side=[id], backref="reprocessed_decisions"
    )

    def __repr__(self) -> str:
        return (
            f"<DecisionLog(id={self.id}, message_id={self.message_id}, "
            f"type={self.decision_type}, source={self.decision_source}, "
            f"status={self.verification_status})>"
        )

    @property
    def is_verified(self) -> bool:
        """Check if this decision has been verified."""
        return self.verification_status in ("verified_correct", "verified_incorrect")

    @property
    def needs_review(self) -> bool:
        """Check if this decision needs human review."""
        return self.verification_status == "flagged" or self.reprocess_requested

    def to_dict(self) -> dict[str, Any]:
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "message_id": self.message_id,
            "channel_id": self.channel_id,
            "telegram_message_id": self.telegram_message_id,
            "decision_type": self.decision_type,
            "decision_value": self.decision_value,
            "decision_source": self.decision_source,
            "llm_analysis": self.llm_analysis,
            "llm_reasoning": self.llm_reasoning,
            "processing_time_ms": self.processing_time_ms,
            "model_used": self.model_used,
            "prompt_version": self.prompt_version,
            "classifier_mode": self.classifier_mode,
            "per_task_latency": self.per_task_latency,
            "early_exit": self.early_exit,
            "verification_status": self.verification_status,
            "verified_by": self.verified_by,
            "verified_at": self.verified_at.isoformat() if self.verified_at else None,
            "reprocess_requested": self.reprocess_requested,
            "created_at": self.created_at.isoformat() if self.created_at else None,
        }
