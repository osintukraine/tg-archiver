"""
Entity Extraction - Configurable Pattern-Based Extraction

Extracts entities from Telegram messages using patterns loaded from the database.
Operators can configure patterns via the admin UI at /admin/extraction.

Pattern Types:
1. regex: Regular expression patterns
2. keyword_list: JSON array of keywords to match

Entity Types:
- hashtag, mention, url, telegram_link (built-in core patterns)
- coordinate (location-based patterns)
- custom (user-defined patterns)

Output Format (JSONB):
{
  "hashtags": ["#topic", "#news"],
  "mentions": ["@username"],
  "urls": ["https://example.com"],
  "telegram_links": ["t.me/channel"],
  "coordinates": [{"lat": 50.4501, "lon": 30.5234}]
}

Performance:
- Regex-based extraction is fast (~1ms per message)
- Patterns are cached and only reloaded on explicit request
- Redis pub/sub triggers reload when patterns are updated via API
"""

import json
import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)


@dataclass
class CompiledPattern:
    """A compiled extraction pattern ready for use."""
    name: str
    entity_type: str
    pattern: str
    pattern_type: str  # 'regex' or 'keyword_list'
    case_sensitive: bool
    compiled_regex: Optional[re.Pattern] = None
    keywords: List[str] = field(default_factory=list)


