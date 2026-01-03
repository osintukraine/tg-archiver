"""
Translation Service - DeepL Pro + Google Translate Fallback

Provides high-quality translation for multilingual content.
Uses DeepL Pro free API (superior quality for many language pairs).
Falls back to Google Translate if DeepL quota exceeded or unavailable.

Cost: $0/month (DeepL Pro free tier: 500,000 chars/month)

Architecture:
1. Try DeepL Pro first (best quality for many language pairs)
2. If DeepL fails/quota exceeded -> Google Translate
3. Track usage and costs in database (TranslationUsage model)
4. Language detection (fasttext or langdetect)
5. Per-message cost tracking for budget control
"""

import logging
import re
from datetime import date
from enum import Enum
from typing import Optional

import deepl
from deep_translator import GoogleTranslator
from langdetect import detect, LangDetectException
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from config.settings import settings
from models.translation import TranslationUsage

# Import Prometheus metrics
from observability.metrics import (
    translation_operations_total,
    translation_characters_total,
    translation_cost_usd_total,
    translation_errors_total,
)

logger = logging.getLogger(__name__)

# Emoji pattern for preprocessing: matches common emoji and symbol ranges + optional variation selector
# This pattern matches emoji characters that may be followed directly by text (causing translation issues)
EMOJI_SYMBOL_PATTERN = re.compile(
    r'([\U00002500-\U000027FF'  # Box Drawing, Misc Technical, Misc Symbols, Dingbats
    r'\U0001F300-\U0001F9FF'     # Misc Symbols/Pictographs, Emoticons, etc.
    r'\U0001FA00-\U0001FAFF'     # Chess, Extended Symbols
    r'\u2600-\u26FF]'            # Misc Symbols (alternate range notation)
    r'[\U0000FE00-\U0000FE0F]?)' # Optional variation selector
    r'([А-яA-Za-zЁёІіЇїЄєҐґ])',  # Followed by Cyrillic or Latin letter
    flags=re.UNICODE
)


def preprocess_for_translation(text: str) -> str:
    """
    Preprocess text to improve translation quality.

    Adds spaces after emojis when they're directly adjacent to text.
    This fixes issues where DeepL and other translators fail to translate
    the first word after an emoji (e.g., "▫️Кабмин" → "▫️ Кабмин").

    The problem occurs because translators sometimes treat emoji+word as a
    single untranslatable token. Adding a space forces proper word boundary
    detection.

    Args:
        text: Text to preprocess

    Returns:
        Preprocessed text with proper spacing around emojis
    """
    if not text:
        return text

    # Add space after emoji if followed by a letter (Cyrillic or Latin)
    result = EMOJI_SYMBOL_PATTERN.sub(r'\1 \2', text)

    return result


class TranslationProvider(str, Enum):
    """Translation provider types."""

    DEEPL = "deepl"
    GOOGLE = "google"
    MANUAL = "manual"


class TranslationResult:
    """Result from translation operation."""

    def __init__(
        self,
        translated_text: str,
        source_language: str,
        target_language: str,
        provider: TranslationProvider,
        character_count: int,
        cost_usd: float = 0.0,
    ):
        self.translated_text = translated_text
        self.source_language = source_language
        self.target_language = target_language
        self.provider = provider
        self.character_count = character_count
        self.cost_usd = cost_usd


