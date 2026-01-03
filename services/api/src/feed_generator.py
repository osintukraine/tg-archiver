"""
Multi-Format Feed Generator

Generates RSS 2.0, Atom 1.0, and JSON Feed 1.1 from search results.
Supports media enclosures/attachments and subscribable search queries.

Key Features:
- Three output formats: RSS 2.0, Atom 1.0, JSON Feed 1.1
- Proper media enclosures with file sizes
- Local archived URLs when available (MinIO), fallback to Telegram
- Redis caching (5-15 min TTL based on popularity)
- Feed autodiscovery support

Specifications:
- RSS 2.0: https://cyber.harvard.edu/rss/rss.html
- Atom 1.0: RFC 4287 (https://www.rfc-editor.org/rfc/rfc4287)
- JSON Feed 1.1: https://jsonfeed.org/version/1.1/
"""

import json
from datetime import datetime, timezone
from enum import Enum
from typing import Optional
from urllib.parse import urlencode

from feedgen.feed import FeedGenerator as FeedGenFeed

from config.settings import settings
from models.message import Message


class FeedFormat(str, Enum):
    """Supported feed output formats."""
    RSS = "rss"
    ATOM = "atom"
    JSON = "json"


class FeedGenerator:
    """
    Multi-format feed generator for Telegram Archive.

    Generates RSS 2.0, Atom 1.0, and JSON Feed 1.1 from message lists.
    Handles feed metadata, item creation, and media enclosures/attachments.
    """

    # Content types for each format
    CONTENT_TYPES = {
        FeedFormat.RSS: "application/rss+xml; charset=utf-8",
        FeedFormat.ATOM: "application/atom+xml; charset=utf-8",
        FeedFormat.JSON: "application/feed+json; charset=utf-8",
    }

    def __init__(self, base_url: str):
        """
        Initialize feed generator.

        Args:
            base_url: Base URL for the API (e.g., https://api.example.com)
        """
        self.base_url = base_url.rstrip("/")
        self.minio_public_url = settings.MINIO_PUBLIC_URL.rstrip("/")
        self.minio_bucket = settings.MINIO_BUCKET_NAME

    def generate(
        self,
        messages: list[Message],
        title: str,
        description: str,
        feed_url: str,
        format: FeedFormat = FeedFormat.RSS,
        search_params: Optional[dict] = None,
    ) -> str:
        """
        Generate feed in specified format.

        Args:
            messages: List of Message objects to include
            title: Feed title
            description: Feed description
            feed_url: URL of this feed (for <link> and autodiscovery)
            format: Output format (rss, atom, json)
            search_params: Optional search parameters for feed description

        Returns:
            Feed content as string (XML for RSS/Atom, JSON for JSON Feed)
        """
        if format == FeedFormat.JSON:
            return self._generate_jsonfeed(messages, title, description, feed_url, search_params)
        else:
            return self._generate_feedgen(messages, title, description, feed_url, format, search_params)

    def get_content_type(self, format: FeedFormat) -> str:
        """Get Content-Type header for format."""
        return self.CONTENT_TYPES.get(format, "application/xml")

    def _generate_feedgen(
        self,
        messages: list[Message],
        title: str,
        description: str,
        feed_url: str,
        format: FeedFormat,
        search_params: Optional[dict] = None,
    ) -> str:
        """
        Generate RSS 2.0 or Atom 1.0 feed using feedgen library.

        Args:
            messages: List of Message objects
            title: Feed title
            description: Feed description
            feed_url: Self URL for the feed
            format: RSS or ATOM
            search_params: Optional search params

        Returns:
            XML string
        """
        fg = FeedGenFeed()

        # Load Media RSS extension for thumbnail support
        # This enables <media:thumbnail> and <media:content> elements
        # that feed readers use to display preview images
        fg.load_extension('media')

        # Feed metadata
        fg.id(feed_url)
        fg.title(title)
        fg.description(description)
        fg.link(href=feed_url, rel="self", type=self.get_content_type(format))
        fg.link(href=self.base_url, rel="alternate", type="text/html")
        fg.language("en")
        fg.generator(f"{settings.PLATFORM_NAME} Feed Engine v2.0")

        # Add logo/icon
        logo_url = f"{self.base_url}/static/logo-512.png"
        icon_url = f"{self.base_url}/static/favicon.png"
        fg.logo(logo_url)
        fg.icon(icon_url)

        # Feed image (RSS 2.0 specific)
        fg.image(
            url=logo_url,
            title=title,
            link=self.base_url,
        )

        # Author/Contributor
        fg.author(name=settings.PLATFORM_NAME, email="feed@telegram-archive.example.com")

        # Set last build date to most recent message
        if messages:
            latest_message = max(messages, key=lambda m: m.telegram_date or m.created_at or datetime.min)
            latest_date = latest_message.telegram_date or latest_message.created_at
            if latest_date:
                fg.updated(latest_date)
                fg.lastBuildDate(latest_date)

        # Add items
        for message in messages:
            self._add_feedgen_item(fg, message)

        # Generate output
        if format == FeedFormat.ATOM:
            return fg.atom_str(pretty=True).decode("utf-8")
        else:
            return fg.rss_str(pretty=True).decode("utf-8")

    def _add_feedgen_item(self, fg: FeedGenFeed, message: Message):
        """
        Add a message as RSS/Atom feed item.

        Args:
            fg: FeedGenerator instance
            message: Message to add
        """
        fe = fg.add_entry()

        # Item ID (must be unique and permanent)
        item_id = f"{self.base_url}/messages/{message.id}"
        fe.id(item_id)

        # Title (first 100 chars of content + importance badge)
        title = self._build_title(message)
        fe.title(title)

        # Link to message detail (frontend page, not API)
        fe.link(href=item_id, rel="alternate", type="text/html")

        # Description (rich HTML content)
        description = self._build_html_description(message)
        fe.description(description)

        # Summary (plain text version for Atom)
        summary = self._build_plain_summary(message)
        fe.summary(summary)

        # Content (full HTML for Atom - includes media)
        content_html = self._build_full_content_html(message)
        fe.content(content_html, type="html")

        # Publication date
        pub_date = message.telegram_date or message.created_at
        if pub_date:
            fe.published(pub_date)
            fe.updated(pub_date)

        # Author (channel)
        channel_name = f"Channel {message.channel_id}"
        if message.channel and hasattr(message.channel, 'name') and message.channel.name:
            channel_name = message.channel.name
        elif message.channel and hasattr(message.channel, 'username') and message.channel.username:
            channel_name = f"@{message.channel.username}"
        fe.author(name=channel_name)

        # Categories (topic classification)
        if message.topic:
            fe.category(term=message.topic, label=message.topic.title())

        if message.language_detected:
            fe.category(term=f"lang-{message.language_detected}", label=f"Language: {message.language_detected.upper()}")

        # Media enclosures
        self._add_media_enclosures(fe, message)

    def _add_media_enclosures(self, fe, message: Message):
        """
        Add media enclosures and Media RSS elements to feed item.

        Uses local MinIO URLs when available, with proper file sizes.
        Falls back to Telegram URLs for legacy/unavailable media.

        Adds two types of media elements:
        1. Standard enclosures (via link rel='enclosure') for podcast apps
        2. Media RSS elements (<media:thumbnail>, <media:content>) for feed readers
           - These are what most feed readers use to display preview images

        Args:
            fe: Feed entry
            message: Message with media
        """
        first_image_url = None

        # Check for archived media files (via relationship)
        if message.media:
            for mm in message.media:
                media_file = mm.media_file
                if media_file:
                    # Construct MinIO URL
                    media_url = f"{self.minio_public_url}/{self.minio_bucket}/{media_file.s3_key}"
                    mime_type = media_file.mime_type or self._get_mime_type(message.media_type)
                    file_size = str(media_file.file_size) if media_file.file_size else "0"

                    # Standard enclosure (for podcast apps, etc.)
                    fe.link(href=media_url, rel='enclosure', type=mime_type, length=file_size)

                    # Media RSS: Determine medium type (image, video, audio)
                    if mime_type.startswith('image/'):
                        medium = 'image'
                        # Track first image for thumbnail
                        if not first_image_url:
                            first_image_url = media_url
                    elif mime_type.startswith('video/'):
                        medium = 'video'
                    elif mime_type.startswith('audio/'):
                        medium = 'audio'
                    else:
                        medium = 'document'

                    # Add media:content element
                    fe.media.content({
                        'url': media_url,
                        'type': mime_type,
                        'medium': medium,
                        'fileSize': file_size,
                    })

        elif message.media_type and message.media_url_telegram:
            # Fallback to Telegram URL (no file size available)
            mime_type = self._get_mime_type(message.media_type)
            media_url = message.media_url_telegram

            fe.link(href=media_url, rel='enclosure', type=mime_type, length="0")

            # Determine medium
            if message.media_type == 'photo':
                medium = 'image'
                first_image_url = media_url
            elif message.media_type in ('video', 'animation', 'video_note'):
                medium = 'video'
            elif message.media_type in ('audio', 'voice'):
                medium = 'audio'
            else:
                medium = 'document'

            fe.media.content({
                'url': media_url,
                'type': mime_type,
                'medium': medium,
            })

        # Add thumbnail (first image) for feed reader previews
        if first_image_url:
            fe.media.thumbnail({'url': first_image_url})

    def _generate_jsonfeed(
        self,
        messages: list[Message],
        title: str,
        description: str,
        feed_url: str,
        search_params: Optional[dict] = None,
    ) -> str:
        """
        Generate JSON Feed 1.1.

        Spec: https://jsonfeed.org/version/1.1/

        Args:
            messages: List of Message objects
            title: Feed title
            description: Feed description
            feed_url: Self URL for the feed
            search_params: Optional search params

        Returns:
            JSON string
        """
        feed = {
            "version": "https://jsonfeed.org/version/1.1",
            "title": title,
            "home_page_url": self.base_url,
            "feed_url": feed_url,
            "description": description,
            "icon": f"{self.base_url}/static/logo-512.png",
            "favicon": f"{self.base_url}/static/favicon.png",
            "language": "en",
            "authors": [
                {
                    "name": settings.PLATFORM_NAME,
                    "url": self.base_url,
                }
            ],
            "items": [],
        }

        # Add custom extension for platform
        feed["_tg_archive"] = {
            "about": f"{self.base_url}/about",
            "version": "2.0",
            "generated_at": datetime.now(timezone.utc).isoformat(),
        }

        # Add items
        for message in messages:
            item = self._build_jsonfeed_item(message)
            feed["items"].append(item)

        return json.dumps(feed, indent=2, ensure_ascii=False, default=str)

    def _build_jsonfeed_item(self, message: Message) -> dict:
        """
        Build JSON Feed item from message.

        Args:
            message: Message object

        Returns:
            JSON Feed item dict
        """
        # Frontend page URL (not API endpoint)
        item_url = f"{self.base_url}/messages/{message.id}"

        item = {
            "id": str(message.id),
            "url": item_url,
            "title": self._build_title(message),
            "content_html": self._build_full_content_html(message),
            "content_text": self._build_plain_summary(message),
        }

        # Dates (RFC 3339 format)
        pub_date = message.telegram_date or message.created_at
        if pub_date:
            item["date_published"] = pub_date.isoformat()

        if message.updated_at:
            item["date_modified"] = message.updated_at.isoformat()

        # Author
        author = {"name": f"Channel {message.channel_id}"}
        if message.channel:
            if hasattr(message.channel, 'name') and message.channel.name:
                author["name"] = message.channel.name
            if hasattr(message.channel, 'username') and message.channel.username:
                author["url"] = f"https://t.me/{message.channel.username}"
        item["authors"] = [author]

        # Tags (categories)
        tags = []
        if message.topic:
            tags.append(message.topic)
        if message.language_detected:
            tags.append(f"lang-{message.language_detected}")
        if tags:
            item["tags"] = tags

        # Featured image (first media if photo)
        first_image_url = self._get_first_image_url(message)
        if first_image_url:
            item["image"] = first_image_url

        # Attachments (all media files)
        attachments = self._build_jsonfeed_attachments(message)
        if attachments:
            item["attachments"] = attachments

        # Custom extension
        item["_meta"] = {
            "channel_id": message.channel_id,
            "message_id": message.message_id,
            "topic": message.topic,
            "language": message.language_detected,
            "views": message.views,
            "forwards": message.forwards,
            "has_translation": bool(message.content_translated),
        }

        # Include entities if present
        if message.entities:
            item["_meta"]["entities"] = message.entities

        return item

    def _build_jsonfeed_attachments(self, message: Message) -> list[dict]:
        """
        Build JSON Feed attachments from message media.

        Supports proper size_in_bytes and duration_in_seconds per spec.

        Args:
            message: Message with media

        Returns:
            List of attachment dicts
        """
        attachments = []

        # Check for archived media files
        if message.media:
            for i, mm in enumerate(message.media):
                media_file = mm.media_file
                if media_file:
                    media_url = f"{self.minio_public_url}/{self.minio_bucket}/{media_file.s3_key}"
                    attachment = {
                        "url": media_url,
                        "mime_type": media_file.mime_type or "application/octet-stream",
                    }

                    if media_file.file_size:
                        attachment["size_in_bytes"] = media_file.file_size

                    # Title based on position
                    attachment["title"] = f"Media {i + 1}"

                    attachments.append(attachment)

        elif message.media_type and message.media_url_telegram:
            # Fallback to Telegram URL
            attachment = {
                "url": message.media_url_telegram,
                "mime_type": self._get_mime_type(message.media_type),
                "title": f"{message.media_type.title()} attachment",
            }
            attachments.append(attachment)

        return attachments

    def _build_title(self, message: Message) -> str:
        """
        Build item title from message.

        Includes content preview.

        Args:
            message: Message object

        Returns:
            Title string
        """
        content = message.content or ""
        preview = content[:100] if content else "No content"
        if len(content) > 100:
            preview += "..."

        return preview

    def _build_html_description(self, message: Message) -> str:
        """
        Build HTML description for RSS item.

        Includes content, translation, and metadata.

        Args:
            message: Message object

        Returns:
            HTML string
        """
        parts = []

        # Original content
        if message.content:
            parts.append(f"<p><strong>Content:</strong></p>")
            parts.append(f"<p>{self._escape_html(message.content)}</p>")

        # Translation
        if message.content_translated:
            parts.append(f"<p><strong>Translation (EN):</strong></p>")
            parts.append(f"<p>{self._escape_html(message.content_translated)}</p>")

        # Classification metadata
        metadata_parts = []
        if message.topic:
            metadata_parts.append(f"<strong>Topic:</strong> {message.topic}")
        if message.language_detected:
            metadata_parts.append(f"<strong>Language:</strong> {message.language_detected.upper()}")

        if metadata_parts:
            parts.append(f"<p>{' | '.join(metadata_parts)}</p>")

        # Entities
        if message.entities:
            parts.append(f"<p><strong>Entities:</strong></p>")
            parts.append(f"<pre>{self._format_entities(message.entities)}</pre>")

        # Engagement stats
        if message.views or message.forwards:
            stats = []
            if message.views:
                stats.append(f"👁 {message.views:,} views")
            if message.forwards:
                stats.append(f"↗️ {message.forwards:,} forwards")
            parts.append(f"<p><em>{' | '.join(stats)}</em></p>")

        # Source info
        channel_info = f"Channel ID: {message.channel_id}"
        if message.channel and hasattr(message.channel, 'username') and message.channel.username:
            channel_info = f"@{message.channel.username}"
        parts.append(f"<p><em>Source: {channel_info} | Message ID: {message.message_id}</em></p>")

        return "".join(parts)

    def _build_full_content_html(self, message: Message) -> str:
        """
        Build full HTML content with embedded media.

        Used for Atom content and JSON Feed content_html.

        Args:
            message: Message object

        Returns:
            Full HTML with media
        """
        parts = []

        # Add media at top
        media_html = self._build_media_html(message)
        if media_html:
            parts.append(media_html)

        # Add description content
        parts.append(self._build_html_description(message))

        return "".join(parts)

    def _build_media_html(self, message: Message) -> str:
        """
        Build HTML for inline media display.

        Args:
            message: Message object

        Returns:
            HTML string with media elements
        """
        parts = []

        if message.media:
            for mm in message.media:
                media_file = mm.media_file
                if media_file:
                    media_url = f"{self.minio_public_url}/{self.minio_bucket}/{media_file.s3_key}"
                    mime_type = media_file.mime_type or ""

                    if mime_type.startswith("image/"):
                        parts.append(f'<p><img src="{media_url}" alt="Media" style="max-width:100%;" /></p>')
                    elif mime_type.startswith("video/"):
                        parts.append(f'<p><video src="{media_url}" controls style="max-width:100%;">Your browser does not support video.</video></p>')
                    elif mime_type.startswith("audio/"):
                        parts.append(f'<p><audio src="{media_url}" controls>Your browser does not support audio.</audio></p>')
                    else:
                        parts.append(f'<p><a href="{media_url}">📎 Download attachment ({media_file.mime_type})</a></p>')

        elif message.media_type and message.media_url_telegram:
            # Fallback to Telegram URL
            url = message.media_url_telegram
            if message.media_type == "photo":
                parts.append(f'<p><img src="{url}" alt="Photo" style="max-width:100%;" /></p>')
            elif message.media_type == "video":
                parts.append(f'<p><video src="{url}" controls style="max-width:100%;">Video</video></p>')
            elif message.media_type in ["audio", "voice"]:
                parts.append(f'<p><audio src="{url}" controls>Audio</audio></p>')
            else:
                parts.append(f'<p><a href="{url}">📎 {message.media_type.title()}</a></p>')

        return "".join(parts)

    def _build_plain_summary(self, message: Message) -> str:
        """
        Build plain text summary for Atom.

        Args:
            message: Message object

        Returns:
            Plain text summary
        """
        parts = []

        if message.content_translated:
            parts.append(message.content_translated[:500])
        elif message.content:
            parts.append(message.content[:500])

        if message.topic:
            parts.append(f"[Topic: {message.topic}]")

        return " ".join(parts)

    def _get_first_image_url(self, message: Message) -> Optional[str]:
        """
        Get URL of first image for JSON Feed image field.

        Args:
            message: Message object

        Returns:
            Image URL or None
        """
        if message.media:
            for mm in message.media:
                media_file = mm.media_file
                if media_file and media_file.mime_type and media_file.mime_type.startswith("image/"):
                    return f"{self.minio_public_url}/{self.minio_bucket}/{media_file.s3_key}"

        if message.media_type == "photo" and message.media_url_telegram:
            return message.media_url_telegram

        return None

    def _get_mime_type(self, media_type: Optional[str]) -> str:
        """
        Get MIME type for media type string.

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
            "sticker": "image/webp",
            "video_note": "video/mp4",
        }
        return mime_types.get(media_type or "", "application/octet-stream")

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
        endpoint: Feed endpoint path
        params: Query parameters

    Returns:
        Full feed URL
    """
    query_string = urlencode({k: v for k, v in params.items() if v is not None})
    return f"{base_url}{endpoint}?{query_string}" if query_string else f"{base_url}{endpoint}"
