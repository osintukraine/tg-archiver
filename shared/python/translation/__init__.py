"""
Translation Module

Provides automatic translation services for comments and messages.
Primary backend: Google Translate Free (via deep-translator)
Fallback: DeepL Free API (if configured)

Cost: €0/month
"""

from .translator import CommentTranslator, get_translator

__all__ = ["CommentTranslator", "get_translator"]
