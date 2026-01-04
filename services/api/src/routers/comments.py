"""
Comments API - Public endpoints for comment operations.

Provides:
- On-demand translation of individual comments
- Comment retrieval with translation status
"""

import logging
from datetime import datetime, timezone
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel
from sqlalchemy import text, update
from sqlalchemy.ext.asyncio import AsyncSession

from ..database import get_db

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/api/comments", tags=["comments"])


# Lazy-loaded translator singleton
_translator = None


def get_translator():
    """
    Get or create CommentTranslator singleton instance.

    Lazy-loads the CommentTranslator to avoid import errors if translation
    dependencies are not available. The instance is cached globally to avoid
    re-initialization overhead.

    Returns:
        CommentTranslator instance configured for English translation, or None if unavailable
    """
    global _translator
    if _translator is None:
        try:
            from translation.translator import CommentTranslator
            _translator = CommentTranslator(target_language="en")
            logger.info("CommentTranslator initialized for API")
        except ImportError as e:
            logger.warning(f"Could not import CommentTranslator: {e}")
            _translator = None
    return _translator


class TranslateResponse(BaseModel):
    """Response from translation request."""
    comment_id: int
    original_content: str
    translated_content: Optional[str]
    original_language: str
    translation_method: str  # "google_free", "deepl_free", "cached", "none"
    cached: bool  # True if translation was already in database


class CommentResponse(BaseModel):
    """Comment with translation info."""
    id: int
    content: str
    translated_content: Optional[str]
    original_language: Optional[str]
    translation_method: Optional[str]
    author_user_id: Optional[int]
    created_at: Optional[datetime]
    has_translation: bool


@router.post("/{comment_id}/translate", response_model=TranslateResponse)
async def translate_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Translate a comment on-demand with caching.

    This endpoint provides on-demand translation for message comments (Telegram replies),
    automatically detecting the source language and translating to English. Translation
    results are permanently cached in the database to avoid redundant API calls.

    Translation Strategy:
    - First checks if translation already exists (returns cached result)
    - Detects source language using language detection
    - Skips translation if content is already English
    - Uses DeepL Free API (primary) or Google Translate Free (fallback)
    - Stores translation permanently for future requests

    Translation Methods:
    - "cached": Translation was already in database
    - "deepl_free": Translated via DeepL Free API
    - "google_free": Translated via Google Translate Free
    - "none": Content was already English or empty

    Args:
        comment_id: Database ID of the message comment to translate
        db: Database session

    Returns:
        TranslateResponse containing:
        - comment_id: The comment database ID
        - original_content: Original comment text
        - translated_content: English translation (or None if no content)
        - original_language: ISO language code (e.g., "ru", "uk", "en")
        - translation_method: Method used for translation
        - cached: True if translation was retrieved from database

    Raises:
        HTTPException 404: Comment not found
        HTTPException 503: Translation service unavailable
        HTTPException 502: Translation API call failed
        HTTPException 500: Unexpected translation error
    """
    # Fetch the comment
    query = text("""
        SELECT
            id,
            content,
            content_translated,
            language_detected,
            translation_method
        FROM message_comments
        WHERE id = :comment_id
    """)

    result = await db.execute(query, {"comment_id": comment_id})
    comment = result.fetchone()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    # If already translated, return cached
    if comment.content_translated:
        return TranslateResponse(
            comment_id=comment.id,
            original_content=comment.content or "",
            translated_content=comment.content_translated,
            original_language=comment.language_detected or "unknown",
            translation_method="cached",
            cached=True,
        )

    # No content to translate
    if not comment.content or len(comment.content.strip()) == 0:
        return TranslateResponse(
            comment_id=comment.id,
            original_content="",
            translated_content=None,
            original_language="unknown",
            translation_method="none",
            cached=False,
        )

    # Get translator
    translator = get_translator()
    if not translator:
        raise HTTPException(
            status_code=503,
            detail="Translation service unavailable"
        )

    # Detect language and translate
    try:
        original_lang, lang_confidence = translator.detect_language(comment.content)

        # Skip if already English
        if original_lang == "en":
            # Store as "already English"
            await db.execute(
                text("""
                    UPDATE message_comments
                    SET language_detected = 'en',
                        content_translated = content,
                        translation_method = 'none',
                        translation_confidence = 1.0,
                        translated_at = :now
                    WHERE id = :comment_id
                """),
                {"comment_id": comment_id, "now": datetime.now(timezone.utc)}
            )
            await db.commit()

            return TranslateResponse(
                comment_id=comment.id,
                original_content=comment.content,
                translated_content=comment.content,
                original_language="en",
                translation_method="none",
                cached=False,
            )

        # Translate
        translated_content, translation_method, _ = await translator.translate(
            comment.content,
            source_lang=original_lang
        )

        if not translated_content:
            raise HTTPException(
                status_code=502,
                detail=f"Translation failed for language: {original_lang}"
            )

        # Store translation in database
        await db.execute(
            text("""
                UPDATE message_comments
                SET language_detected = :original_lang,
                    content_translated = :translated_content,
                    translation_method = :translation_method,
                    translation_confidence = :confidence,
                    translated_at = :now
                WHERE id = :comment_id
            """),
            {
                "comment_id": comment_id,
                "original_lang": original_lang,
                "translated_content": translated_content,
                "translation_method": translation_method,
                "confidence": lang_confidence,
                "now": datetime.now(timezone.utc),
            }
        )
        await db.commit()

        logger.info(f"Translated comment {comment_id}: {original_lang} -> en via {translation_method}")

        return TranslateResponse(
            comment_id=comment.id,
            original_content=comment.content,
            translated_content=translated_content,
            original_language=original_lang,
            translation_method=translation_method,
            cached=False,
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Translation error for comment {comment_id}: {e}")
        raise HTTPException(status_code=500, detail=f"Translation error: {str(e)}")


@router.get("/{comment_id}", response_model=CommentResponse)
async def get_comment(
    comment_id: int,
    db: AsyncSession = Depends(get_db),
):
    """
    Retrieve a single comment with its translation status.

    Fetches complete comment information including original content, cached translation
    (if available), author information, and translation metadata. Use this endpoint to
    check if a comment has been translated before calling the translate endpoint.

    Translation Status:
    - has_translation=True: Translation exists in database (either cached or pre-translated)
    - has_translation=False: No translation available, use POST /comments/{id}/translate
    - translation_method: Indicates how the translation was performed

    Args:
        comment_id: Database ID of the message comment
        db: Database session

    Returns:
        CommentResponse containing:
        - id: Comment database ID
        - content: Original comment text
        - translated_content: Cached English translation (None if not yet translated)
        - original_language: ISO language code (None if not yet detected)
        - translation_method: Translation method used (None if not yet translated)
        - author_user_id: Telegram user ID of comment author
        - created_at: When the comment was posted on Telegram
        - has_translation: Boolean flag indicating if translation exists

    Raises:
        HTTPException 404: Comment not found
    """
    query = text("""
        SELECT
            id,
            content,
            content_translated,
            language_detected,
            translation_method,
            author_user_id,
            comment_date as created_at
        FROM message_comments
        WHERE id = :comment_id
    """)

    result = await db.execute(query, {"comment_id": comment_id})
    comment = result.fetchone()

    if not comment:
        raise HTTPException(status_code=404, detail="Comment not found")

    return CommentResponse(
        id=comment.id,
        content=comment.content or "",
        translated_content=comment.content_translated,
        original_language=comment.language_detected,
        translation_method=comment.translation_method,
        author_user_id=comment.author_user_id,
        created_at=comment.created_at,
        has_translation=comment.content_translated is not None,
    )