class EntityExtractor:
    """
    Extracts entities from Telegram messages using configurable patterns.

    Patterns are loaded from the database and can be reloaded at runtime
    via the reload_patterns() method (triggered by Redis pub/sub).
    """

    # Default patterns used when database is empty or unavailable
    DEFAULT_PATTERNS = [
        {
            "name": "Hashtags",
            "entity_type": "hashtag",
            "pattern": r"#[a-zA-Zа-яА-ЯіІїЇєЄґҐ0-9_]+",
            "pattern_type": "regex",
            "case_sensitive": False,
        },
        {
            "name": "Mentions",
            "entity_type": "mention",
            "pattern": r"@[a-zA-Z0-9_]{5,32}",
            "pattern_type": "regex",
            "case_sensitive": False,
        },
        {
            "name": "URLs",
            "entity_type": "url",
            "pattern": r"https?://[^\s]+",
            "pattern_type": "regex",
            "case_sensitive": False,
        },
        {
            "name": "Telegram Links",
            "entity_type": "telegram_link",
            "pattern": r"t\.me/[a-zA-Z0-9_/]+",
            "pattern_type": "regex",
            "case_sensitive": False,
        },
        {
            "name": "Coordinates",
            "entity_type": "coordinate",
            "pattern": r"(-?\d+\.\d+)[°\s]*([NS]),?\s*(-?\d+\.\d+)[°\s]*([EW])",
            "pattern_type": "regex",
            "case_sensitive": False,
        },
    ]

    def __init__(self) -> None:
        """Initialize entity extractor with default patterns."""
        self.patterns: List[CompiledPattern] = []
        self.patterns_loaded = False
        self.total_extracted = 0
        self.total_messages = 0

        # Load default patterns as fallback
        self._load_default_patterns()

    def _load_default_patterns(self) -> None:
        """Load default patterns as fallback."""
        for p in self.DEFAULT_PATTERNS:
            self._add_pattern(
                name=p["name"],
                entity_type=p["entity_type"],
                pattern=p["pattern"],
                pattern_type=p["pattern_type"],
                case_sensitive=p["case_sensitive"],
            )

    def _add_pattern(
        self,
        name: str,
        entity_type: str,
        pattern: str,
        pattern_type: str,
        case_sensitive: bool,
    ) -> bool:
        """Add and compile a pattern. Returns True if successful."""
        try:
            compiled = CompiledPattern(
                name=name,
                entity_type=entity_type,
                pattern=pattern,
                pattern_type=pattern_type,
                case_sensitive=case_sensitive,
            )

            if pattern_type == "regex":
                flags = 0 if case_sensitive else re.IGNORECASE
                compiled.compiled_regex = re.compile(pattern, flags)
            elif pattern_type == "keyword_list":
                compiled.keywords = json.loads(pattern)
                if not isinstance(compiled.keywords, list):
                    raise ValueError("Keyword list must be a JSON array")

            self.patterns.append(compiled)
            return True
        except (re.error, json.JSONDecodeError, ValueError) as e:
            logger.warning(f"Failed to compile pattern '{name}': {e}")
            return False

    async def load_patterns_from_db(self, db_session) -> int:
        """
        Load extraction patterns from database.

        Args:
            db_session: SQLAlchemy async session

        Returns:
            Number of patterns loaded
        """
        from sqlalchemy import text

        try:
            result = await db_session.execute(text("""
                SELECT name, entity_type, pattern, pattern_type, case_sensitive
                FROM extraction_patterns
                WHERE enabled = true
                ORDER BY sort_order, name
            """))
            rows = result.fetchall()

            if not rows:
                logger.info("No patterns in database, using defaults")
                return len(self.patterns)

            # Clear existing patterns and load from DB
            self.patterns = []
            loaded = 0

            for row in rows:
                name, entity_type, pattern, pattern_type, case_sensitive = row
                if self._add_pattern(name, entity_type, pattern, pattern_type, case_sensitive):
                    loaded += 1

            self.patterns_loaded = True
            logger.info(f"Loaded {loaded} extraction patterns from database")
            return loaded

        except Exception as e:
            logger.error(f"Failed to load patterns from database: {e}")
            if not self.patterns:
                self._load_default_patterns()
            return len(self.patterns)

    async def reload_patterns(self, db_session) -> int:
        """
        Reload patterns from database (called when patterns are updated via API).

        Args:
            db_session: SQLAlchemy async session

        Returns:
            Number of patterns loaded
        """
        logger.info("Reloading extraction patterns from database")
        return await self.load_patterns_from_db(db_session)

    def extract(self, text: Optional[str], exclude_channel: Optional[str] = None) -> Dict[str, Any]:
        """
        Extract entities from message text.

        Args:
            text: Message content (original or translated)
            exclude_channel: Channel username to exclude from mentions/links.
                           This prevents channel self-references from being
                           treated as entities. Can include or omit the @ prefix.

        Returns:
            Dictionary with extracted entities (JSONB-compatible)
        """
        if not text:
            return {}

        # Normalize exclude_channel for matching
        excluded = None
        if exclude_channel:
            excluded = exclude_channel.lstrip("@").lower()

        self.total_messages += 1
        entities: Dict[str, Any] = {}

        # Apply each pattern
        for compiled_pattern in self.patterns:
            matches = self._apply_pattern(compiled_pattern, text, excluded)
            if matches:
                entity_key = self._get_entity_key(compiled_pattern.entity_type)

                # Handle coordinate entities specially (they have structured data)
                if compiled_pattern.entity_type == "coordinate":
                    entities[entity_key] = self._parse_coordinates(matches)
                else:
                    # Merge with existing matches of same type
                    if entity_key in entities:
                        entities[entity_key].extend(matches)
                        entities[entity_key] = list(set(entities[entity_key]))
                    else:
                        entities[entity_key] = list(set(matches))

                self.total_extracted += len(matches)

        logger.debug(
            f"Extracted {sum(len(v) if isinstance(v, list) else 1 for v in entities.values())} "
            f"entities: {list(entities.keys())}"
        )

        return entities

    def _apply_pattern(
        self,
        compiled_pattern: CompiledPattern,
        text: str,
        excluded: Optional[str] = None,
    ) -> List[str]:
        """Apply a single pattern to text and return matches."""
        matches = []

        if compiled_pattern.pattern_type == "regex" and compiled_pattern.compiled_regex:
            raw_matches = compiled_pattern.compiled_regex.findall(text)
            # Handle tuple results from groups
            if raw_matches and isinstance(raw_matches[0], tuple):
                matches = ["".join(m) for m in raw_matches]
            else:
                matches = list(raw_matches)

        elif compiled_pattern.pattern_type == "keyword_list":
            text_lower = text if compiled_pattern.case_sensitive else text.lower()
            for kw in compiled_pattern.keywords:
                kw_search = kw if compiled_pattern.case_sensitive else kw.lower()
                if kw_search in text_lower:
                    matches.append(kw)

        # Filter out self-references for mentions and telegram links
        if excluded and matches:
            entity_type = compiled_pattern.entity_type
            if entity_type == "mention":
                matches = [m for m in matches if m.lstrip("@").lower() != excluded]
            elif entity_type == "telegram_link":
                filtered = []
                for link in matches:
                    parts = link.replace("t.me/", "").split("/")
                    if parts and parts[0].lower() != excluded:
                        filtered.append(link)
                matches = filtered

        return matches

    def _get_entity_key(self, entity_type: str) -> str:
        """Convert entity_type to output key name."""
        # Map entity types to output keys (pluralized)
        key_map = {
            "hashtag": "hashtags",
            "mention": "mentions",
            "url": "urls",
            "telegram_link": "telegram_links",
            "coordinate": "coordinates",
        }
        return key_map.get(entity_type, f"{entity_type}s")

    def _parse_coordinates(self, raw_matches: List[str]) -> List[Dict[str, float]]:
        """Parse coordinate matches into structured data."""
        coordinates = []
        # Re-run pattern to get groups
        coord_pattern = re.compile(
            r"(-?\d+\.\d+)[°\s]*([NS]),?\s*(-?\d+\.\d+)[°\s]*([EW])",
            re.IGNORECASE,
        )
        for match in raw_matches:
            coord_matches = coord_pattern.findall(match)
            for lat, lat_dir, lon, lon_dir in coord_matches:
                lat_value = float(lat) * (1 if lat_dir.upper() == "N" else -1)
                lon_value = float(lon) * (1 if lon_dir.upper() == "E" else -1)
                coordinates.append({"lat": lat_value, "lon": lon_value})
        return coordinates

    def get_stats(self) -> Dict[str, Any]:
        """Get entity extraction statistics."""
        avg_entities = (
            self.total_extracted / self.total_messages if self.total_messages > 0 else 0.0
        )

        return {
            "total_messages": self.total_messages,
            "total_entities_extracted": self.total_extracted,
            "avg_entities_per_message": avg_entities,
            "patterns_loaded": len(self.patterns),
            "patterns_from_db": self.patterns_loaded,
        }

    def get_loaded_patterns(self) -> List[Dict[str, Any]]:
        """Get list of currently loaded patterns (for debugging)."""
        return [
            {
                "name": p.name,
                "entity_type": p.entity_type,
                "pattern_type": p.pattern_type,
            }
            for p in self.patterns
        ]
