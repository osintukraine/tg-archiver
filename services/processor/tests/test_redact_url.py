"""Connection URLs must never be logged with their password."""

import pytest

from observability import redact_url


@pytest.mark.parametrize(
    ("url", "expected"),
    [
        ("redis://:s3cret@redis:6379/0", "redis://:***@redis:6379/0"),
        ("postgresql://archiver:pw@postgres:5432/tg_archiver", "postgresql://archiver:***@postgres:5432/tg_archiver"),
        ("redis://redis:6379/0", "redis://redis:6379/0"),  # no password: unchanged
        ("redis://:@redis:6379", "redis://:***@redis:6379"),  # empty password still masked
    ],
)
def test_redact_url(url, expected):
    assert redact_url(url) == expected
