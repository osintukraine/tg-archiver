"""
LLM Model Registry - Central catalog of all available models

This module defines all LLM models available in the platform with their:
- Capabilities (what tasks they can perform)
- Performance characteristics (speed, quality, context length)
- Resource requirements (RAM, disk, GPU)
- Runtime configuration (temperature, timeout, etc.)

Models can be selected:
1. Via database configuration (runtime changes without restart)
2. Via environment variables (deployment-time config)
3. Via API parameters (per-request overrides)
"""

from enum import Enum
from typing import List, Optional, Dict
from pydantic import BaseModel, Field


class ModelTask(str, Enum):
    """LLM task types supported by the platform."""
    EMBEDDING = "embedding"           # Vector embeddings (384d for PgVector)
    OSINT_SCORING = "osint_scoring"   # Score 0-100 + topic classification
    TAG_GENERATION = "tag_generation" # Extract keywords, topics, entities
    TRANSLATION = "translation"       # Language translation
    SUMMARIZATION = "summarization"   # Text summarization
    CLASSIFICATION = "classification" # General text classification


class ModelCapability(BaseModel):
    """
    What a model can do.

    Describes a specific capability of a model including
    performance metrics and constraints.
    """
    task: ModelTask
    quality_score: int = Field(ge=0, le=100, description="Quality 0-100 (higher = better)")
    speed_ms: int = Field(description="Avg processing time (milliseconds)")
    context_length: int = Field(description="Max tokens/characters supported")
    multilingual: bool = False
    notes: Optional[str] = None


class LLMModel(BaseModel):
    """
    Complete model definition with capabilities and metadata.

    This registry allows runtime model selection based on:
    - Task requirements (embedding vs generation)
    - Performance needs (speed vs quality)
    - Resource constraints (memory, GPU)
    - Language support
    """
    # Allow model_* fields without Pydantic warning (we use model_name intentionally)
    model_config = {"protected_namespaces": ()}

    # Identity
    id: str = Field(description="Unique model identifier (e.g., 'all-minilm')")
    name: str = Field(description="Human-readable display name")
    provider: str = Field(description="ollama, openai, huggingface, etc.")
    model_name: str = Field(description="Provider-specific model identifier")

    # Capabilities
    capabilities: List[ModelCapability] = Field(default_factory=list)

    # Resource requirements
    ram_mb: int = Field(description="RAM required (MB)")
    disk_mb: int = Field(description="Disk space (MB)")
    gpu_required: bool = False
    cpu_threads: int = 1

    # Metadata
    version: str = Field(default="latest")
    license: str = Field(default="unknown")
    source_url: Optional[str] = None

    # Runtime config
    default_temperature: float = Field(default=0.7, ge=0.0, le=2.0)
    default_top_p: float = Field(default=0.9, ge=0.0, le=1.0)
    max_retries: int = 3
    timeout_seconds: int = 30

    # Status
    enabled: bool = True
    verified: bool = False  # Has it been tested in production?
    last_health_check: Optional[str] = None


# ============================================================================
# MODEL REGISTRY - Predefined models available in the platform
# ============================================================================

