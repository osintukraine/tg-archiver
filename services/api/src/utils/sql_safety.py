"""
SQL Safety Utilities

Functions to prevent SQL-related security issues like pattern injection.
"""

import re


def escape_ilike_pattern(value: str) -> str:
    """
    Escape ILIKE special characters to prevent pattern injection.

    SECURITY: User input in ILIKE patterns can match unintended records
    if % and _ are not escaped. This prevents wildcard abuse and
    potential ReDoS-like patterns.

    Args:
        value: User-provided search string

    Returns:
        Escaped string safe for use in ILIKE patterns

    Example:
        >>> escape_ilike_pattern("test%string")
        'test\\%string'
        >>> escape_ilike_pattern("user_name")
        'user\\_name'
    """
    # Escape backslash first (it's the escape character), then ILIKE wildcards
    return re.sub(r'([\\%_])', r'\\\1', value)


def escape_like_pattern(value: str) -> str:
    """
    Escape LIKE special characters (alias for escape_ilike_pattern).

    PostgreSQL LIKE and ILIKE use the same escape characters.
    """
    return escape_ilike_pattern(value)
