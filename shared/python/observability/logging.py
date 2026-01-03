"""
Structured JSON Logging for Telegram Archiver.

Provides consistent JSON-formatted logs across all services for log aggregation (Loki).

Usage:
    from observability.logging import setup_logging, get_logger

    # In main.py or startup:
    setup_logging(service_name="processor")

    # In any module:
    logger = get_logger(__name__)
    logger.info("Processing message", extra={"message_id": 123, "channel": "example_channel"})

Output format:
    {"timestamp": "2025-12-01T00:45:00.123Z", "level": "INFO", "service": "processor",
     "logger": "message_processor", "message": "Processing message",
     "message_id": 123, "channel": "example_channel", "trace_id": "abc123"}
"""

import logging
import os
import sys
from datetime import datetime, timezone
from typing import Optional
import json

# Thread-local storage for trace_id context
import threading
_context = threading.local()


def get_trace_id() -> Optional[str]:
    """Get the current trace ID from context."""
    return getattr(_context, 'trace_id', None)


def set_trace_id(trace_id: str) -> None:
    """Set the trace ID in context."""
    _context.trace_id = trace_id


def clear_trace_id() -> None:
    """Clear the trace ID from context."""
    _context.trace_id = None


class JSONFormatter(logging.Formatter):
    """
    Custom JSON formatter for structured logging.

    Outputs JSON with consistent fields for log aggregation systems like Loki.
    """

    def __init__(self, service_name: str = "unknown"):
        super().__init__()
        self.service_name = service_name

    def format(self, record: logging.LogRecord) -> str:
        """Format the log record as JSON."""
        # Base log entry
        log_entry = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "service": self.service_name,
            "logger": record.name,
            "message": record.getMessage(),
        }

        # Add trace_id if available in context
        trace_id = get_trace_id()
        if trace_id:
            log_entry["trace_id"] = trace_id

        # Add exception info if present
        if record.exc_info:
            log_entry["exception"] = self.formatException(record.exc_info)

        # Add file/line info for errors
        if record.levelno >= logging.ERROR:
            log_entry["file"] = record.pathname
            log_entry["line"] = record.lineno
            log_entry["function"] = record.funcName

        # Add any extra fields passed via extra={}
        # Skip internal logging fields
        skip_fields = {
            'name', 'msg', 'args', 'levelname', 'levelno', 'pathname',
            'filename', 'module', 'lineno', 'funcName', 'created',
            'thread', 'threadName', 'processName', 'process', 'exc_info',
            'exc_text', 'stack_info', 'message', 'msecs', 'relativeCreated',
            'taskName'
        }
        for key, value in record.__dict__.items():
            if key not in skip_fields and not key.startswith('_'):
                # Handle non-serializable values
                try:
                    json.dumps(value)  # Test if serializable
                    log_entry[key] = value
                except (TypeError, ValueError):
                    log_entry[key] = str(value)

        return json.dumps(log_entry, ensure_ascii=False, default=str)


class ConsoleFormatter(logging.Formatter):
    """
    Human-readable console formatter for local development.

    Format: [LEVEL] service/logger: message {extra_fields}
    """

    COLORS = {
        'DEBUG': '\033[36m',    # Cyan
        'INFO': '\033[32m',     # Green
        'WARNING': '\033[33m',  # Yellow
        'ERROR': '\033[31m',    # Red
        'CRITICAL': '\033[35m', # Magenta
    }
    RESET = '\033[0m'

    def __init__(self, service_name: str = "unknown", use_colors: bool = True):
        super().__init__()
        self.service_name = service_name
        self.use_colors = use_colors and sys.stderr.isatty()

    def format(self, record: logging.LogRecord) -> str:
        """Format the log record for console output."""
        # Extract extra fields
        skip_fields = {
            'name', 'msg', 'args', 'levelname', 'levelno', 'pathname',
            'filename', 'module', 'lineno', 'funcName', 'created',
            'thread', 'threadName', 'processName', 'process', 'exc_info',
            'exc_text', 'stack_info', 'message', 'msecs', 'relativeCreated',
            'taskName'
        }
        extra = {k: v for k, v in record.__dict__.items()
                 if k not in skip_fields and not k.startswith('_')}

        # Build message
        level = record.levelname
        if self.use_colors:
            color = self.COLORS.get(level, '')
            level = f"{color}{level}{self.RESET}"

        # Short logger name (last component)
        logger_name = record.name.split('.')[-1]

        # Format extra fields
        extra_str = ""
        if extra:
            extra_items = [f"{k}={v}" for k, v in extra.items()]
            extra_str = f" {{{', '.join(extra_items)}}}"

        # Add trace_id if available
        trace_id = get_trace_id()
        trace_str = f" [{trace_id[:8]}]" if trace_id else ""

        message = f"[{level}] {self.service_name}/{logger_name}:{trace_str} {record.getMessage()}{extra_str}"

        # Add exception info if present
        if record.exc_info:
            message += f"\n{self.formatException(record.exc_info)}"

        return message


