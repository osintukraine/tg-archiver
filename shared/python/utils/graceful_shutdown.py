"""
Graceful shutdown utilities for async services.

This module provides centralized shutdown handling to eliminate duplication
across services that need to handle SIGTERM and SIGINT signals.

Usage:
    # Option 1: Class-based approach (recommended)
    async def main():
        shutdown = GracefulShutdown()
        shutdown.setup_handlers()

        async with shutdown.run_until_shutdown():
            await start_services()
            await shutdown.wait_for_shutdown()

        await cleanup()

    # Option 2: Simple function for backwards compatibility
    async def main():
        shutdown_event = asyncio.Event()
        setup_signal_handlers(shutdown_event)

        await start_services()
        await shutdown_event.wait()
        await cleanup()

    # Option 3: Manual control
    shutdown = GracefulShutdown()
    shutdown.setup_handlers()

    while not shutdown.is_shutdown_requested():
        await process_batch()

    await cleanup()
"""

import asyncio
import signal
import logging
from contextlib import asynccontextmanager
from typing import Optional, AsyncIterator

logger = logging.getLogger(__name__)


class GracefulShutdown:
    """
    Manages graceful shutdown for async services.

    Provides a unified interface for handling SIGTERM and SIGINT signals,
    with support for async waiting and context managers.

    Attributes:
        shutdown_event: The underlying asyncio.Event for shutdown signaling.

    Example:
        >>> shutdown = GracefulShutdown()
        >>> shutdown.setup_handlers()
        >>>
        >>> # In your main loop
        >>> while not shutdown.is_shutdown_requested():
        ...     await process_messages()
        >>>
        >>> # Or use the async wait
        >>> await shutdown.wait_for_shutdown()
    """

    def __init__(self, event: Optional[asyncio.Event] = None) -> None:
        """
        Initialize the shutdown handler.

        Args:
            event: Optional existing asyncio.Event to use. If None, creates a new one.
        """
        self.shutdown_event = event or asyncio.Event()
        self._handlers_installed = False

    def setup_handlers(self) -> None:
        """
        Register signal handlers for SIGTERM and SIGINT.

        This method should be called once during service initialization.
        Safe to call multiple times; subsequent calls are ignored.

        Example:
            >>> shutdown = GracefulShutdown()
            >>> shutdown.setup_handlers()
        """
        if self._handlers_installed:
            logger.debug("Signal handlers already installed, skipping")
            return

        loop = asyncio.get_running_loop()

        for sig in (signal.SIGTERM, signal.SIGINT):
            loop.add_signal_handler(
                sig,
                self._handle_signal,
                sig
            )

        self._handlers_installed = True
        logger.debug("Graceful shutdown handlers installed for SIGTERM and SIGINT")

    def _handle_signal(self, sig: signal.Signals) -> None:
        """
        Internal signal handler callback.

        Args:
            sig: The signal that was received.
        """
        logger.info(f"Received signal {sig.name}, initiating graceful shutdown")
        self.shutdown_event.set()

    def is_shutdown_requested(self) -> bool:
        """
        Check if shutdown has been requested.

        Returns:
            True if shutdown was requested, False otherwise.

        Example:
            >>> while not shutdown.is_shutdown_requested():
            ...     await process_batch()
        """
        return self.shutdown_event.is_set()

    def request_shutdown(self) -> None:
        """
        Programmatically request shutdown.

        Useful for triggering shutdown from code (e.g., on fatal error)
        rather than from a signal.

        Example:
            >>> try:
            ...     await risky_operation()
            ... except FatalError:
            ...     shutdown.request_shutdown()
        """
        logger.info("Shutdown requested programmatically")
        self.shutdown_event.set()

    async def wait_for_shutdown(self, timeout: Optional[float] = None) -> bool:
        """
        Async wait until shutdown is requested.

        Args:
            timeout: Maximum seconds to wait. None for indefinite wait.

        Returns:
            True if shutdown was requested, False if timeout occurred.

        Example:
            >>> # Wait indefinitely
            >>> await shutdown.wait_for_shutdown()
            >>>
            >>> # Wait with timeout
            >>> if await shutdown.wait_for_shutdown(timeout=30.0):
            ...     print("Shutdown requested")
            ... else:
            ...     print("Timeout reached")
        """
        try:
            await asyncio.wait_for(
                self.shutdown_event.wait(),
                timeout=timeout
            )
            return True
        except asyncio.TimeoutError:
            return False

    @asynccontextmanager
    async def run_until_shutdown(self) -> AsyncIterator['GracefulShutdown']:
        """
        Async context manager for running services until shutdown.

        Ensures signal handlers are set up and provides a clean pattern
        for service lifecycle management.

        Example:
            >>> async with shutdown.run_until_shutdown():
            ...     await start_listener()
            ...     await start_processor()
            ...     await shutdown.wait_for_shutdown()
            >>> # Context exits, run cleanup here
            >>> await cleanup()

        Yields:
            The GracefulShutdown instance for convenience.
        """
        self.setup_handlers()
        try:
            yield self
        finally:
            if not self.is_shutdown_requested():
                logger.debug("Context exited without shutdown request")


def setup_signal_handlers(shutdown_event: asyncio.Event) -> None:
    """
    Simple function to set up signal handlers for an existing event.

    This is a backwards-compatible convenience function for services
    that already use an asyncio.Event for shutdown coordination.

    Args:
        shutdown_event: The event to set when a signal is received.

    Example:
        >>> shutdown_event = asyncio.Event()
        >>> setup_signal_handlers(shutdown_event)
        >>>
        >>> # In your main loop
        >>> await shutdown_event.wait()
    """
    shutdown = GracefulShutdown(event=shutdown_event)
    shutdown.setup_handlers()
