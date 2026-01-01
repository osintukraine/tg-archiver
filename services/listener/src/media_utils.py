"""
Media Utilities - Shared Media Type Normalization

Provides consistent media type detection across listener and backfill services.
"""

from typing import Optional
from telethon.tl.types import Message as TelegramMessage


def get_media_type(message: TelegramMessage) -> Optional[str]:
    """
    Get normalized media type from Telethon message.

    Converts Telethon's media class names to normalized types:
    - MessageMediaPhoto → photo
    - MessageMediaDocument → document (or video/audio/image based on MIME type)
    - MessageMediaWebPage → webpage
    - etc.

    Args:
        message: Telethon Message object

    Returns:
        Normalized media type string (photo/video/document/etc.) or None
    """
    if not message.media:
        return None

    media = message.media

    # Map Telethon media class names to normalized types
    media_type_map = {
        "MessageMediaPhoto": "photo",
        "MessageMediaDocument": "document",
        "MessageMediaGeo": "geo",
        "MessageMediaContact": "contact",
        "MessageMediaVenue": "venue",
        "MessageMediaWebPage": "webpage",
        "MessageMediaPoll": "poll",
    }

    media_class = media.__class__.__name__
    media_type = media_type_map.get(media_class)

    # Refine document type based on MIME type (video, audio, image, etc.)
    if media_type == "document" and hasattr(media, "document"):
        doc = media.document
        if hasattr(doc, "mime_type"):
            if "video" in doc.mime_type:
                return "video"
            elif "audio" in doc.mime_type:
                return "audio"
            elif "image" in doc.mime_type:
                return "image"

    return media_type
