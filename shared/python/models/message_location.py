"""Message location model for geocoded message coordinates."""
from sqlalchemy import Column, Integer, BigInteger, String, Numeric, DateTime, ForeignKey, UniqueConstraint, SmallInteger, CheckConstraint, func
from sqlalchemy.orm import relationship
from .base import Base


class MessageLocation(Base):
    """Extracted location coordinates for a message.

    Supports multiple locations per message for trajectory tracking.
    Location types:
    - 'point': Single location mention (default)
    - 'origin': Start point of trajectory ("from X")
    - 'destination': End point of trajectory ("to Y")
    - 'waypoint': Intermediate point in trajectory
    """

    __tablename__ = 'message_locations'
    __table_args__ = (
        UniqueConstraint('message_id', 'sequence_order', name='uq_message_location_sequence'),
        CheckConstraint(
            "location_type IN ('point', 'origin', 'destination', 'waypoint')",
            name='message_locations_location_type_check'
        ),
    )

    id = Column(Integer, primary_key=True)
    message_id = Column(BigInteger, ForeignKey('messages.id', ondelete='CASCADE'))

    # Extracted location
    location_name = Column(String(255))
    latitude = Column(Numeric(10, 7))
    longitude = Column(Numeric(10, 7))

    # Extraction metadata
    extraction_method = Column(String(20))  # gazetteer, llm_relative, nominatim, manual
    confidence = Column(Numeric(4, 3))
    gazetteer_id = Column(Integer, ForeignKey('location_gazetteer.id'))

    # For relative locations
    relative_to = Column(String(255))
    offset_km = Column(Numeric(6, 2))
    direction = Column(String(20))

    # Multi-location & trajectory support
    sequence_order = Column(SmallInteger, default=0)  # Order in message (0=first, 1=second, etc.)
    location_type = Column(String(20), default='point')  # point, origin, destination, waypoint

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    # Relationships
    gazetteer_entry = relationship("LocationGazetteer", lazy="joined")

    def __repr__(self):
        type_str = f"[{self.location_type}]" if self.location_type != 'point' else ""
        return f"<MessageLocation {self.location_name} ({self.latitude}, {self.longitude}) {type_str}>"

    @property
    def is_trajectory_point(self) -> bool:
        """Check if this location is part of a trajectory."""
        return self.location_type in ('origin', 'destination', 'waypoint')
