"""Tests for location gazetteer model."""
import pytest
from sqlalchemy import inspect


def test_location_gazetteer_table_exists(db_session):
    """Verify location_gazetteer table has required columns."""
    inspector = inspect(db_session.bind)
    columns = {c['name'] for c in inspector.get_columns('location_gazetteer')}

    required = {'id', 'name_primary', 'name_ascii', 'name_local', 'aliases',
                'latitude', 'longitude', 'feature_class', 'country_code', 'population'}
    assert required.issubset(columns), f"Missing columns: {required - columns}"


def test_location_gazetteer_model_import():
    """Verify model can be imported."""
    from shared.python.models.location_gazetteer import LocationGazetteer
    assert LocationGazetteer.__tablename__ == 'location_gazetteer'
