"""
Box Selector - Round-robin storage box selection with tolerance band.

Implements box selection algorithm recommended by full-stack architect:
- Filter eligible boxes (active, not full, not readonly, below high water mark)
- Round-robin within 5% usage tolerance band (avoids hot-spotting)
- Tracks last-used for rotation
"""

import logging
from typing import Dict, Optional
from sqlalchemy import select, and_
from sqlalchemy.ext.asyncio import AsyncSession

from models.storage import StorageBox

logger = logging.getLogger(__name__)

# Tolerance band: boxes within this % of lowest usage are equally eligible
USAGE_TOLERANCE_PERCENT = 5.0


class BoxSelector:
    """
    Selects storage box for new uploads using round-robin with tolerance.

    Algorithm:
    1. Query eligible boxes (can_accept_writes = True)
    2. Find box with lowest usage percentage
    3. Filter boxes within USAGE_TOLERANCE_PERCENT of lowest
    4. Round-robin among filtered boxes

    This prevents:
    - Hot-spotting on single "least full" box
    - Writes to nearly-full boxes
    - Writes to readonly or inactive boxes

    Usage:
        selector = BoxSelector()
        box = await selector.select_box(session, region="russia")
        # Use box.id for media archival
    """

    def __init__(self):
        """Initialize selector with round-robin state."""
        self._last_selected: Dict[str, int] = {}  # region -> last index

    async def select_box(
        self,
        session: AsyncSession,
        region: Optional[str] = None,
    ) -> Optional[StorageBox]:
        """
        Select the best storage box for a new upload.

        Args:
            session: Database session
            region: Optional region filter (e.g., "russia", "ukraine")

        Returns:
            StorageBox: Selected box, or None if no eligible boxes
        """
        # Query eligible boxes
        filters = [
            StorageBox.is_active == True,
            StorageBox.is_full == False,
            StorageBox.is_readonly == False,
        ]

        if region:
            filters.append(StorageBox.account_region == region)

        result = await session.execute(
            select(StorageBox)
            .where(and_(*filters))
            .order_by(StorageBox.priority, StorageBox.used_bytes)
        )
        boxes = list(result.scalars().all())

        if not boxes:
            logger.warning(f"No eligible storage boxes for region={region}")
            return None

        # Filter boxes above high water mark
        eligible = [b for b in boxes if not b.is_above_water_mark]
        if not eligible:
            logger.warning(f"All boxes above high water mark for region={region}")
            # Fall back to least full box as last resort
            eligible = boxes[:1]

        if len(eligible) == 1:
            return eligible[0]

        # Find tolerance band
        lowest_usage = min(b.usage_percent for b in eligible)
        threshold = lowest_usage + USAGE_TOLERANCE_PERCENT

        in_band = [b for b in eligible if b.usage_percent <= threshold]
        logger.debug(
            f"Box selection: {len(in_band)}/{len(eligible)} boxes in {USAGE_TOLERANCE_PERCENT}% band "
            f"(lowest={lowest_usage:.1f}%, threshold={threshold:.1f}%)"
        )

        # Round-robin within band
        region_key = region or "default"
        last_idx = self._last_selected.get(region_key, -1)
        next_idx = (last_idx + 1) % len(in_band)
        self._last_selected[region_key] = next_idx

        selected = in_band[next_idx]
        logger.info(
            f"Selected storage box: {selected.id} "
            f"(usage={selected.usage_percent:.1f}%, region={region_key})"
        )

        return selected

    async def get_box_for_file(
        self,
        session: AsyncSession,
        file_size_bytes: int,
        region: Optional[str] = None,
        _excluded_ids: Optional[set] = None,
    ) -> Optional[StorageBox]:
        """
        Select box and reserve capacity for a file.

        Args:
            session: Database session
            file_size_bytes: Size of file to upload
            region: Optional region filter
            _excluded_ids: Internal param - box IDs to skip (for recursion)

        Returns:
            StorageBox: Selected box with reserved capacity
        """
        excluded = _excluded_ids or set()

        # Try to find a non-excluded box (with iteration limit to prevent infinite loop)
        max_attempts = 100  # Safety limit - should never have 100+ storage boxes
        for attempt in range(max_attempts):
            box = await self.select_box(session, region)
            if not box:
                logger.warning(f"No eligible storage boxes for file size {file_size_bytes}")
                return None
            if box.id not in excluded:
                break
            # All boxes in the selection pool are excluded
            if attempt > 0 and attempt >= len(excluded):
                logger.warning(f"All eligible boxes excluded ({len(excluded)} boxes tried)")
                return None
        else:
            logger.error(f"Box selection exceeded {max_attempts} attempts")
            return None

        # Check if file fits
        if file_size_bytes > box.available_bytes:
            logger.warning(
                f"File too large for {box.id}: {file_size_bytes} > {box.available_bytes} available"
            )
            # Try next box without mutating database state
            excluded.add(box.id)
            return await self.get_box_for_file(
                session, file_size_bytes, region, _excluded_ids=excluded
            )

        # Reserve capacity (caller controls transaction commit)
        box.reserved_bytes += file_size_bytes

        return box
