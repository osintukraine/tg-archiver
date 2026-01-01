"""Tests for telegram cluster model."""
import pytest
from sqlalchemy import inspect


def test_telegram_clusters_table_exists(db_session):
    """Verify telegram_event_clusters table has required columns."""
    inspector = inspect(db_session.bind)
    columns = {c['name'] for c in inspector.get_columns('telegram_event_clusters')}

    required = {'id', 'cluster_embedding', 'representative_message_id', 'status',
                'tier', 'channel_count', 'cross_affiliation_met', 'claim_type'}
    assert required.issubset(columns), f"Missing columns: {required - columns}"


def test_cluster_messages_table_exists(db_session):
    """Verify cluster_messages link table exists."""
    inspector = inspect(db_session.bind)
    columns = {c['name'] for c in inspector.get_columns('cluster_messages')}
    assert {'cluster_id', 'message_id', 'similarity'}.issubset(columns), f"Missing columns"


def test_telegram_cluster_model_import():
    """Verify model can be imported."""
    from shared.python.models.telegram_cluster import TelegramEventCluster, ClusterMessage
    assert TelegramEventCluster.__tablename__ == 'telegram_event_clusters'
    assert ClusterMessage.__tablename__ == 'cluster_messages'