MODEL_REGISTRY: Dict[str, LLMModel] = {
    # ========================================================================
    # EMBEDDING MODELS (384d vectors for PgVector semantic search)
    # ========================================================================
    "all-minilm": LLMModel(
        id="all-minilm",
        name="all-MiniLM-L6-v2",
        provider="ollama",
        model_name="all-minilm",
        capabilities=[
            ModelCapability(
                task=ModelTask.EMBEDDING,
                quality_score=90,
                speed_ms=75,
                context_length=512,
                multilingual=True,
                notes="Excellent quality/speed balance for semantic search. Production-tested."
            )
        ],
        ram_mb=200,
        disk_mb=45,
        gpu_required=False,
        cpu_threads=1,
        version="latest",
        license="Apache 2.0",
        source_url="https://huggingface.co/sentence-transformers/all-MiniLM-L6-v2",
        verified=True,
        default_temperature=0.0,  # No temperature for embeddings
        timeout_seconds=30
    ),

    "nomic-embed-text": LLMModel(
        id="nomic-embed-text",
        name="Nomic Embed Text",
        provider="ollama",
        model_name="nomic-embed-text",
        capabilities=[
            ModelCapability(
                task=ModelTask.EMBEDDING,
                quality_score=92,
                speed_ms=100,
                context_length=8192,  # HUGE context window!
                multilingual=True,
                notes="Higher quality, longer context (8k tokens), slightly slower. Best for long documents."
            )
        ],
        ram_mb=300,
        disk_mb=137,
        gpu_required=False,
        cpu_threads=1,
        version="latest",
        license="Apache 2.0",
        source_url="https://ollama.com/library/nomic-embed-text",
        verified=False,
        default_temperature=0.0,
        timeout_seconds=40
    ),

    # ========================================================================
    # GENERATION MODELS (OSINT Scoring, Tag Generation, Classification)
    # ========================================================================
    "llama3.2:3b": LLMModel(
        id="llama3.2:3b",
        name="Llama 3.2 3B Instruct",
        provider="ollama",
        model_name="llama3.2:3b",  # Must match Ollama model name exactly
        capabilities=[
            ModelCapability(
                task=ModelTask.OSINT_SCORING,
                quality_score=85,
                speed_ms=800,
                context_length=4096,
                multilingual=True,
                notes="Excellent reasoning, multilingual support, good for OSINT analysis"
            ),
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=82,
                speed_ms=600,
                context_length=4096,
                multilingual=True,
                notes="Good at keyword extraction and topic classification"
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=88,
                speed_ms=500,
                context_length=4096,
                multilingual=True,
                notes="Strong general classification capabilities"
            )
        ],
        ram_mb=2500,
        disk_mb=2000,
        gpu_required=False,
        cpu_threads=4,
        version="latest",  # Updated to match actual version
        license="Llama 3.2 Community License",
        source_url="https://ollama.com/library/llama3.2",
        verified=True,
        default_temperature=0.3,  # Lower for more consistent output
        default_top_p=0.9,
        timeout_seconds=60
    ),

    "qwen2.5:3b": LLMModel(
        id="qwen2.5:3b",
        name="Qwen 2.5 3B",
        provider="ollama",
        model_name="qwen2.5:3b",
        capabilities=[
            ModelCapability(
                task=ModelTask.OSINT_SCORING,
                quality_score=87,
                speed_ms=750,
                context_length=32768,  # MASSIVE 32k context!
                multilingual=True,
                notes="Superior multilingual support, especially Russian/Ukrainian. Massive context window."
            ),
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=85,
                speed_ms=550,
                context_length=32768,
                multilingual=True,
                notes="Excellent for extracting tags from long messages"
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=86,
                speed_ms=500,
                context_length=32768,
                multilingual=True,
                notes="Strong classification with excellent multilingual support"
            )
        ],
        ram_mb=2400,
        disk_mb=1900,
        gpu_required=False,
        cpu_threads=4,
        version="3b",
        license="Apache 2.0",
        source_url="https://ollama.com/library/qwen2.5",
        verified=True,
        default_temperature=0.3,
        default_top_p=0.9,
        timeout_seconds=60
    ),

    # Qwen 2.5 1.5B - Sweet spot for AI Tagging (3x faster than 3B, 100% valid JSON)
    # Benchmarked 2025-12-01: 9.2s avg vs 27.4s for 3B
    "qwen2.5:1.5b": LLMModel(
        id="qwen2.5:1.5b",
        name="Qwen 2.5 1.5B",
        provider="ollama",
        model_name="qwen2.5:1.5b",
        capabilities=[
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=82,  # Slightly lower quality but much faster
                speed_ms=300,      # ~3x faster than 3B!
                context_length=32768,
                multilingual=True,
                notes="Sweet spot for AI tagging: 3x faster, 100% valid JSON output. Benchmarked 2025-12-01."
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=78,
                speed_ms=250,
                context_length=32768,
                multilingual=True,
                notes="Fast classification with good multilingual support"
            )
        ],
        ram_mb=1200,
        disk_mb=986,  # Actual size from ollama list
        gpu_required=False,
        cpu_threads=2,
        version="1.5b",
        license="Apache 2.0",
        source_url="https://ollama.com/library/qwen2.5",
        verified=True,  # Benchmarked and verified 2025-12-01
        default_temperature=0.3,
        default_top_p=0.9,
        timeout_seconds=45
    ),

    # Qwen 2.5 0.5B - Fastest model for high-volume simple tasks
    # Benchmarked 2025-12-01: 3.3s avg (8.2x faster than 3B)
    "qwen2.5:0.5b": LLMModel(
        id="qwen2.5:0.5b",
        name="Qwen 2.5 0.5B",
        provider="ollama",
        model_name="qwen2.5:0.5b",
        capabilities=[
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=70,  # Lower quality but extremely fast
                speed_ms=110,      # ~8x faster than 3B!
                context_length=32768,
                multilingual=True,
                notes="Fastest option for bulk tagging. 8x speedup, still 100% valid JSON. Use for low-priority content."
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=65,
                speed_ms=100,
                context_length=32768,
                multilingual=True,
                notes="Ultra-fast classification, accuracy tradeoff"
            )
        ],
        ram_mb=600,
        disk_mb=397,  # Actual size from ollama list
        gpu_required=False,
        cpu_threads=1,
        version="0.5b",
        license="Apache 2.0",
        source_url="https://ollama.com/library/qwen2.5",
        verified=True,  # Benchmarked 2025-12-01
        default_temperature=0.3,
        default_top_p=0.9,
        timeout_seconds=30
    ),

    "granite3-dense:2b": LLMModel(
        id="granite3-dense:2b",
        name="IBM Granite 3.0 Dense 2B",
        provider="ollama",
        model_name="granite3-dense:2b",
        capabilities=[
            ModelCapability(
                task=ModelTask.OSINT_SCORING,
                quality_score=78,
                speed_ms=500,
                context_length=4096,
                multilingual=False,
                notes="Faster, business-focused, English-only. Good for high-throughput."
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=80,
                speed_ms=400,
                context_length=4096,
                multilingual=False,
                notes="Fast classification for English content"
            )
        ],
        ram_mb=1800,
        disk_mb=1300,
        gpu_required=False,
        cpu_threads=2,
        version="2b",
        license="Apache 2.0",
        source_url="https://ollama.com/library/granite3-dense",
        verified=False,
        default_temperature=0.3,
        timeout_seconds=45
    ),

    "phi3.5:3.8b": LLMModel(
        id="phi3.5:3.8b",
        name="Microsoft Phi 3.5",
        provider="ollama",
        model_name="phi3.5:3.8b",
        capabilities=[
            ModelCapability(
                task=ModelTask.OSINT_SCORING,
                quality_score=90,
                speed_ms=1200,
                context_length=4096,
                multilingual=False,
                notes="Best reasoning quality, slower, English-only. Use for high-value analysis."
            ),
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=88,
                speed_ms=900,
                context_length=4096,
                multilingual=False,
                notes="Excellent tag quality for English content"
            ),
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=91,
                speed_ms=800,
                context_length=4096,
                multilingual=False,
                notes="Superior classification accuracy"
            )
        ],
        ram_mb=3000,
        disk_mb=2300,
        gpu_required=False,
        cpu_threads=4,
        version="3.8b",
        license="MIT",
        source_url="https://ollama.com/library/phi3.5",
        verified=False,
        default_temperature=0.3,
        timeout_seconds=90
    ),

    "gemma2:2b": LLMModel(
        id="gemma2:2b",
        name="Google Gemma 2 2B",
        provider="ollama",
        model_name="gemma2:2b",
        capabilities=[
            ModelCapability(
                task=ModelTask.CLASSIFICATION,
                quality_score=75,
                speed_ms=400,
                context_length=8192,
                multilingual=False,
                notes="Fastest option, good for simple classification tasks"
            ),
            ModelCapability(
                task=ModelTask.TAG_GENERATION,
                quality_score=72,
                speed_ms=350,
                context_length=8192,
                multilingual=False,
                notes="Fast tag generation for high-volume processing"
            )
        ],
        ram_mb=1500,
        disk_mb=1500,
        gpu_required=False,
        cpu_threads=2,
        version="2b",
        license="Gemma Terms of Use",
        source_url="https://ollama.com/library/gemma2",
        verified=False,
        default_temperature=0.3,
        timeout_seconds=40
    ),
}


