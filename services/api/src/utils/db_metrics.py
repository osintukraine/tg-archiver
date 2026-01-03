"""Database connection pool monitoring metrics."""

import asyncio
import logging
from typing import Optional

from prometheus_client import Gauge

logger = logging.getLogger(__name__)

# Prometheus gauges for pool monitoring
db_pool_size = Gauge(
    'db_pool_size',
    'Current number of connections in pool (lazy growth)'
)

db_pool_max_size = Gauge(
    'db_pool_max_size',
    'Configured maximum pool size (pool_size + max_overflow)'
)

db_pool_checked_out = Gauge(
    'db_pool_checked_out',
    'Number of connections currently checked out from pool'
)

db_pool_overflow = Gauge(
    'db_pool_overflow',
    'Number of overflow connections in use'
)

db_pool_available = Gauge(
    'db_pool_available',
    'Number of available connections in pool'
)

_monitor_task: Optional[asyncio.Task] = None


async def start_pool_monitoring(engine, interval: int = 15) -> None:
    """
    Start background task to update pool metrics.

    Args:
        engine: SQLAlchemy async engine
        interval: Update interval in seconds
    """
    global _monitor_task

    # Get configured limits from engine (these don't change at runtime)
    # SQLAlchemy QueuePool stores these as private attributes
    pool = engine.pool
    configured_pool_size = getattr(pool, '_pool_size', 40)
    configured_max_overflow = getattr(pool, '_max_overflow', 40)
    max_capacity = configured_pool_size + configured_max_overflow

    # Set the max size gauge once (it's static)
    db_pool_max_size.set(max_capacity)
    logger.info(
        f"Pool configuration: pool_size={configured_pool_size}, "
        f"max_overflow={configured_max_overflow}, max_capacity={max_capacity}"
    )

    async def update_metrics():
        while True:
            try:
                pool = engine.pool

                db_pool_size.set(pool.size())
                db_pool_checked_out.set(pool.checkedout())
                db_pool_overflow.set(pool.overflow())

                # Available = configured max - currently in use
                in_use = pool.checkedout() + pool.overflow()
                available = max(0, max_capacity - in_use)
                db_pool_available.set(available)

                # Calculate utilization against CONFIGURED max, not current pool size
                # This prevents false alarms during pool warmup
                utilization = in_use / max_capacity if max_capacity > 0 else 0
                if utilization > 0.8:
                    logger.warning(
                        f"Database pool utilization high: {utilization:.1%} "
                        f"({in_use}/{max_capacity} connections)"
                    )

            except Exception as e:
                logger.error(f"Error updating pool metrics: {e}")

            await asyncio.sleep(interval)

    _monitor_task = asyncio.create_task(update_metrics())
    logger.info(f"Started database pool monitoring (interval={interval}s)")


async def stop_pool_monitoring() -> None:
    """Stop the pool monitoring background task."""
    global _monitor_task

    if _monitor_task is not None:
        _monitor_task.cancel()
        try:
            await _monitor_task
        except asyncio.CancelledError:
            pass
        _monitor_task = None
        logger.info("Stopped database pool monitoring")
