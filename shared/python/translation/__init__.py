"""Translation backends (DeepL with daily cap, Google with backoff). See translator.py."""

from .translator import (
    CommentTranslator,
    ProviderBusy,
    TranslationError,
    build_translator,
    detect_language,
)

__all__ = ["CommentTranslator", "ProviderBusy", "TranslationError", "build_translator", "detect_language"]
