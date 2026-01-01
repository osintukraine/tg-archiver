"""
Military Slang - Runtime-editable slang dictionary for LLM classification

This model stores Ukrainian/Russian military slang terms that are injected
into LLM prompts at runtime. Terms can be managed via NocoDB without code changes.

The slang dictionary helps the LLM correctly classify messages that use:
- Combat slang (прилетіло, бавовна, хлопок, бахнуло)
- Military abbreviations (БпЛА, ППО, КАБ)
- Casualty codes (200, 300)
- Frontline locations (Покровськ, Часів Яр)
- Derogatory terms (орки, укропи - for context understanding)

Usage:
    # Fetch all active slang terms
    slang = await session.execute(
        select(MilitarySlang)
        .where(MilitarySlang.is_active == True)
        .order_by(MilitarySlang.language, MilitarySlang.category)
    )

    # Build glossary for prompt injection
    glossary = build_slang_glossary(slang.scalars().all())
"""

from sqlalchemy import Column, Integer, String, Boolean, Text, DateTime, UniqueConstraint
from sqlalchemy.sql import func
from .base import Base


class MilitarySlang(Base):
    """
    Military slang dictionary for LLM prompt enhancement.

    Changes to this table are automatically reflected in the next
    classification request (via {{MILITARY_SLANG}} placeholder in prompts).

    Attributes:
        term: The slang term (e.g., "прилетіло")
        language: 'uk' (Ukrainian) or 'ru' (Russian)
        meaning: English translation/explanation
        topic_hint: Suggested topic for classification
        category: Type of term (slang, abbreviation, location, derogatory)
        notes: Additional context
        source: Who added this entry (for audit)
        is_active: Whether to include in prompts
    """
    __tablename__ = "military_slang"

    id = Column(Integer, primary_key=True, autoincrement=True)

    # Core fields
    term = Column(
        String(100),
        nullable=False,
        comment="The slang term (e.g., 'прилетіло')"
    )
    language = Column(
        String(10),
        nullable=False,
        index=True,
        comment="Language code: 'uk' (Ukrainian) or 'ru' (Russian)"
    )
    meaning = Column(
        Text,
        nullable=False,
        comment="English translation/explanation"
    )
    topic_hint = Column(
        String(50),
        comment="Suggested topic: combat, casualties, equipment, etc."
    )
    category = Column(
        String(50),
        nullable=False,
        index=True,
        comment="Type: slang, abbreviation, location, derogatory"
    )
    notes = Column(
        Text,
        comment="Additional context (e.g., 'lit. cotton')"
    )
    source = Column(
        String(100),
        comment="Who added this entry (for audit)"
    )

    # Status
    is_active = Column(
        Boolean,
        nullable=False,
        default=True,
        index=True,
        comment="Whether to include in prompts"
    )

    # Timestamps
    created_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False
    )
    updated_at = Column(
        DateTime(timezone=True),
        onupdate=func.now()
    )

    # Unique constraint
    __table_args__ = (
        UniqueConstraint('term', 'language', name='uq_slang_term_lang'),
    )

    def __repr__(self):
        return (
            f"<MilitarySlang("
            f"term={self.term}, "
            f"language={self.language}, "
            f"category={self.category}, "
            f"active={self.is_active}"
            f")>"
        )

    def to_dict(self):
        """Convert to dictionary for API responses."""
        return {
            "id": self.id,
            "term": self.term,
            "language": self.language,
            "meaning": self.meaning,
            "topic_hint": self.topic_hint,
            "category": self.category,
            "notes": self.notes,
            "source": self.source,
            "is_active": self.is_active,
            "created_at": self.created_at.isoformat() if self.created_at else None,
            "updated_at": self.updated_at.isoformat() if self.updated_at else None,
        }

    def to_prompt_line(self) -> str:
        """
        Format this term for inclusion in LLM prompt.

        Returns:
            Formatted string like: '- "прилетіло" = strike landed (combat)'
        """
        line = f'- "{self.term}" = {self.meaning}'
        if self.notes:
            line += f' ({self.notes})'
        return line


def build_slang_glossary(terms: list["MilitarySlang"]) -> str:
    """
    Build a formatted glossary from a list of slang terms.

    Args:
        terms: List of MilitarySlang objects

    Returns:
        Formatted glossary string for prompt injection
    """
    if not terms:
        return "No slang terms available."

    # Group by language
    uk_terms = [t for t in terms if t.language == 'uk' and t.is_active]
    ru_terms = [t for t in terms if t.language == 'ru' and t.is_active]

    sections = []

    if uk_terms:
        # Sub-group Ukrainian terms by category
        uk_slang = [t for t in uk_terms if t.category == 'slang']
        uk_abbrev = [t for t in uk_terms if t.category == 'abbreviation']
        uk_locations = [t for t in uk_terms if t.category == 'location']

        uk_lines = ["Ukrainian slang:"]
        for t in uk_slang:
            uk_lines.append(t.to_prompt_line())
        if uk_abbrev:
            uk_lines.append("\nUkrainian abbreviations:")
            for t in uk_abbrev:
                uk_lines.append(t.to_prompt_line())
        if uk_locations:
            uk_lines.append("\nFrontline locations (Ukrainian):")
            for t in uk_locations:
                uk_lines.append(t.to_prompt_line())

        sections.append("\n".join(uk_lines))

    if ru_terms:
        # Sub-group Russian terms by category
        ru_slang = [t for t in ru_terms if t.category == 'slang']
        ru_abbrev = [t for t in ru_terms if t.category == 'abbreviation']
        ru_locations = [t for t in ru_terms if t.category == 'location']

        ru_lines = ["Russian slang:"]
        for t in ru_slang:
            ru_lines.append(t.to_prompt_line())
        if ru_abbrev:
            ru_lines.append("\nRussian abbreviations:")
            for t in ru_abbrev:
                ru_lines.append(t.to_prompt_line())
        if ru_locations:
            ru_lines.append("\nFrontline locations (Russian):")
            for t in ru_locations:
                ru_lines.append(t.to_prompt_line())

        sections.append("\n".join(ru_lines))

    return "\n\n".join(sections)