def setup_logging(
    service_name: str,
    level: str = None,
    json_format: bool = None,
) -> None:
    """
    Configure structured logging for a service.

    Args:
        service_name: Name of the service (e.g., "processor", "api", "listener")
        level: Log level (DEBUG, INFO, WARNING, ERROR). Defaults to LOG_LEVEL env var or INFO.
        json_format: Whether to use JSON format. Defaults to LOG_FORMAT=json env var or False.

    Environment variables:
        LOG_LEVEL: Default log level (DEBUG, INFO, WARNING, ERROR, CRITICAL)
        LOG_FORMAT: "json" for JSON output, anything else for console

    Example:
        setup_logging("processor")
        logger = get_logger(__name__)
        logger.info("Starting processor", extra={"workers": 4})
    """
    # Determine log level
    if level is None:
        level = os.environ.get("LOG_LEVEL", "INFO").upper()
    log_level = getattr(logging, level, logging.INFO)

    # Determine format - default to JSON for Loki aggregation
    if json_format is None:
        # Default to JSON unless explicitly set to "console"
        json_format = os.environ.get("LOG_FORMAT", "json").lower() != "console"

    # Get root logger
    root_logger = logging.getLogger()
    root_logger.setLevel(log_level)

    # Remove existing handlers
    root_logger.handlers.clear()

    # Create handler
    handler = logging.StreamHandler(sys.stderr)
    handler.setLevel(log_level)

    # Set formatter based on format choice
    if json_format:
        formatter = JSONFormatter(service_name=service_name)
    else:
        formatter = ConsoleFormatter(service_name=service_name)

    handler.setFormatter(formatter)
    root_logger.addHandler(handler)

    # Also configure specific loggers that might be noisy
    logging.getLogger("urllib3").setLevel(logging.WARNING)
    logging.getLogger("httpx").setLevel(logging.WARNING)
    logging.getLogger("telethon").setLevel(logging.WARNING)
    logging.getLogger("asyncio").setLevel(logging.WARNING)

    # Log startup message
    logger = logging.getLogger(__name__)
    logger.info(
        f"Logging initialized",
        extra={
            "log_level": level,
            "json_format": json_format,
        }
    )


def get_logger(name: str) -> logging.Logger:
    """
    Get a logger instance.

    Args:
        name: Logger name, typically __name__

    Returns:
        Logger instance

    Example:
        logger = get_logger(__name__)
        logger.info("Processing", extra={"count": 10})
    """
    return logging.getLogger(name)


class LogContext:
    """
    Context manager for setting trace_id during request/message processing.

    Usage:
        with LogContext(trace_id="abc123"):
            logger.info("Processing")  # Will include trace_id in log
    """

    def __init__(self, trace_id: str):
        self.trace_id = trace_id
        self.previous_trace_id = None

    def __enter__(self):
        self.previous_trace_id = get_trace_id()
        set_trace_id(self.trace_id)
        return self

    def __exit__(self, exc_type, exc_val, exc_tb):
        if self.previous_trace_id:
            set_trace_id(self.previous_trace_id)
        else:
            clear_trace_id()
        return False
