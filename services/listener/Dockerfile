# Telegram Listener Service Dockerfile
# Handles real-time Telegram message ingestion

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
    build-essential \
    curl \
    && rm -rf /var/lib/apt/lists/*

# Copy shared dependencies first (for layer caching)
COPY shared/python/requirements.txt /shared/requirements.txt
RUN pip install -r /shared/requirements.txt

# Copy service dependencies
COPY services/listener/requirements.txt .
RUN pip install -r requirements.txt

# Copy shared Python modules
COPY shared/python /shared/python
ENV PYTHONPATH="/shared/python:${PYTHONPATH}"

# Copy service code
COPY services/listener/src ./src

# Create directories for data persistence
RUN mkdir -p /data/sessions /var/log/listener

# Health check - verifies message activity (not just container running)
# Port 8002 is the dedicated health endpoint that checks if messages are flowing
HEALTHCHECK --interval=60s --timeout=10s --start-period=600s --retries=3 \
    CMD curl -f http://localhost:8002/health || exit 1

# Expose ports
EXPOSE 8001 8002 9090

# Run the listener
CMD ["python", "-m", "src.main"]
