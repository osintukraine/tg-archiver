#!/usr/bin/env python3
"""
Telegram Authentication Script for tg-archiver

Creates Telegram session files for listener and processor services.
Supports Two-Factor Authentication (2FA).

Usage:
    python3 scripts/telegram_auth.py

Environment Variables (set in .env):
    TELEGRAM_API_ID - Your Telegram API ID
    TELEGRAM_API_HASH - Your Telegram API Hash
"""
from __future__ import annotations

import asyncio
import getpass
import os
import shutil
import sys
from pathlib import Path

from dotenv import load_dotenv

# Project root
project_root = Path(__file__).parent.parent

# Load .env file
load_dotenv(project_root / ".env")

from telethon import TelegramClient
from telethon.errors import SessionPasswordNeededError
from telethon.tl.functions.messages import GetDialogFiltersRequest


def get_credentials() -> tuple[int, str]:
    """Get API credentials from environment."""
    api_id = os.getenv("TELEGRAM_API_ID")
    api_hash = os.getenv("TELEGRAM_API_HASH")

    if not api_id or not api_hash:
        print("❌ Error: TELEGRAM_API_ID and TELEGRAM_API_HASH required")
        print("\nSet them in your .env file:")
        print("  TELEGRAM_API_ID=your_api_id")
        print("  TELEGRAM_API_HASH=your_api_hash")
        sys.exit(1)

    try:
        api_id = int(api_id)
    except (ValueError, TypeError):
        print(f"❌ Error: API_ID must be an integer, got: {api_id}")
        sys.exit(1)

    return api_id, api_hash


async def show_folders(client: TelegramClient):
    """Show all Telegram folders for verification."""
    folder_pattern = os.getenv("FOLDER_ARCHIVE_ALL_PATTERN", "tg-archiver")

    print("\n📁 Telegram Folders on this account:")
    print("-" * 40)

    filters = await client(GetDialogFiltersRequest())
    found_target = False

    for i, f in enumerate(filters.filters, 1):
        title = getattr(f, 'title', None)
        if title:
            folder_name = title.text if hasattr(title, 'text') else str(title)
            # Count channels in folder
            include_peers = getattr(f, 'include_peers', [])
            channel_count = len(include_peers)

            # Check if this is the target folder
            is_target = folder_name.lower() == folder_pattern.lower()
            marker = " ✅ TARGET" if is_target else ""
            if is_target:
                found_target = True

            print(f"  {i}. {folder_name} ({channel_count} chats){marker}")
        else:
            print(f"  {i}. [All Chats]")

    print("-" * 40)

    if found_target:
        print(f"✅ Found target folder '{folder_pattern}'")
    else:
        print(f"⚠️  Target folder '{folder_pattern}' NOT FOUND")
        print(f"   Create a folder named '{folder_pattern}' in your Telegram app")
        print(f"   and add channels to archive.")

    return found_target


async def authenticate():
    """Authenticate with Telegram and create session file."""
    api_id, api_hash = get_credentials()

    # Session file location
    session_dir = project_root / "sessions"
    session_dir.mkdir(exist_ok=True)
    session_file = session_dir / "listener"

    print("🔐 tg-archiver Telegram Authentication")
    print("=" * 60)
    print(f"API ID: {api_id}")
    print(f"Session file: {session_file}.session")
    print("=" * 60)
    print()

    # Create Telegram client
    client = TelegramClient(
        str(session_file),
        api_id,
        api_hash
    )

    await client.connect()

    if await client.is_user_authorized():
        print("✅ Already authenticated!")
        me = await client.get_me()
        print(f"   Logged in as: {me.first_name} {me.last_name or ''} (@{me.username or 'N/A'})")
        print(f"   Phone: {me.phone}")
        print(f"   User ID: {me.id}")

        # Show folders
        await show_folders(client)

        await client.disconnect()
        return

    # Not authorized - need to authenticate
    print("📱 Phone number authentication required")
    print()

    # Get phone number
    phone = input("Enter your phone number (with country code, e.g., +1234567890): ").strip()

    if not phone:
        print("❌ Error: Phone number required")
        await client.disconnect()
        sys.exit(1)

    # Send code request
    print(f"\n📤 Sending verification code to {phone}...")
    await client.send_code_request(phone)

    # Get verification code
    code = input("\n🔑 Enter the verification code you received: ").strip()

    if not code:
        print("❌ Error: Verification code required")
        await client.disconnect()
        sys.exit(1)

    # Sign in (with 2FA support)
    try:
        print("\n🔐 Signing in...")
        await client.sign_in(phone, code)

    except SessionPasswordNeededError:
        print("\n🔒 Two-Factor Authentication (2FA) enabled")
        password = getpass.getpass("🔑 Enter your 2FA password: ")

        if not password:
            print("❌ Error: 2FA password required")
            await client.disconnect()
            sys.exit(1)

        try:
            await client.sign_in(password=password)
        except Exception as e:
            print(f"\n❌ 2FA authentication failed: {e}")
            await client.disconnect()
            sys.exit(1)

    except Exception as e:
        print(f"\n❌ Authentication failed: {e}")
        await client.disconnect()
        sys.exit(1)

    # Success - show user info
    me = await client.get_me()

    print("\n" + "=" * 60)
    print("✅ Authentication successful!")
    print("=" * 60)
    print(f"Logged in as: {me.first_name} {me.last_name or ''}")
    print(f"Username: @{me.username or 'N/A'}")
    print(f"Phone: {me.phone}")
    print(f"User ID: {me.id}")
    print()
    print(f"Session file created: {session_file}.session")

    # Show folders
    await show_folders(client)

    print()
    print("=" * 60)
    print("🚀 Next steps:")
    print("   1. Create a folder named 'tg-archiver' in Telegram app")
    print("   2. Add channels you want to archive to that folder")
    print("   3. Start the platform: docker-compose up -d")
    print("=" * 60)

    await client.disconnect()


def main():
    try:
        asyncio.run(authenticate())
    except KeyboardInterrupt:
        print("\n\n⚠️  Cancelled by user")
        sys.exit(1)
    except Exception as e:
        print(f"\n❌ Error: {e}")
        import traceback
        traceback.print_exc()
        sys.exit(1)


if __name__ == "__main__":
    main()