class TranslationService:
    """
    Translation service with DeepL Pro and Google Translate fallback.

    DeepL Pro provides high-quality translation for many language pairs.
    Free tier: 500,000 characters/month.
    """

    def __init__(self):
        """Initialize translation service with DeepL and Google clients."""
        self.deepl_client: Optional[deepl.Translator] = None
        self.google_client: Optional[GoogleTranslator] = None

        # Initialize DeepL if API key available
        if settings.DEEPL_API_KEY and "YOUR_" not in settings.DEEPL_API_KEY:
            try:
                self.deepl_client = deepl.Translator(settings.DEEPL_API_KEY)
                logger.info("DeepL Pro client initialized")
            except Exception as e:
                logger.error(f"Failed to initialize DeepL client: {e}")

        # Google Translate always available (no API key needed for basic usage)
        self.google_client = GoogleTranslator(source="auto", target="en")
        logger.info("Google Translate client initialized")

    async def translate(
        self,
        text: str,
        target_language: str = "en",
        source_language: Optional[str] = None,
    ) -> TranslationResult:
        """
        Translate text using DeepL Pro with Google Translate fallback.

        Args:
            text: Text to translate
            target_language: Target language code (default: "en")
            source_language: Source language (auto-detected if None)

        Returns:
            TranslationResult with translated text and metadata

        Raises:
            Exception: If both DeepL and Google Translate fail
        """
        # Preprocess text to fix emoji-adjacent translation issues
        # This adds spaces after emojis so translators don't skip the first word
        preprocessed_text = preprocess_for_translation(text)

        # Detect source language if not provided
        if not source_language:
            source_language = self.detect_language(preprocessed_text)

        # Skip translation if already in target language
        if source_language == target_language:
            logger.debug(f"Text already in {target_language}, skipping translation")
            return TranslationResult(
                translated_text=text,
                source_language=source_language,
                target_language=target_language,
                provider=TranslationProvider.MANUAL,
                character_count=len(text),
                cost_usd=0.0,
            )

        character_count = len(preprocessed_text)

        # Try DeepL Pro first (best quality for many language pairs)
        if self.deepl_client:
            try:
                result = await self._translate_with_deepl(
                    preprocessed_text, target_language, source_language
                )

                # Record successful translation metrics
                translation_operations_total.labels(
                    provider="deepl",
                    source_lang=source_language,
                    target_lang=target_language,
                ).inc()
                translation_characters_total.labels(provider="deepl").inc(character_count)
                translation_cost_usd_total.labels(provider="deepl").inc(result.cost_usd)

                logger.debug(
                    f"DeepL translation successful ({character_count} chars, "
                    f"{source_language} → {target_language})"
                )
                return result
            except deepl.DeepLException as e:
                # Record error metrics
                error_type = "quota" if "quota" in str(e).lower() else "api_error"
                translation_errors_total.labels(
                    provider="deepl",
                    error_type=error_type,
                ).inc()

                if "quota" in str(e).lower():
                    logger.warning(f"DeepL quota exceeded: {e} - falling back to Google")
                else:
                    logger.error(f"DeepL translation failed: {e} - falling back to Google")

        # Fallback to Google Translate
        if self.google_client:
            try:
                result = await self._translate_with_google(
                    preprocessed_text, target_language, source_language
                )

                # Record successful translation metrics
                translation_operations_total.labels(
                    provider="google",
                    source_lang=source_language,
                    target_lang=target_language,
                ).inc()
                translation_characters_total.labels(provider="google").inc(character_count)
                translation_cost_usd_total.labels(provider="google").inc(result.cost_usd)

                logger.debug(
                    f"Google Translate successful ({character_count} chars, "
                    f"{source_language} → {target_language})"
                )
                return result
            except Exception as e:
                # Record error metrics
                translation_errors_total.labels(
                    provider="google",
                    error_type="api_error",
                ).inc()
                logger.exception(f"Google Translate failed: {e}")
                raise

        raise Exception("No translation provider available")

    async def _translate_with_deepl(
        self, text: str, target_lang: str, source_lang: str
    ) -> TranslationResult:
        """
        Translate using DeepL Pro.

        Args:
            text: Text to translate
            target_lang: Target language code
            source_lang: Source language code

        Returns:
            TranslationResult

        Raises:
            deepl.DeepLException: If translation fails
        """
        # DeepL uses uppercase language codes
        source_lang_upper = source_lang.upper()

        # DeepL deprecated "EN" - now requires "EN-US" or "EN-GB"
        target_lang_upper = target_lang.upper()
        if target_lang_upper == "EN":
            target_lang_upper = "EN-US"

        # Translate
        result = self.deepl_client.translate_text(
            text, target_lang=target_lang_upper, source_lang=source_lang_upper
        )

        # Calculate cost (DeepL Pro free tier: €0, paid tier: ~€20/1M chars)
        # For free tier, we track usage but cost is €0
        character_count = len(text)
        cost_usd = 0.0  # Free tier

        return TranslationResult(
            translated_text=result.text,
            source_language=source_lang,
            target_language=target_lang,
            provider=TranslationProvider.DEEPL,
            character_count=character_count,
            cost_usd=cost_usd,
        )

    async def _translate_with_google(
        self, text: str, target_lang: str, source_lang: str
    ) -> TranslationResult:
        """
        Translate using Google Translate.

        Args:
            text: Text to translate
            target_lang: Target language code
            source_lang: Source language code

        Returns:
            TranslationResult

        Note: deep-translator library doesn't require API key for basic usage
        """
        # Update target language
        self.google_client.target = target_lang

        # Translate
        translated = self.google_client.translate(text)

        character_count = len(text)
        cost_usd = 0.0  # Free usage via deep-translator

        return TranslationResult(
            translated_text=translated,
            source_language=source_lang,
            target_language=target_lang,
            provider=TranslationProvider.GOOGLE,
            character_count=character_count,
            cost_usd=cost_usd,
        )

    def detect_language(self, text: str) -> str:
        """
        Detect language of text.

        Args:
            text: Text to detect language for

        Returns:
            Language code (e.g., "en", "ru", "uk")
        """
        try:
            lang = detect(text)
            return lang
        except LangDetectException:
            logger.warning("Language detection failed, assuming English")
            return "en"

    async def track_usage(
        self,
        session: AsyncSession,
        provider: TranslationProvider,
        character_count: int,
        cost_usd: float = 0.0,
    ):
        """
        Track translation usage in database.

        Updates daily aggregated usage per provider.

        Args:
            session: Database session
            provider: Translation provider used
            character_count: Number of characters translated
            cost_usd: Cost in USD
        """
        today = date.today()

        try:
            # Find or create usage record for today + provider
            result = await session.execute(
                select(TranslationUsage).where(
                    TranslationUsage.date == today,
                    TranslationUsage.provider == provider.value,
                )
            )
            usage = result.scalar_one_or_none()

            if usage:
                # Update existing record
                usage.characters_translated += character_count
                usage.cost_usd = (usage.cost_usd or 0.0) + cost_usd
                usage.message_count = (usage.message_count or 0) + 1
            else:
                # Create new record
                usage = TranslationUsage(
                    date=today,
                    provider=provider.value,
                    characters_translated=character_count,
                    cost_usd=cost_usd,
                    message_count=1,
                )
                session.add(usage)

            await session.commit()

            logger.debug(
                f"Tracked usage: {provider.value} - {character_count} chars, "
                f"${cost_usd:.4f}, total today: {usage.characters_translated} chars"
            )

        except Exception as e:
            logger.error(f"Failed to track translation usage: {e}")
            await session.rollback()

    async def get_usage_stats(
        self, session: AsyncSession, days: int = 30
    ) -> dict[str, dict]:
        """
        Get translation usage statistics.

        Args:
            session: Database session
            days: Number of days to look back

        Returns:
            Dictionary with stats per provider:
            {
                "deepl": {
                    "characters": 123456,
                    "cost_usd": 0.0,
                    "messages": 1000
                },
                "google": {...}
            }
        """
        from datetime import timedelta

        start_date = date.today() - timedelta(days=days)

        result = await session.execute(
            select(TranslationUsage).where(TranslationUsage.date >= start_date)
        )
        usage_records = result.scalars().all()

        stats = {}
        for provider in TranslationProvider:
            provider_records = [
                r for r in usage_records if r.provider == provider.value
            ]

            stats[provider.value] = {
                "characters": sum(r.characters_translated for r in provider_records),
                "cost_usd": sum(r.cost_usd or 0.0 for r in provider_records),
                "messages": sum(r.message_count or 0 for r in provider_records),
            }

        return stats
