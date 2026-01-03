# REST API Service Dockerfile
# Provides REST API, RSS feeds, and search functionality

ARG PYTHON_VERSION=3.11

FROM python:${PYTHON_VERSION}-slim as base

# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy shared dependencies first (for layer caching)
COPY shared/python/requirements.txt /shared/requirements.txt
RUN pip install -r /shared/requirements.txt

# Copy service dependencies
COPY services/api/requirements.txt .
RUN pip install -r requirements.txt

# Copy shared Python modules
COPY shared/python /shared/python
ENV PYTHONPATH="/shared/python:${PYTHONPATH}"

# Copy service code
COPY services/api/src ./src

# Note: No Alembic migrations - using init.sql for fresh installs

# Create non-root user for security
RUN groupadd --system --gid 1001 api && \
    useradd --system --uid 1001 --gid api api

# Create directories for logs and set ownership
RUN mkdir -p /var/log/api && \
    chown -R api:api /app /var/log/api

# Switch to non-root user
USER api

# Health check
HEALTHCHECK --interval=30s --timeout=10s --start-period=30s --retries=3 \
    CMD curl -f http://localhost:8000/health || exit 1

# Expose ports
EXPOSE 8000 9090

# Run with uvicorn
CMD ["uvicorn", "src.main:app", "--host", "0.0.0.0", "--port", "8000"]
