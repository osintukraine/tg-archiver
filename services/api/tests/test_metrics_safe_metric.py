"""Tests for _safe_metric (Prometheus result sanitising). Self-contained: no shared conftest."""

import os

for _k, _v in {
    "POSTGRES_PASSWORD": "x",
    "REDIS_PASSWORD": "",
    "MINIO_ENDPOINT": "x:1",
    "MINIO_ACCESS_KEY": "x",
    "MINIO_SECRET_KEY": "x",
    "JWT_SECRET_KEY": "x",
}.items():
    os.environ.setdefault(_k, _v)

import math  # noqa: E402

import pytest  # noqa: E402

from src.routers.metrics.services import _safe_metric  # noqa: E402


@pytest.mark.parametrize(
    ("results", "idx", "expected"),
    [
        ([1, 2.5], 0, 1),
        ([1, 2.5], 1, 2.5),
        ([1], 3, None),  # missing index
        ([RuntimeError("prometheus down")], 0, None),
        ([math.nan], 0, None),
        ([math.inf], 0, None),
        ([None], 0, None),
        (["text"], 0, "text"),
    ],
)
def test_safe_metric(results, idx, expected):
    assert _safe_metric(results, idx) == expected
