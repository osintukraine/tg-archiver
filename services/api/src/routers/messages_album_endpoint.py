"""
Album Media Endpoint (to be added to messages.py)

Add this endpoint to services/api/src/routers/messages.py:
"""

# 1. Add to imports:
# from ..schemas import ..., AlbumMediaResponse, AlbumMediaItem

# 2. Add this endpoint after get_message():

@router.get("/{message_id}/album", response_model=AlbumMediaResponse)
async def get_message_album(
    message_id: int,
    db: AsyncSession = Depends(get_db)
):
    """
    Get all media files for a message's album (Phase 2 - Lightbox support).

    Returns:
    - If message has grouped_id: Returns all media from all messages in that album
    - If no grouped_id: Returns just that message's media
    - Ordered by message_id ASC (chronological order within album)

    Use case: User clicks album card in gallery, lightbox shows all 3+ photos with navigation.

    Example:
    - Single photo: GET /api/messages/123/album → 1 media item
    - Album (3 photos): GET /api/messages/124/album → 3 media items
    """
    # Get the message
    result = await db.execute(
        select(Message).where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail=f"Message {message_id} not found")

    # Build query for album media
    if message.grouped_id:
        # Part of album: get all messages in this grouped album
        query = (
            select(Message, MediaFile)
            .join(MessageMedia, Message.id == MessageMedia.message_id)
            .join(MediaFile, MessageMedia.media_id == MediaFile.id)
            .where(Message.grouped_id == message.grouped_id)
            .order_by(Message.id.asc())  # Chronological within album
        )
    else:
        # Single message: just return its media
        query = (
            select(Message, MediaFile)
            .join(MessageMedia, Message.id == MessageMedia.message_id)
            .join(MediaFile, MessageMedia.media_id == MediaFile.id)
            .where(Message.id == message_id)
        )

    result = await db.execute(query)
    rows = result.all()

    # Build response
    media_items = []
    current_index = 0

    for idx, (msg, media) in enumerate(rows):
        # Track which media item corresponds to the clicked message
        if msg.id == message_id:
            current_index = idx

        media_items.append(AlbumMediaItem(
            message_id=msg.id,
            media_id=media.id,
            # Use get_media_url() from utils for configurable media URLs
            # media_url=get_media_url(media.s3_key),
            media_url=get_media_url(media.s3_key),
            media_type=msg.media_type or "unknown",
            mime_type=media.mime_type,
            file_size=media.file_size,
            sha256=media.sha256,
            content=msg.content,  # Caption for this specific photo
            telegram_date=msg.telegram_date,
        ))

    return AlbumMediaResponse(
        grouped_id=message.grouped_id,
        album_size=len(media_items),
        current_index=current_index,
        media=media_items,
    )
