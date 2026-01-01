# services/processor/src/backpressure.py
"""
Backpressure management for graceful degradation under load.

Monitors queue depth and progressively reduces non-essential processing
to prevent queue overflow and message loss.
"""

import logging
from dataclasses import dataclass
from enum import Enum
from typing import Dict

from prometheus_client import Gauge

logger = logging.getLogger(__name__)


class BackpressureLevel(Enum):
    NORMAL = "normal"
    WARNING = "warning"
    CRITICAL = "critical"
    EMERGENCY = "emergency"


# Prometheus metric
backpressure_level_gauge = Gauge(
    'processor_backpressure_level',
    'Current backpressure level (0=normal, 1=warning, 2=critical, 3=emergency)'
)


@dataclass
class BackpressureConfig:
    """Configuration for backpressure thresholds."""
    warning_threshold: int = 5000
    critical_threshold: int = 8000
    emergency_threshold: int = 9500


class BackpressureManager:
    """
    Manages backpressure based on queue depth.

    Levels:
    - NORMAL (< 5000): All features enabled
    - WARNING (5000-8000): Log warnings, consider scaling
    - CRITICAL (8000-9500): Disable translation, reduce LLM features
    - EMERGENCY (> 9500): Pause non-critical ingestion
    """

    def __init__(
        self,
        warning_threshold: int = 5000,
        critical_threshold: int = 8000,
        emergency_threshold: int = 9500,
    ) -> None:
        self.config = BackpressureConfig(
            warning_threshold=warning_threshold,
            critical_threshold=critical_threshold,
            emergency_threshold=emergency_threshold,
        )
        self._current_level = BackpressureLevel.NORMAL

    def check_level(self, queue_depth: int) -> str:
        """
        Determine backpressure level based on queue depth.

        Args:
            queue_depth: Current number of messages in queue

        Returns:
            Level name as string
        """
        if queue_depth >= self.config.emergency_threshold:
            level = BackpressureLevel.EMERGENCY
        elif queue_depth >= self.config.critical_threshold:
            level = BackpressureLevel.CRITICAL
        elif queue_depth >= self.config.warning_threshold:
            level = BackpressureLevel.WARNING
        else:
            level = BackpressureLevel.NORMAL

        # Update Prometheus metric
        backpressure_level_gauge.set(list(BackpressureLevel).index(level))

        # Log level changes
        if level != self._current_level:
            logger.warning(
                f"Backpressure level changed: {self._current_level.value} -> {level.value} "
                f"(queue_depth={queue_depth})"
            )
            self._current_level = level

        return level.value

    def get_active_features(self, queue_depth: int) -> Dict[str, bool]:
        """
        Get which features should be active based on queue depth.

        Args:
            queue_depth: Current queue depth

        Returns:
            Dict of feature names to enabled status
        """
        level = self.check_level(queue_depth)

        # Features that are always required
        always_on = {
            "spam_filter": True,
            "media_archival": True,  # URLs expire, must archive
            "database_persistence": True,
        }

        # Features that can be deferred
        if level == "normal":
            return {
                **always_on,
                "llm_classification": True,
                "translation": True,
                "entity_extraction": True,
            }
        elif level == "warning":
            return {
                **always_on,
                "llm_classification": True,
                "translation": True,  # Still enabled
                "entity_extraction": True,
            }
        elif level == "critical":
            logger.warning("CRITICAL backpressure: Disabling translation")
            return {
                **always_on,
                "llm_classification": True,
                "translation": False,  # Defer to enrichment
                "entity_extraction": True,
            }
        else:  # emergency
            logger.error("EMERGENCY backpressure: Minimal processing only")
            return {
                **always_on,
                "llm_classification": True,  # Still needed for archive decision
                "translation": False,
                "entity_extraction": False,  # Defer to enrichment
            }

    @property
    def current_level(self) -> BackpressureLevel:
        return self._current_level
