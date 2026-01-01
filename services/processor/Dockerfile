# Message Processor Service Dockerfile (No AI)
# Handles message archival, entity extraction, and media storage

FROM python:3.11-slim

# Prevent Python from buffering stdout and stderr
ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

WORKDIR /app

# Install system dependencies
# ffmpeg is required for video faststart processing (moves moov atom for streaming)
RUN apt-get update && apt-get install -y \
    --no-install-recommends \
    build-essential \
    curl \
    procps \
    ffmpeg \
    libpq-dev \
    && rm -rf /var/lib/apt/lists/*

# Copy shared dependencies first (for layer caching)
COPY shared/python/requirements.txt /shared/requirements.txt
RUN pip install -r /shared/requirements.txt

# Copy service dependencies
COPY services/processor/requirements.txt .
RUN pip install -r requirements.txt

# Copy shared Python modules
COPY shared/python /shared/python
ENV PYTHONPATH="/shared/python:${PYTHONPATH}"

# Copy service code
COPY services/processor/src ./src

# Create directories for logs
RUN mkdir -p /var/log/processor

# Health check - verify processor is running
HEALTHCHECK --interval=30s --timeout=10s --start-period=60s --retries=3 \
    CMD pgrep -f "python.*src.main" > /dev/null || exit 1

# Expose ports (metrics)
EXPOSE 8002

# Run the processor
CMD ["python", "-m", "src.main"]
