"""Fixture-tree tests for scripts/env_audit.py: one case per classification."""

import sys
import textwrap
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))
import env_audit  # noqa: E402

COMPOSE = """
services:
  postgres:
    image: postgres:18
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_PASSWORD:-x}
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U ${PG_HC_USER:-a}"]
  api:
    user: "${COMPOSE_ONLY:-1000}"
    environment:
      - READ_ME=${READ_ME:-1}
      - SETTING_USED=${SETTING_USED:-1}
      - SETTING_DEAD=${SETTING_DEAD:-1}
      - NOBODY_READS=${NOBODY_READS:-1}
      - HARDCODED=literal
      - VIA_PROPERTY=${VIA_PROPERTY:-1}
"""

SETTINGS = """
from pydantic_settings import BaseSettings
class Settings(BaseSettings):
    SETTING_USED: int = 1
    SETTING_DEAD: int = 1
    VIA_PROPERTY: int = 1
    NEVER_REFERENCED: int = 1
    @property
    def derived(self):
        return self.VIA_PROPERTY
settings = Settings()
"""

API_SRC = """
import os
from config.settings import settings
a = os.getenv("READ_ME")
b = os.environ.get("MISSING_ONE", "d")
c = settings.SETTING_USED
d = settings.derived
"""

ENV = """
READ_ME=1
SETTING_USED=1
SETTING_DEAD=1
NOBODY_READS=1
NOT_IN_COMPOSE=1
HARDCODED=1
COMPOSE_ONLY=1
PG_HC_USER=1
POSTGRES_PASSWORD=1
VIA_PROPERTY=1
HOST_ONLY=1
"""


def _write(root: Path, rel: str, text: str) -> None:
    p = root / rel
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(textwrap.dedent(text))


@pytest.fixture()
def report(tmp_path: Path):
    _write(tmp_path, "docker-compose.yml", COMPOSE)
    _write(tmp_path, "shared/python/config/settings.py", SETTINGS)
    _write(tmp_path, "services/api/src/main.py", API_SRC)
    _write(tmp_path, "scripts/host.py", 'import os\nos.getenv("HOST_ONLY")\n')
    _write(tmp_path, ".env", ENV)
    result = env_audit.audit(tmp_path, tmp_path / ".env", tmp_path / "docker-compose.yml")
    return {(f["kind"], f["name"]): f for f in result["findings"]}


@pytest.mark.parametrize("kind,name", [
    ("OK", "READ_ME"),              # os.getenv in service src
    ("OK", "SETTING_USED"),         # settings.X
    ("OK", "VIA_PROPERTY"),         # only reachable through a Settings property
    ("OK", "COMPOSE_ONLY"),         # compose-level use (user:)
    ("OK", "PG_HC_USER"),           # healthcheck interpolation
    ("OK", "POSTGRES_PASSWORD"),    # image-level var
    ("OK", "HOST_ONLY"),            # read only by a host script
    ("DEAD_NOT_PASSED", "NOT_IN_COMPOSE"),
    ("DEAD_NOT_PASSED", "HARDCODED"),  # compose sets it literally, .env ignored
    ("DEAD_UNREAD", "NOBODY_READS"),
    ("UNUSED_SETTING", "SETTING_DEAD"),
    ("MISSING_PASSTHROUGH", "MISSING_ONE"),
    ("SETTINGS_DECLARED_UNUSED", "NEVER_REFERENCED"),
    ("SETTINGS_DECLARED_UNUSED", "SETTING_DEAD"),
])
def test_classification(report, kind, name):
    assert (kind, name) in report


def test_hardcoded_hint_and_no_false_missing(report):
    assert "literally" in report[("DEAD_NOT_PASSED", "HARDCODED")]["detail"]
    assert ("MISSING_PASSTHROUGH", "READ_ME") not in report  # passed, so not missing


def test_strict_exit_code_and_no_values(tmp_path, capsys):
    (tmp_path / "docker-compose.yml").write_text("services: {}\n")
    (tmp_path / ".env").write_text("SECRETVAR=hunter2\n")
    argv = ["--root", str(tmp_path), "--env-file", str(tmp_path / ".env")]
    assert env_audit.main(argv) == 0
    assert env_audit.main([*argv, "--strict"]) == 1
    assert "hunter2" not in capsys.readouterr().out
