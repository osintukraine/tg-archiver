"""Tests for message location model."""
import pytest
from sqlalchemy import inspect

def test_message_locations_table_exists(db_session):
    """Verify message_locations table has required columns."""
    inspector = inspect(db_session.bind)
    columns = {c['name'] for c in inspector.get_columns('message_locations')}

    required = {'id', 'message_id', 'location_name', 'latitude', 'longitude',
                'extraction_method', 'confidence'}
    assert required.issubset(columns), f"Missing columns: {required - columns}"

def test_message_location_model_import():
    """Verify model can be imported."""
    from shared.python.models.message_location import MessageLocation
    assert MessageLocation.__tablename__ == 'message_locations'
