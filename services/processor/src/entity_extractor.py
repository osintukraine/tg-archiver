"""
Entity Extraction - Hashtags, Mentions, URLs

Extracts basic entities from Telegram messages using regex patterns.
Phase 1 focuses on simple, high-value entities. Phase 2+ will add spaCy NER.

Extracted Entities:
1. Hashtags: #Bakhmut, #Ukraine, #drone
2. Mentions: @username, @channelname
3. URLs: https://example.com, t.me/channel
4. Telegram links: t.me/username, t.me/c/123456/789
5. Coordinates: 50.4501° N, 30.5234° E (lat/lon pairs)
6. Military units: 47th Brigade, 3rd Assault Brigade
7. Equipment mentions: Javelin, HIMARS, Leopard, Bradley

Output Format (JSONB):
{
  "hashtags": ["#Bakhmut", "#Ukraine"],
  "mentions": ["@username"],
  "urls": ["https://example.com"],
  "telegram_links": ["t.me/channel"],
  "coordinates": [{"lat": 50.4501, "lon": 30.5234}],
  "military_units": ["47th Mechanized Brigade"],
  "equipment": ["HIMARS", "Javelin"]
}

Performance:
- Regex-based extraction is fast (~1ms per message)
- JSONB storage enables efficient querying in PostgreSQL
- Phase 2 will add spaCy NER for advanced entities (locations, organizations)
"""

import logging
import re
from typing import Optional, Dict, Any

logger = logging.getLogger(__name__)


class EntityExtractor:
    """
    Extracts entities from Telegram messages using regex patterns.

    Phase 1 implementation focuses on simple, high-value entities.
    """

    # Regex patterns for entity extraction
    HASHTAG_PATTERN = r'#[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_]+'
    MENTION_PATTERN = r'@[a-zA-Z0-9_]{5,32}'  # Telegram usernames are 5-32 chars
    URL_PATTERN = r'https?://[^\s]+'
    TELEGRAM_LINK_PATTERN = r't\.me/[a-zA-Z0-9_/]+'

    # Coordinate patterns (decimal degrees)
    # Examples: "50.4501° N", "30.5234° E" or "50.4501, 30.5234"
    COORDINATE_PATTERN = r'(-?\d+\.\d+)[°\s]*([NS]),?\s*(-?\d+\.\d+)[°\s]*([EW])'

    # Military unit patterns (Ukrainian and Russian)
    MILITARY_UNIT_PATTERNS = [
        # Ukrainian
        r'\d+[-\s]*(бригада|механізована|штурмова|танкова|десантна)',  # 47th Brigade, etc.
        r'\d+[-\s]*(brigade|mechanized|assault|tank|airborne)',
        r'(азов|kraken|da vinci|вовки|шторм|тро)',  # Named units
        # Russian
        r'\d+[-\s]*(бригада|мотострелковая|танковая)',
        r'(вагнер|wagner|чвк)',
    ]

    # Equipment mentions
    EQUIPMENT_PATTERNS = [
        # Western equipment
        r'\b(javelin|nlaw|stinger|m777|himars|mlrs|patriot|iris-t)\b',
        r'\b(abrams|leopard|challenger|bradley|stryker|marder)\b',
        r'\b(f-16|f-15|mig-29|su-27|su-25)\b',
        # Ukrainian/Russian equipment
        r'\b(bayraktar|orlan|shahed|geran|lancet|switchblade)\b',
        r'\b(т-72|т-80|т-90|bmp|btr|btр)\b',
    ]

    def __init__(self) -> None:
        """Initialize entity extractor."""
        self.total_extracted = 0
        self.total_messages = 0

    def extract(self, text: Optional[str], exclude_channel: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract entities from message text.

        Args:
            text: Message content (original or translated)
            exclude_channel: Channel username to exclude from mentions/links.
                           This prevents channel self-references from being
                           treated as entities (which would cause false positives
                           in event clustering). Can include or omit the @ prefix.

        Returns:
            Dictionary with extracted entities (JSONB-compatible)
        """
        if not text:
            return {}

        # Normalize exclude_channel for matching (remove @ prefix if present)
        excluded = None
        if exclude_channel:
            excluded = exclude_channel.lstrip('@').lower()

        self.total_messages += 1

        entities = {}

        # Extract hashtags
        hashtags = re.findall(self.HASHTAG_PATTERN, text, re.IGNORECASE)
        if hashtags:
            entities["hashtags"] = list(set(hashtags))  # Remove duplicates
            self.total_extracted += len(hashtags)

        # Extract mentions (filter out channel self-references)
        mentions = re.findall(self.MENTION_PATTERN, text)
        if mentions:
            if excluded:
                # Filter out self-mentions (channel mentioning itself)
                mentions = [m for m in mentions if m.lstrip('@').lower() != excluded]
            if mentions:
                entities["mentions"] = list(set(mentions))
                self.total_extracted += len(mentions)

        # Extract URLs
        urls = re.findall(self.URL_PATTERN, text)
        if urls:
            entities["urls"] = list(set(urls))
            self.total_extracted += len(urls)

        # Extract Telegram links (filter out channel self-references)
        tg_links = re.findall(self.TELEGRAM_LINK_PATTERN, text, re.IGNORECASE)
        if tg_links:
            if excluded:
                # Filter out self-links (t.me/channel linking to itself)
                # Pattern matches "t.me/username" or "t.me/username/123"
                filtered_links = []
                for link in tg_links:
                    # Extract username from t.me/username or t.me/username/123
                    link_username = link.split('/')[-1] if '/' in link else link
                    # Handle t.me/username/message_id format
                    parts = link.replace('t.me/', '').split('/')
                    if parts and parts[0].lower() != excluded:
                        filtered_links.append(link)
                tg_links = filtered_links
            if tg_links:
                entities["telegram_links"] = list(set(tg_links))
                self.total_extracted += len(tg_links)

        # Extract coordinates
        coord_matches = re.findall(self.COORDINATE_PATTERN, text)
        if coord_matches:
            coordinates = []
            for lat, lat_dir, lon, lon_dir in coord_matches:
                # Convert to decimal degrees
                lat_value = float(lat) * (1 if lat_dir == 'N' else -1)
                lon_value = float(lon) * (1 if lon_dir == 'E' else -1)

                coordinates.append({"lat": lat_value, "lon": lon_value})

            if coordinates:
                entities["coordinates"] = coordinates
                self.total_extracted += len(coordinates)

        # Extract military units
        military_units = []
        for pattern in self.MILITARY_UNIT_PATTERNS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            military_units.extend(matches)

        if military_units:
            entities["military_units"] = list(set(military_units))
            self.total_extracted += len(military_units)

        # Extract equipment
        equipment = []
        for pattern in self.EQUIPMENT_PATTERNS:
            matches = re.findall(pattern, text, re.IGNORECASE)
            equipment.extend(matches)

        if equipment:
            entities["equipment"] = list(set(equipment))
            self.total_extracted += len(equipment)

        logger.debug(
            f"Extracted {sum(len(v) if isinstance(v, list) else 1 for v in entities.values())} "
            f"entities: {list(entities.keys())}"
        )

        return entities

    def get_stats(self) -> Dict[str, Any]:
        """
        Get entity extraction statistics.

        Returns:
            Dictionary with stats
        """
        avg_entities = (
            self.total_extracted / self.total_messages if self.total_messages > 0 else 0.0
        )

        return {
            "total_messages": self.total_messages,
            "total_entities_extracted": self.total_extracted,
            "avg_entities_per_message": avg_entities,
        }


# Global entity extractor instance
entity_extractor = EntityExtractor()
