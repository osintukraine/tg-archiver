"""
Formatting Utilities

Shared formatting functions used across the API.
"""


def format_bytes(size: int) -> str:
    """
    Format bytes to human readable string.

    Args:
        size: Size in bytes

    Returns:
        Human readable string like "1.5 GB"

    Examples:
        >>> format_bytes(1024)
        '1.0 KB'
        >>> format_bytes(1073741824)
        '1.0 GB'
    """
    for unit in ['B', 'KB', 'MB', 'GB', 'TB']:
        if size < 1024:
            return f"{size:.1f} {unit}"
        size /= 1024
    return f"{size:.1f} PB"


def safe_percentage(numerator: float, denominator: float, decimals: int = 2) -> float:
    """
    Calculate percentage safely, avoiding division by zero.

    Args:
        numerator: The top number
        denominator: The bottom number
        decimals: Number of decimal places to round to

    Returns:
        Percentage value, or 0.0 if denominator is zero
    """
    if denominator == 0:
        return 0.0
    return round((numerator / denominator) * 100, decimals)
