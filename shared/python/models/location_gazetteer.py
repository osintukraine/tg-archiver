"""Location gazetteer model for geo lookups."""
from sqlalchemy import Column, Integer, String, Numeric, ARRAY, DateTime, Index, func
from sqlalchemy.dialects.postgresql import TSVECTOR
from .base import Base


class LocationGazetteer(Base):
    """Pre-loaded gazetteer from GeoNames for fast location lookups."""

    __tablename__ = 'location_gazetteer'

    id = Column(Integer, primary_key=True)

    # Names
    name_primary = Column(String(255), nullable=False)
    name_ascii = Column(String(255))
    name_local = Column(String(255))
    aliases = Column(ARRAY(String))

    # Coordinates
    latitude = Column(Numeric(10, 7), nullable=False)
    longitude = Column(Numeric(10, 7), nullable=False)

    # Classification
    feature_class = Column(String(10))
    feature_code = Column(String(20))
    country_code = Column(String(2))
    admin1_code = Column(String(20))
    population = Column(Integer)

    # Search (generated column - read-only)
    name_search = Column(TSVECTOR)

    created_at = Column(DateTime(timezone=True), server_default=func.now())

    def __repr__(self):
        return f"<LocationGazetteer {self.name_primary} ({self.country_code})>"
