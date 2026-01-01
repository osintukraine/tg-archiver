"""
Circuit Breaker Pattern for LLM Tasks.

Protects against slow or failing LLM calls by tracking failures and
temporarily disabling the circuit when a threshold is exceeded.

States:
- CLOSED: Normal operation, requests flow through
- OPEN: Circuit tripped, requests blocked (fast fail)
- HALF_OPEN: Testing if service recovered, allow one request

Usage:
    breaker = CircuitBreaker(
        failure_threshold=5,        # 5 consecutive failures to open
        timeout_threshold=30.0,     # 30s per message = too slow
        recovery_time=300,          # 5 minutes before retry
    )

    if breaker.is_open():
        logger.warning("Circuit open, skipping batch")
        return 0

    try:
        result = await process_batch(messages)
        time_per_msg = elapsed / len(messages)

        if time_per_msg > breaker.timeout_threshold:
            breaker.record_slow()
        else:
            breaker.record_success()

        return result
    except Exception as e:
        breaker.record_failure()
        raise
"""

import logging
import time
from dataclasses import dataclass, field
from enum import Enum
from typing import Optional

logger = logging.getLogger(__name__)


class CircuitState(Enum):
    """Circuit breaker states."""
    CLOSED = "closed"      # Normal operation
    OPEN = "open"          # Blocking requests
    HALF_OPEN = "half_open"  # Testing recovery


@dataclass
class CircuitBreaker:
    """
    Circuit breaker for protecting against slow/failing tasks.

    Tracks consecutive failures and slow responses. When threshold is
    exceeded, opens the circuit to prevent wasting resources on a
    failing service. After recovery_time, allows one test request.

    Attributes:
        failure_threshold: Consecutive failures to trip circuit
        timeout_threshold: Response time (per message) considered "slow"
        recovery_time: Seconds to wait before testing recovery
    """

    failure_threshold: int = 5
    timeout_threshold: float = 30.0
    recovery_time: int = 300  # 5 minutes

    # Internal state
    state: CircuitState = field(default=CircuitState.CLOSED)
    failure_count: int = field(default=0)
    slow_count: int = field(default=0)
    last_failure_time: Optional[float] = field(default=None)
    last_state_change: Optional[float] = field(default=None)

    # Statistics
    total_successes: int = field(default=0)
    total_failures: int = field(default=0)
    total_slow: int = field(default=0)
    times_opened: int = field(default=0)

    def __post_init__(self) -> None:
        """Initialize timestamps."""
        self.last_state_change = time.time()

    def is_open(self) -> bool:
        """
        Check if circuit is open (blocking requests).

        If circuit is open and recovery time has passed, transition
        to half-open to allow a test request.

        Returns:
            True if circuit is open and should block requests
        """
        if self.state == CircuitState.OPEN:
            # Check if recovery time has elapsed
            if self._recovery_time_elapsed():
                self._transition_to(CircuitState.HALF_OPEN)
                logger.info(
                    f"CircuitBreaker: OPEN → HALF_OPEN "
                    f"(recovery time {self.recovery_time}s elapsed, allowing test request)"
                )
                return False
            return True

        return False

    def is_closed(self) -> bool:
        """Check if circuit is closed (normal operation)."""
        return self.state == CircuitState.CLOSED

    def is_half_open(self) -> bool:
        """Check if circuit is half-open (testing recovery)."""
        return self.state == CircuitState.HALF_OPEN

    def record_success(self) -> None:
        """
        Record a successful request.

        Resets failure count. If in half-open state, transitions to closed.
        """
        self.failure_count = 0
        self.slow_count = 0
        self.total_successes += 1

        if self.state == CircuitState.HALF_OPEN:
            self._transition_to(CircuitState.CLOSED)
            logger.info("CircuitBreaker: HALF_OPEN → CLOSED (service recovered)")

    def record_failure(self) -> None:
        """
        Record a failed request.

        Increments failure count. If threshold exceeded, opens circuit.
        If in half-open state, immediately reopens circuit.
        """
        self.failure_count += 1
        self.total_failures += 1
        self.last_failure_time = time.time()

        if self.state == CircuitState.HALF_OPEN:
            # Test request failed, reopen circuit
            self._transition_to(CircuitState.OPEN)
            self.times_opened += 1
            logger.warning(
                "CircuitBreaker: HALF_OPEN → OPEN "
                "(test request failed, reopening circuit)"
            )
        elif self.failure_count >= self.failure_threshold:
            self._transition_to(CircuitState.OPEN)
            self.times_opened += 1
            logger.error(
                f"CircuitBreaker: CLOSED → OPEN "
                f"({self.failure_count} consecutive failures)"
            )

    def record_slow(self) -> None:
        """
        Record a slow response (above timeout_threshold).

        Treated similarly to failures - too many slow responses
        will trip the circuit.
        """
        self.slow_count += 1
        self.total_slow += 1
        self.last_failure_time = time.time()

        if self.state == CircuitState.HALF_OPEN:
            # Test request was slow, reopen circuit
            self._transition_to(CircuitState.OPEN)
            self.times_opened += 1
            logger.warning(
                "CircuitBreaker: HALF_OPEN → OPEN "
                "(test request too slow, reopening circuit)"
            )
        elif self.slow_count >= self.failure_threshold:
            self._transition_to(CircuitState.OPEN)
            self.times_opened += 1
            logger.error(
                f"CircuitBreaker: CLOSED → OPEN "
                f"({self.slow_count} consecutive slow responses, "
                f"threshold={self.timeout_threshold}s)"
            )

    def time_until_retry(self) -> int:
        """
        Seconds until circuit will attempt recovery.

        Returns:
            Seconds remaining, or 0 if not in open state
        """
        if self.state != CircuitState.OPEN or self.last_failure_time is None:
            return 0

        elapsed = time.time() - self.last_failure_time
        remaining = self.recovery_time - elapsed
        return max(0, int(remaining))

    def reset(self) -> None:
        """
        Reset circuit breaker to initial state.

        Use after manual intervention or configuration change.
        """
        self.state = CircuitState.CLOSED
        self.failure_count = 0
        self.slow_count = 0
        self.last_failure_time = None
        self.last_state_change = time.time()
        logger.info("CircuitBreaker: Reset to CLOSED state")

    def get_stats(self) -> dict:
        """
        Get circuit breaker statistics.

        Returns:
            Dictionary with statistics
        """
        return {
            "state": self.state.value,
            "failure_count": self.failure_count,
            "slow_count": self.slow_count,
            "total_successes": self.total_successes,
            "total_failures": self.total_failures,
            "total_slow": self.total_slow,
            "times_opened": self.times_opened,
            "time_until_retry": self.time_until_retry(),
            "thresholds": {
                "failure_threshold": self.failure_threshold,
                "timeout_threshold": self.timeout_threshold,
                "recovery_time": self.recovery_time,
            },
        }

    def _recovery_time_elapsed(self) -> bool:
        """Check if recovery time has elapsed since last failure."""
        if self.last_failure_time is None:
            return True
        return (time.time() - self.last_failure_time) >= self.recovery_time

    def _transition_to(self, new_state: CircuitState) -> None:
        """Transition to a new state."""
        self.state = new_state
        self.last_state_change = time.time()
