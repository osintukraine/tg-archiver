"""Telegram event cluster models for cluster-based event detection."""
from sqlalchemy import Column, Integer, BigInteger, String, Numeric, Boolean, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import relationship
from pgvector.sqlalchemy import Vector
from .base import Base


class TelegramEventCluster(Base):
    """A cluster of related Telegram messages that may represent an event."""

    __tablename__ = 'telegram_event_clusters'

    id = Column(Integer, primary_key=True)

    # Cluster identification
    cluster_embedding = Column(Vector(384))
    representative_message_id = Column(BigInteger)

    # Detection metadata
    detected_at = Column(DateTime(timezone=True), server_default=func.now())
    trigger_type = Column(String(20))  # velocity_spike, embedding_cluster
    initial_channel_id = Column(Integer, ForeignKey('channels.id'))

    # Validation status
    status = Column(String(20), default='detected')
    tier = Column(String(20))  # rumor, unconfirmed, confirmed, verified

    # Validation results
    channel_count = Column(Integer, default=1)
    ru_affiliated_count = Column(Integer, default=0)
    ua_affiliated_count = Column(Integer, default=0)
    cross_affiliation_met = Column(Boolean, default=False)

    # LLM analysis
    claim_type = Column(String(20))
    claim_confidence = Column(Numeric(4, 3))
    propaganda_signals = Column(JSON)

    # Lifecycle
    promoted_to_event_id = Column(Integer, ForeignKey('events.id'))
    archived_at = Column(DateTime(timezone=True))
    archive_reason = Column(String(50))

    # Timestamps
    last_activity_at = Column(DateTime(timezone=True), server_default=func.now())
    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    messages = relationship("ClusterMessage", back_populates="cluster", cascade="all, delete-orphan")
    promoted_event = relationship("Event", foreign_keys=[promoted_to_event_id])

    def __repr__(self):
        return f"<TelegramEventCluster(id={self.id}, status={self.status}, tier={self.tier})>"


class ClusterMessage(Base):
    """Link between cluster and message with similarity score."""

    __tablename__ = 'cluster_messages'

    cluster_id = Column(Integer, ForeignKey('telegram_event_clusters.id', ondelete='CASCADE'), primary_key=True)
    message_id = Column(BigInteger, ForeignKey('messages.id', ondelete='CASCADE'), primary_key=True)
    similarity = Column(Numeric(4, 3))
    added_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    cluster = relationship("TelegramEventCluster", back_populates="messages")

    def __repr__(self):
        return f"<ClusterMessage(cluster_id={self.cluster_id}, message_id={self.message_id}, similarity={self.similarity})>"
