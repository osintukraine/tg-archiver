"""
Health Check Endpoints

Provides system health and hardware configuration information.
"""

import os
from fastapi import APIRouter
from hardware import detect_hardware, determine_tier, get_tier_defaults, VALID_TIERS

router = APIRouter(prefix="/api/health", tags=["health"])


@router.get("")
async def health_check():
    """
    Health check endpoint for Docker/Kubernetes.

    Returns basic service health status.
    """
    return {
        "status": "healthy",
        "service": "api",
        "version": "0.1.0"
    }


@router.get("/hardware")
async def get_hardware_config():
    """
    Get current hardware configuration.

    Returns detected hardware, active tier, and all LLM/Ollama settings.
    This endpoint is useful for monitoring and debugging hardware-adaptive
    configuration at runtime.

    Returns:
        - tier: Detected or configured hardware tier (laptop/laptop-gpu/server/server-gpu)
        - detection_method: "manual" if HARDWARE_TIER env var is set, "auto" otherwise
        - hardware: Detected CPU cores, RAM, GPU info
        - llm_settings: Current LLM model and configuration
        - ollama_settings: Ollama inference engine settings
        - overrides_active: List of settings that differ from tier defaults
    """
    hardware = detect_hardware()
    tier = determine_tier(hardware)
    defaults = get_tier_defaults(tier) if tier in VALID_TIERS else {}

    # Check which settings are overridden
    overrides = []
    for key, default_value in defaults.items():
        env_value = os.environ.get(key)
        if env_value and env_value != default_value:
            overrides.append(key)

    return {
        "tier": tier,
        "detection_method": "manual" if os.environ.get("HARDWARE_TIER") else "auto",
        "hardware": {
            "cpu_cores": hardware.cpu_cores,
            "ram_gb": hardware.ram_gb,
            "gpu_name": hardware.gpu_name,
            "gpu_vram_gb": hardware.gpu_vram_gb,
        },
        "llm_settings": {
            "model": os.environ.get("LLM_MODEL", defaults.get("LLM_MODEL")),
            "cot_enabled": os.environ.get("LLM_ENABLE_COT", defaults.get("LLM_ENABLE_COT")),
            "parallelism": os.environ.get("LLM_PARALLELISM", defaults.get("LLM_PARALLELISM")),
            "max_tokens": os.environ.get("LLM_MAX_TOKENS", defaults.get("LLM_MAX_TOKENS")),
            "timeout_seconds": os.environ.get("LLM_TIMEOUT", defaults.get("LLM_TIMEOUT")),
        },
        "ollama_settings": {
            "cpu_threads": os.environ.get("OLLAMA_CPU_THREADS", defaults.get("OLLAMA_CPU_THREADS")),
            "keep_alive": os.environ.get("OLLAMA_KEEP_ALIVE", defaults.get("OLLAMA_KEEP_ALIVE")),
            "max_loaded_models": os.environ.get("OLLAMA_MAX_LOADED_MODELS", defaults.get("OLLAMA_MAX_LOADED_MODELS")),
            "gpu_layers": os.environ.get("OLLAMA_GPU_LAYERS", defaults.get("OLLAMA_GPU_LAYERS")),
        },
        "overrides_active": overrides,
    }
