"""
Shared Telegram client factory for centralized session management.

IMPORTANT: Session Management Architecture (per CLAUDE.md)
=========================================================

This factory is primarily intended for the LISTENER SERVICE, which owns
the primary Telegram session. Other services should NOT create their own
clients but instead receive them from their coordinator:

- Listener Service: Owns primary session, uses this factory
- Enrichment Service: Receives client from main.py coordinator
- Processor Service: Receives client from main.py coordinator (optional)
- API Service: No Telegram client needed (database access only)
- Frontend: No Telegram client needed (HTTP requests only)

Creating multiple Telegram sessions causes:
- Rate limiting issues (Telegram API limits per session)
- Session file conflicts (multiple processes writing same file)
- Wasted resources (each session uses memory + connections)
- Auth complexity (each session needs phone verification)

Usage Example (Listener Service):
    from shared.python.telegram import create_telegram_client

    client = await create_telegram_client(
        session_name="listener",
        api_id=config.telegram_api_id,
        api_hash=config.telegram_api_hash,
        session_path=config.telegram_session_path,
        phone=config.telegram_phone
    )

Usage Example (Enrichment/Processor - receiving client):
    # In main.py
    telegram_client = await initialize_telegram_client(config)

    # Pass to tasks
    task = SocialGraphExtractionTask(telegram_client=telegram_client)
"""

import logging
from pathlib import Path
from typing import Optional

from telethon import TelegramClient

logger = logging.getLogger(__name__)


async def create_telegram_client(
    session_name: str,
    api_id: int,
    api_hash: str,
    session_path: Optional[str] = None,
    connection_retries: int = 5,
    retry_delay: int = 1,
    auto_reconnect: bool = True,
    phone: Optional[str] = None
) -> TelegramClient:
    """
    Create and start a Telegram client with standardized configuration.

    This function creates a TelegramClient with consistent settings across
    the platform. It should primarily be used by the listener service.

    Args:
        session_name: Name for the session file (e.g., "listener")
        api_id: Telegram API ID from my.telegram.org
        api_hash: Telegram API hash from my.telegram.org
        session_path: Directory to store session file. If None, uses current directory.
        connection_retries: Number of connection retry attempts (default: 5)
        retry_delay: Delay between retries in seconds (default: 1)
        auto_reconnect: Whether to auto-reconnect on disconnection (default: True)
        phone: Phone number for authentication (required for first-time setup)

    Returns:
        Started TelegramClient instance ready for use.

    Raises:
        ValueError: If api_id or api_hash are invalid
        ConnectionError: If unable to connect to Telegram servers

    Note:
        Per CLAUDE.md, only the listener service should own a session.
        Other services should receive the client from their coordinator,
        not create their own sessions.
    """
    if not api_id or not api_hash:
        raise ValueError("api_id and api_hash are required")

    # Determine session file location
    if session_path:
        session_file = str(Path(session_path) / session_name)
    else:
        session_file = session_name

    logger.info(f"Creating Telegram client with session: {session_file}")

    client = TelegramClient(
        session=session_file,
        api_id=api_id,
        api_hash=api_hash,
        connection_retries=connection_retries,
        retry_delay=retry_delay,
        auto_reconnect=auto_reconnect
    )

    logger.info("Starting Telegram client connection...")

    await client.start(phone=phone)

    # Log connection status
    me = await client.get_me()
    if me:
        logger.info(f"Connected to Telegram as: {me.first_name} (@{me.username or 'no username'})")
    else:
        logger.warning("Connected to Telegram but unable to get user info")

    return client
