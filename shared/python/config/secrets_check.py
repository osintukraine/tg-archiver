"""Refuse to start with placeholder or missing secrets.

docker-compose.yml already refuses to start when a required secret is unset; this
catches the other way to run with a guessable secret: values copied verbatim from
.env.example (or the old compose defaults). Messages name variables, never values.
"""

import logging
import os
import sys

logger = logging.getLogger(__name__)

# Values shipped in .env.example or as old compose defaults: never acceptable as secrets
PLACEHOLDERS = frozenset({
    "change_me_in_production",
    "change_me_generate_64_char_secret_key_here",
    "minioadmin",
    "minioadmin_change_me_at_least_32_chars",
    "your_api_hash_here",
    "dev-secret-key-change-in-production",
})
MIN_LENGTH = {"JWT_SECRET_KEY": 32}  # HS256 signing key


def weak_secrets(names: list[str]) -> list[str]:
    """Return the names whose value is missing, a known placeholder, or too short."""
    weak = []
    for name in names:
        value = os.environ.get(name, "")
        if not value or value in PLACEHOLDERS or len(value) < MIN_LENGTH.get(name, 1):
            weak.append(name)
    return weak


def require_secrets(service: str, names: list[str]) -> None:
    """Exit the process if any secret is weak; the message names variables only."""
    weak = weak_secrets(names)
    if not weak:
        return
    message = (
        f"{service}: refusing to start, these secrets are missing, placeholders or too short: "
        f"{', '.join(weak)}. Set real values in .env (e.g. `openssl rand -hex 32`); "
        f"JWT_SECRET_KEY needs at least {MIN_LENGTH['JWT_SECRET_KEY']} characters."
    )
    logger.critical(message)
    print(message, file=sys.stderr)
    raise SystemExit(1)
