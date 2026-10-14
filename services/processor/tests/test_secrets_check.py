"""require_secrets: refuse missing, placeholder or short secrets; never print values."""

import pytest

from config.secrets_check import require_secrets, weak_secrets

STRONG = "a" * 40


def test_weak_values_are_reported_by_name(monkeypatch):
    monkeypatch.setenv("POSTGRES_PASSWORD", "change_me_in_production")  # .env.example placeholder
    monkeypatch.setenv("MINIO_SECRET_KEY", "minioadmin")  # old compose default
    monkeypatch.delenv("TELEGRAM_API_HASH", raising=False)  # missing
    monkeypatch.setenv("JWT_SECRET_KEY", "short")  # under 32 chars
    monkeypatch.setenv("JWT_ADMIN_PASSWORD", STRONG)
    names = ["POSTGRES_PASSWORD", "MINIO_SECRET_KEY", "TELEGRAM_API_HASH", "JWT_SECRET_KEY", "JWT_ADMIN_PASSWORD"]
    assert weak_secrets(names) == names[:4]


def test_strong_values_pass(monkeypatch):
    monkeypatch.setenv("JWT_SECRET_KEY", STRONG)
    monkeypatch.setenv("POSTGRES_PASSWORD", "x9")  # no length rule for passwords
    require_secrets("test", ["JWT_SECRET_KEY", "POSTGRES_PASSWORD"])  # does not exit


def test_refusal_exits_and_never_prints_values(monkeypatch, capsys):
    monkeypatch.setenv("JWT_SECRET_KEY", "leaky-but-short")
    with pytest.raises(SystemExit) as exc:
        require_secrets("api", ["JWT_SECRET_KEY"])
    assert exc.value.code == 1
    err = capsys.readouterr().err
    assert "JWT_SECRET_KEY" in err and "leaky-but-short" not in err