# ============================================================================
# HELPER FUNCTIONS
# ============================================================================

def get_model(model_id: str) -> Optional[LLMModel]:
    """
    Get model definition by ID.

    Args:
        model_id: Model identifier (e.g., 'all-minilm', 'qwen2.5:3b')

    Returns:
        LLMModel instance or None if not found
    """
    return MODEL_REGISTRY.get(model_id)


def get_models_for_task(task: ModelTask) -> List[LLMModel]:
    """
    Get all models capable of a specific task, sorted by quality.

    Args:
        task: Task type (EMBEDDING, OSINT_SCORING, etc.)

    Returns:
        List of models sorted by quality score (best first)
    """
    models = []
    for model in MODEL_REGISTRY.values():
        if any(cap.task == task for cap in model.capabilities):
            models.append(model)

    # Sort by quality score (descending)
    models.sort(
        key=lambda m: max(
            cap.quality_score for cap in m.capabilities if cap.task == task
        ),
        reverse=True
    )
    return models


def get_fastest_model_for_task(task: ModelTask) -> Optional[LLMModel]:
    """
    Get fastest model for a task (prioritizing speed over quality).

    Args:
        task: Task type

    Returns:
        Fastest model for the task or None
    """
    models = get_models_for_task(task)
    if not models:
        return None

    return min(
        models,
        key=lambda m: min(
            cap.speed_ms for cap in m.capabilities if cap.task == task
        )
    )


def get_best_quality_model_for_task(task: ModelTask) -> Optional[LLMModel]:
    """
    Get highest quality model for a task (prioritizing quality over speed).

    Args:
        task: Task type

    Returns:
        Best quality model or None
    """
    models = get_models_for_task(task)
    return models[0] if models else None


def get_verified_models() -> List[LLMModel]:
    """
    Get all models that have been verified in production.

    Returns:
        List of verified models
    """
    return [model for model in MODEL_REGISTRY.values() if model.verified]


def get_models_by_provider(provider: str) -> List[LLMModel]:
    """
    Get all models from a specific provider.

    Args:
        provider: Provider name (e.g., 'ollama', 'openai')

    Returns:
        List of models from the provider
    """
    return [model for model in MODEL_REGISTRY.values() if model.provider == provider]
