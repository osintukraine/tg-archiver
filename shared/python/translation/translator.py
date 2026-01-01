"""
Translation Service for Comments

Supports multiple translation backends with fallback:
1. Google Translate Free (deep-translator) - PRIMARY (€0/month)
2. DeepL Free API - SECONDARY (if DEEPL_API_KEY configured)
3. No translation - FALLBACK (store original)

Usage:
    translator = get_translator()
    translated, method, confidence = await translator.translate(
        text="Привет мир",
        source_lang="ru"
    )
"""

import asyncio
import logging
from typing import Optional, Tuple

try:
    from deep_translator import GoogleTranslator
except ImportError:
    GoogleTranslator = None
    logging.warning("deep-translator not installed, Google Translate Free unavailable")

try:
    from langdetect import detect, DetectorFactory
    # Make language detection deterministic
    DetectorFactory.seed = 0
except ImportError:
    detect = None
    logging.warning("langdetect not installed, language detection unavailable")

logger = logging.getLogger(__name__)


class CommentTranslator:
    """
    Multi-backend translation service for comments.

    Supports:
    - Google Translate Free (via deep-translator) - PRIMARY
    - DeepL Free API (if DEEPL_API_KEY set) - SECONDARY
    - Fallback to original text
    """

    def __init__(
        self,
        deepl_api_key: Optional[str] = None,
        target_language: str = "en",
    ) -> None:
        """
        Initialize translator.

        Args:
            deepl_api_key: Optional DeepL API key for fallback
            target_language: Target language for translation (default: "en")
        """
        self.target_language = target_language
        self.deepl_api_key = deepl_api_key

        # Initialize Google Translator (free)
        if GoogleTranslator:
            try:
                self.google_translator = GoogleTranslator(
                    source='auto',  # Auto-detect source language
                    target=target_language
                )
                logger.info("Google Translate Free initialized (primary)")
            except Exception as e:
                logger.warning(f"Failed to initialize Google Translator: {e}")
                self.google_translator = None
        else:
            self.google_translator = None

        # Initialize DeepL if API key provided
        self.deepl_translator = None
        if deepl_api_key:
            try:
                import deepl
                self.deepl_translator = deepl.Translator(deepl_api_key)
                logger.info("DeepL translator initialized (fallback)")
            except ImportError:
                logger.warning("deepl package not installed, DeepL unavailable")
            except Exception as e:
                logger.warning(f"Failed to initialize DeepL: {e}")

    def detect_language(self, text: str) -> Tuple[str, float]:
        """
        Detect language of text.

        Returns:
            (language_code, confidence)
            e.g., ("ru", 0.95)
        """
        if not detect or not text or len(text.strip()) < 3:
            return "unknown", 0.0

        try:
            lang = detect(text)
            # langdetect doesn't provide confidence, estimate based on text length
            # Longer text = higher confidence in detection
            confidence = min(1.0, len(text) / 100)
            return lang, round(confidence, 2)
        except Exception as e:
            logger.debug(f"Language detection failed: {e}")
            return "unknown", 0.0

    async def translate_google_free(
        self,
        text: str,
        source_lang: Optional[str] = None
    ) -> Optional[str]:
        """
        Translate using Google Translate Free (deep-translator).

        This is web-scraping based, completely free, no API key needed.

        Args:
            text: Text to translate
            source_lang: Source language (optional, auto-detect if None)

        Returns:
            Translated text or None if failed
        """
        if not self.google_translator or not text:
            return None

        try:
            # Run in executor to avoid blocking (deep-translator is synchronous)
            loop = asyncio.get_event_loop()
            translated = await loop.run_in_executor(
                None,
                lambda: self.google_translator.translate(text)
            )

            # Add small delay to avoid rate limiting
            await asyncio.sleep(0.5)

            return translated

        except Exception as e:
            logger.warning(f"Google Translate Free failed: {e}")
            return None

    async def translate_deepl_free(
        self,
        text: str,
        source_lang: Optional[str] = None
    ) -> Optional[str]:
        """
        Translate using DeepL Free API (if configured).

        Requires DEEPL_API_KEY environment variable.

        Args:
            text: Text to translate
            source_lang: Source language (optional)

        Returns:
            Translated text or None if failed
        """
        if not self.deepl_translator or not text:
            return None

        try:
            result = self.deepl_translator.translate_text(
                text,
                source_lang=source_lang.upper() if source_lang else None,
                target_lang=self.target_language.upper()
            )
            return result.text

        except Exception as e:
            logger.warning(f"DeepL translation failed: {e}")
            return None

    async def translate(
        self,
        text: str,
        source_lang: Optional[str] = None
    ) -> Tuple[Optional[str], str, float]:
        """
        Translate text with automatic fallback.

        Tries:
        1. Google Translate Free (primary)
        2. DeepL Free API (if configured)
        3. Return None (no translation)

        Args:
            text: Text to translate
            source_lang: Source language (optional, will auto-detect)

        Returns:
            (translated_text, method, confidence)

        Examples:
            ("Translated text", "google_free", 0.95)
            (None, "none", 0.0)  # No translation available
        """
        if not text or len(text.strip()) == 0:
            return None, "none", 0.0

        # Detect language if not provided
        if not source_lang:
            source_lang, lang_confidence = self.detect_language(text)
        else:
            lang_confidence = 1.0

        # Skip if already in target language
        if source_lang == self.target_language:
            logger.debug(f"Text already in {self.target_language}, skipping translation")
            return text, "none", 1.0

        # Skip if language unknown
        if source_lang == "unknown":
            logger.debug("Could not detect language, skipping translation")
            return None, "none", 0.0

        # Try Google Translate Free (primary)
        translated = await self.translate_google_free(text, source_lang)
        if translated:
            logger.info(f"Translated via Google Free: {source_lang} → {self.target_language}")
            return translated, "google_free", lang_confidence

        # Try DeepL Free (secondary)
        if self.deepl_translator:
            translated = await self.translate_deepl_free(text, source_lang)
            if translated:
                logger.info(f"Translated via DeepL Free: {source_lang} → {self.target_language}")
                return translated, "deepl_free", lang_confidence

        # No translation available
        logger.warning(f"Could not translate text from {source_lang}")
        return None, "none", lang_confidence


# Singleton instance
_translator_instance: Optional[CommentTranslator] = None


def get_translator(
    deepl_api_key: Optional[str] = None,
    target_language: str = "en"
) -> CommentTranslator:
    """
    Get or create translator singleton.

    Args:
        deepl_api_key: Optional DeepL API key
        target_language: Target language (default: "en")

    Returns:
        CommentTranslator instance
    """
    global _translator_instance

    if _translator_instance is None:
        _translator_instance = CommentTranslator(
            deepl_api_key=deepl_api_key,
            target_language=target_language
        )

    return _translator_instance
