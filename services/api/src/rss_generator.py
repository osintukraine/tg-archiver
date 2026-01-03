"""
RSS Feed Generator

Generates RSS 2.0 feeds from search results.
Supports media enclosures and subscribable search queries.

Key Features:
- Dynamic feeds from any search query
- Media enclosures (photos, videos, documents)
- Redis caching (5-15 min TTL based on popularity)
- Valid RSS 2.0 format
- Feed autodiscovery support
"""

from datetime import datetime
from typing import Optional
from urllib.parse import urlencode

from feedgen.feed import FeedGenerator

from config.settings import settings
from models.message import Message


class RSSFeedGenerator:
    """
    Generates RSS 2.0 feeds from message lists.

    Handles feed metadata, item creation, media enclosures,
    and RSS validation.
    """

    def __init__(self, base_url: str):
        """
        Initialize RSS generator.

        Args:
            base_url: Base URL for the API (e.g., https://api.example.com)
        """
        self.base_url = base_url.rstrip("/")

    def generate_feed(
        self,
        messages: list[Message],
        title: str,
        description: str,
        feed_url: str,
        search_params: Optional[dict] = None,
    ) -> str:
        """
        Generate RSS 2.0 feed from messages.

        Args:
            messages: List of Message objects to include
            title: Feed title
            description: Feed description
            feed_url: URL of this feed (for <link> and autodiscovery)
            search_params: Optional search parameters for feed description

        Returns:
            RSS 2.0 XML string
        """
        # Create feed
        fg = FeedGenerator()

        # Feed metadata
        fg.title(title)
        fg.description(description)
        fg.link(href=feed_url, rel="self")
        fg.link(href=self.base_url, rel="alternate")
        fg.language("en")
        fg.generator("Telegram Archive RSS Engine")

        # Add logo if available
        if hasattr(settings, "PLATFORM_LOGO_URL"):
            fg.logo(settings.PLATFORM_LOGO_URL)

        # Add feed image
        fg.image(
            url=f"{self.base_url}/static/rss-icon.png",
            title=title,
            link=self.base_url,
        )

        # Set last build date to most recent message
        if messages:
            latest_message = max(messages, key=lambda m: m.created_at or datetime.min)
            fg.lastBuildDate(latest_message.created_at)

        # Add items
        for message in messages:
            self._add_feed_item(fg, message)

        # Generate RSS XML
        return fg.rss_str(pretty=True).decode("utf-8")

    def _add_feed_item(self, fg: FeedGenerator, message: Message):
        """
        Add a message as RSS feed item.

        Args:
            fg: FeedGenerator instance
            message: Message to add
        """
        fe = fg.add_entry()

        # Item ID (must be unique and permanent)
        fe.id(f"{self.base_url}/api/messages/{message.id}")

        # Title (first 100 chars of content)
        content_preview = message.content[:100] if message.content else "No content"
        if len(message.content or "") > 100:
            content_preview += "..."

        title = content_preview

        fe.title(title)

        # Link to message detail
        fe.link(href=f"{self.base_url}/api/messages/{message.id}")

        # Description (full content with translation if available)
        description_parts = []

        # Original content
        if message.content:
            description_parts.append(f"<p><strong>Content:</strong></p>")
            description_parts.append(f"<p>{self._escape_html(message.content)}</p>")

        # Translated content
        if message.content_translated:
            description_parts.append(f"<p><strong>Translation:</strong></p>")
            description_parts.append(f"<p>{self._escape_html(message.content_translated)}</p>")

        # Classification metadata
        if message.topic:
            description_parts.append(f"<p><strong>Classification:</strong></p>")
            description_parts.append(f"<p>Topic: {message.topic}</p>")

        # Entities
        if message.entities:
            description_parts.append(f"<p><strong>Entities:</strong></p>")
            description_parts.append(f"<pre>{self._format_entities(message.entities)}</pre>")

        # Channel info
        description_parts.append(
            f"<p><em>Channel ID: {message.channel_id} | "
            f"Message ID: {message.message_id}</em></p>"
        )

        fe.description("".join(description_parts))

        # Publication date
        pub_date = message.telegram_date or message.created_at
        if pub_date:
            fe.pubDate(pub_date)

        # Author (channel)
        fe.author(name=f"Channel {message.channel_id}")

        # Categories (topic classification)
        if message.topic:
            fe.category(term=message.topic)

        # Media enclosure (if has media)
        if message.media_type and message.media_url_telegram:
            self._add_media_enclosure(fe, message)

    def _add_media_enclosure(self, fe, message: Message):
        """
        Add media enclosure to feed item.

        Args:
            fe: Feed entry
            message: Message with media
        """
        media_url = message.media_url_telegram

        # Determine MIME type
        mime_type = self._get_mime_type(message.media_type)

        # Add enclosure
        # Note: RSS spec requires length (bytes), but we don't have it for Telegram URLs
        # Using 0 as fallback (some readers accept this)
        fe.enclosure(url=media_url, length="0", type=mime_type)

    def _get_mime_type(self, media_type: str) -> str:
        """
        Get MIME type for media type.

        Args:
            media_type: Media type (photo, video, document, etc.)

        Returns:
            MIME type string
        """
        mime_types = {
            "photo": "image/jpeg",
            "video": "video/mp4",
            "document": "application/octet-stream",
            "audio": "audio/mpeg",
            "voice": "audio/ogg",
            "animation": "video/mp4",
        }

        return mime_types.get(media_type, "application/octet-stream")

    def _escape_html(self, text: str) -> str:
        """
        Escape HTML entities in text.

        Args:
            text: Text to escape

        Returns:
            HTML-escaped text
        """
        return (
            text.replace("&", "&amp;")
            .replace("<", "&lt;")
            .replace(">", "&gt;")
            .replace('"', "&quot;")
            .replace("'", "&#x27;")
        )

    def _format_entities(self, entities: dict) -> str:
        """
        Format entities dict for display.

        Args:
            entities: Entities dictionary

        Returns:
            Formatted string
        """
        lines = []
        for entity_type, values in entities.items():
            if isinstance(values, list):
                lines.append(f"{entity_type}: {', '.join(map(str, values))}")
            else:
                lines.append(f"{entity_type}: {values}")

        return "\n".join(lines)


def generate_feed_url(base_url: str, endpoint: str, params: dict) -> str:
    """
    Generate feed URL with query parameters.

    Args:
        base_url: Base API URL
        endpoint: RSS endpoint path
        params: Query parameters

    Returns:
        Full feed URL
    """
    query_string = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{base_url}{endpoint}?{query_string}" if query_string else f"{base_url}{endpoint}"
