"""
Prometheus Query Client

Utility for querying Prometheus HTTP API from the FastAPI service.
Used by /api/metrics/* endpoints to fetch real-time operational metrics.
"""

import httpx
from typing import Optional, Any
from datetime import datetime, timedelta
import asyncio
from functools import lru_cache

from config.settings import settings
from observability import get_logger

logger = get_logger(__name__)

# Prometheus server URL (internal Docker network)
PROMETHEUS_URL = getattr(settings, 'PROMETHEUS_URL', 'http://prometheus:9090')


class PrometheusClient:
    """Async client for querying Prometheus HTTP API."""

    def __init__(self, base_url: str = PROMETHEUS_URL, timeout: float = 2.0):
        """
        Initialize Prometheus client.

        Args:
            base_url: Prometheus server URL
            timeout: Request timeout in seconds (kept short to not block About page)
        """
        self.base_url = base_url.rstrip('/')
        self.timeout = timeout  # Short timeout - fail fast if Prometheus unavailable
        self._client: Optional[httpx.AsyncClient] = None

    async def _get_client(self) -> httpx.AsyncClient:
        """Lazy initialization of HTTP client."""
        if self._client is None or self._client.is_closed:
            self._client = httpx.AsyncClient(timeout=self.timeout)
        return self._client

    async def close(self):
        """Close the HTTP client."""
        if self._client and not self._client.is_closed:
            await self._client.aclose()

    async def query(self, promql: str) -> Optional[Any]:
        """
        Execute an instant query against Prometheus.

        Args:
            promql: PromQL query string

        Returns:
            Query result data or None if query fails
        """
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/api/v1/query",
                params={"query": promql}
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") == "success":
                return data.get("data", {}).get("result", [])
            else:
                logger.warning(f"Prometheus query failed: {data.get('error')}")
                return None

        except httpx.TimeoutException:
            logger.warning(f"Prometheus query timeout: {promql[:50]}...")
            return None
        except httpx.HTTPError as e:
            logger.warning(f"Prometheus HTTP error: {e}")
            return None
        except Exception as e:
            logger.error(f"Prometheus query error: {e}")
            return None

    async def query_range(
        self,
        promql: str,
        start: datetime,
        end: datetime,
        step: str = "1m"
    ) -> Optional[Any]:
        """
        Execute a range query against Prometheus.

        Args:
            promql: PromQL query string
            start: Start time
            end: End time
            step: Query resolution (e.g., "1m", "5m", "1h")

        Returns:
            Query result data or None if query fails
        """
        try:
            client = await self._get_client()
            response = await client.get(
                f"{self.base_url}/api/v1/query_range",
                params={
                    "query": promql,
                    "start": start.isoformat(),
                    "end": end.isoformat(),
                    "step": step
                }
            )
            response.raise_for_status()
            data = response.json()

            if data.get("status") == "success":
                return data.get("data", {}).get("result", [])
            return None

        except Exception as e:
            logger.warning(f"Prometheus range query error: {e}")
            return None

    async def get_scalar(self, promql: str, default: float = 0.0) -> float:
        """
        Get a single scalar value from a Prometheus query.

        Args:
            promql: PromQL query that returns a single value
            default: Default value if query fails

        Returns:
            Scalar value or default
        """
        result = await self.query(promql)
        if result and len(result) > 0:
            try:
                # Handle vector result
                value = result[0].get("value", [None, default])
                return float(value[1]) if len(value) > 1 else default
            except (IndexError, ValueError, TypeError):
                return default
        return default

    async def get_gauge(self, metric_name: str, labels: dict = None, default: float = 0.0) -> float:
        """
        Get current value of a gauge metric.

        Args:
            metric_name: Name of the metric
            labels: Optional label filters
            default: Default value if metric not found
        """
        label_str = ""
        if labels:
            label_parts = [f'{k}="{v}"' for k, v in labels.items()]
            label_str = "{" + ",".join(label_parts) + "}"

        return await self.get_scalar(f"{metric_name}{label_str}", default)

    async def get_rate(self, metric_name: str, interval: str = "5m", default: float = 0.0) -> float:
        """
        Get rate of a counter metric.

        Args:
            metric_name: Name of the counter metric
            interval: Rate interval (e.g., "5m", "1h")
            default: Default value if query fails
        """
        return await self.get_scalar(f"rate({metric_name}[{interval}])", default)

    async def is_healthy(self) -> bool:
        """Check if Prometheus is reachable."""
        try:
            client = await self._get_client()
            response = await client.get(f"{self.base_url}/-/healthy")
            return response.status_code == 200
        except Exception:
            return False


# Singleton instance
_prometheus_client: Optional[PrometheusClient] = None


def get_prometheus_client() -> PrometheusClient:
    """Get the singleton Prometheus client instance."""
    global _prometheus_client
    if _prometheus_client is None:
        _prometheus_client = PrometheusClient()
    return _prometheus_client


async def cleanup_prometheus_client():
    """Cleanup Prometheus client on shutdown."""
    global _prometheus_client
    if _prometheus_client:
        await _prometheus_client.close()
        _prometheus_client = None
