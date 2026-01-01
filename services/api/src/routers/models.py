"""
Model Management Router - Multi-Model Architecture API

Endpoints for managing LLM model configurations:
- View available models in registry
- Get model details and capabilities
- Update runtime model configuration
- Check model health status

All changes via these endpoints take effect immediately without service restarts.
"""

from typing import List, Optional
from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession
from pydantic import BaseModel, Field

import sys
from pathlib import Path

# Add shared python to path
sys.path.insert(0, str(Path(__file__).parent.parent.parent.parent.parent / "shared/python"))

from models.llm_model import (
    LLMModel,
    ModelTask,
    MODEL_REGISTRY,
    get_model,
    get_models_for_task,
    get_fastest_model_for_task,
    get_best_quality_model_for_task,
    get_verified_models,
)
from models.model_configuration import ModelConfiguration
from services.model_selector import ModelSelector

from ..database import get_db

router = APIRouter(prefix="/api/models", tags=["models"])


# ===========================================================================
# PYDANTIC SCHEMAS
# ===========================================================================

class ModelConfigUpdate(BaseModel):
    """Request schema for updating model configuration."""
    model_id: str = Field(description="Model ID from registry")
    enabled: bool = Field(default=True, description="Enable/disable this configuration")
    priority: int = Field(default=1, ge=1, description="Priority (1=primary, 2+=fallbacks)")
    override_config: Optional[dict] = Field(default=None, description="Optional config overrides")


class ModelConfigResponse(BaseModel):
    """Response schema for model configuration."""
    id: int
    task: str
    model_id: str
    enabled: bool
    priority: int
    override_config: Optional[dict]
    created_at: str
    updated_at: Optional[str]


# ===========================================================================
# MODEL REGISTRY ENDPOINTS (Read-Only)
# ===========================================================================

@router.get("/registry", response_model=List[LLMModel])
async def list_all_models():
    """
    Get all models in the registry.

    Returns complete catalog of available LLM models with:
    - Capabilities (what tasks they can perform)
    - Performance metrics (speed, quality, context length)
    - Resource requirements (RAM, disk, GPU)
    - Configuration defaults

    **Use Case**: Discover available models before updating configuration
    """
    return list(MODEL_REGISTRY.values())


@router.get("/registry/verified", response_model=List[LLMModel])
async def list_verified_models():
    """
    Get only production-verified models.

    Returns models that have been tested and verified in production.
    Recommended for production deployments.
    """
    return get_verified_models()


@router.get("/registry/{model_id}", response_model=LLMModel)
async def get_model_details(model_id: str):
    """
    Get detailed information about a specific model.

    Returns complete model specification including:
    - All supported tasks and quality scores
    - Performance benchmarks
    - Resource requirements
    - Configuration options

    **Example**: `GET /api/models/registry/qwen2.5:3b`
    """
    model = get_model(model_id)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_id}' not found in registry"
        )
    return model


@router.get("/tasks/{task}", response_model=List[LLMModel])
async def list_models_for_task(task: str):
    """
    Get all models capable of a specific task, sorted by quality.

    Returns models that support the requested task, ordered by
    quality score (best first).

    **Tasks**:
    - `embedding` - Vector embeddings for semantic search
    - `osint_scoring` - OSINT value scoring (0-100)
    - `tag_generation` - Extract keywords, topics, entities
    - `classification` - General text classification

    **Example**: `GET /api/models/tasks/osint_scoring`
    Returns: qwen2.5:3b (87), llama3.2:3b (85), phi3.5:3.8b (90), etc.
    """
    try:
        task_enum = ModelTask(task)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task: {task}. Valid tasks: {[t.value for t in ModelTask]}"
        )

    models = get_models_for_task(task_enum)
    if not models:
        raise HTTPException(
            status_code=404,
            detail=f"No models available for task: {task}"
        )
    return models


@router.get("/tasks/{task}/fastest", response_model=LLMModel)
async def get_fastest_model(task: str):
    """
    Get the fastest model for a task.

    Returns the model with lowest processing time (speed_ms)
    for the requested task.

    **Use Case**: High-throughput processing where speed > quality
    """
    try:
        task_enum = ModelTask(task)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task: {task}"
        )

    model = get_fastest_model_for_task(task_enum)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"No models available for task: {task}"
        )
    return model


@router.get("/tasks/{task}/best-quality", response_model=LLMModel)
async def get_best_quality_model(task: str):
    """
    Get the highest quality model for a task.

    Returns the model with highest quality score for the requested task.

    **Use Case**: Critical analysis where quality > speed
    """
    try:
        task_enum = ModelTask(task)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task: {task}"
        )

    model = get_best_quality_model_for_task(task_enum)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"No models available for task: {task}"
        )
    return model


# ===========================================================================
# MODEL CONFIGURATION ENDPOINTS (Read/Write)
# ===========================================================================

@router.get("/configuration", response_model=List[ModelConfigResponse])
async def get_current_configuration(db: AsyncSession = Depends(get_db)):
    """
    Get current model configuration for all tasks.

    Returns active model configuration showing:
    - Which model is primary for each task (priority=1)
    - Fallback models (priority 2, 3, etc.)
    - Enabled/disabled status

    **Use Case**: View current production configuration
    """
    result = await db.execute(
        select(ModelConfiguration).order_by(
            ModelConfiguration.task,
            ModelConfiguration.priority
        )
    )
    configs = result.scalars().all()

    return [
        ModelConfigResponse(
            id=config.id,
            task=config.task,
            model_id=config.model_id,
            enabled=config.enabled,
            priority=config.priority,
            override_config=config.override_config,
            created_at=config.created_at.isoformat() if config.created_at else "",
            updated_at=config.updated_at.isoformat() if config.updated_at else None,
        )
        for config in configs
    ]


@router.get("/configuration/{task}", response_model=List[ModelConfigResponse])
async def get_task_configuration(task: str, db: AsyncSession = Depends(get_db)):
    """
    Get model configuration for a specific task.

    Returns all configured models for the task, ordered by priority.

    **Example**: `GET /api/models/configuration/osint_scoring`

    Returns:
    - Priority 1: qwen2.5:3b (primary)
    - Priority 2: llama3.2:3b (fallback)
    - Priority 3: granite3.0:2b (fast fallback)
    """
    # Verify task is valid
    try:
        ModelTask(task)
    except ValueError:
        raise HTTPException(
            status_code=400,
            detail=f"Invalid task: {task}"
        )

    result = await db.execute(
        select(ModelConfiguration)
        .where(ModelConfiguration.task == task)
        .order_by(ModelConfiguration.priority)
    )
    configs = result.scalars().all()

    if not configs:
        raise HTTPException(
            status_code=404,
            detail=f"No configuration found for task: {task}"
        )

    return [
        ModelConfigResponse(
            id=config.id,
            task=config.task,
            model_id=config.model_id,
            enabled=config.enabled,
            priority=config.priority,
            override_config=config.override_config,
            created_at=config.created_at.isoformat() if config.created_at else "",
            updated_at=config.updated_at.isoformat() if config.updated_at else None,
        )
        for config in configs
    ]


@router.put("/configuration/{task}")
async def update_task_configuration(
    task: str,
    config: ModelConfigUpdate,
    db: AsyncSession = Depends(get_db)
):
    """
    Update model configuration for a task.

    **Changes take effect immediately** - no service restart required!

    **Request Body**:
    ```json
    {
        "model_id": "phi3.5:3.8b",
        "enabled": true,
        "priority": 1,
        "override_config": {"temperature": 0.5}
    }
    ```

    **Use Cases**:
    - Switch to faster model: `{"model_id": "granite3.0:2b", "priority": 1}`
    - Switch to better quality: `{"model_id": "phi3.5:3.8b", "priority": 1}`
    - Disable fallback: `{"model_id": "llama3.2:3b", "enabled": false}`
    - Override temperature: `{"override_config": {"temperature": 0.3}}`

    **Example**: Switch OSINT scoring to highest quality model
    ```bash
    curl -X PUT http://localhost:8000/api/models/configuration/osint_scoring \\
      -H "Content-Type: application/json" \\
      -d '{
        "model_id": "phi3.5:3.8b",
        "enabled": true,
        "priority": 1
      }'
    ```
    """
    # Use ModelSelector to validate and update
    selector = ModelSelector(db)

    try:
        updated_config = await selector.update_configuration(
            task=task,
            model_id=config.model_id,
            enabled=config.enabled,
            priority=config.priority,
            override_config=config.override_config
        )
    except ValueError as e:
        raise HTTPException(status_code=400, detail=str(e))

    return {
        "status": "success",
        "message": f"Updated {task} configuration",
        "configuration": ModelConfigResponse(
            id=updated_config.id,
            task=updated_config.task,
            model_id=updated_config.model_id,
            enabled=updated_config.enabled,
            priority=updated_config.priority,
            override_config=updated_config.override_config,
            created_at=updated_config.created_at.isoformat() if updated_config.created_at else "",
            updated_at=updated_config.updated_at.isoformat() if updated_config.updated_at else None,
        )
    }


@router.delete("/configuration/{task}/{model_id}")
async def delete_task_configuration(
    task: str,
    model_id: str,
    db: AsyncSession = Depends(get_db)
):
    """
    Remove a model configuration for a task.

    **Warning**: Only delete fallback configurations (priority > 1).
    Deleting the primary model (priority=1) may break the task.

    **Example**: Remove slow fallback model
    ```bash
    curl -X DELETE http://localhost:8000/api/models/configuration/osint_scoring/granite3.0:2b
    ```
    """
    result = await db.execute(
        select(ModelConfiguration).where(
            ModelConfiguration.task == task,
            ModelConfiguration.model_id == model_id
        )
    )
    config = result.scalar_one_or_none()

    if not config:
        raise HTTPException(
            status_code=404,
            detail=f"Configuration not found for task={task}, model={model_id}"
        )

    # Warn if deleting primary model
    if config.priority == 1:
        # Check if there are other enabled configs for this task
        result = await db.execute(
            select(ModelConfiguration).where(
                ModelConfiguration.task == task,
                ModelConfiguration.enabled == True,
                ModelConfiguration.id != config.id
            )
        )
        other_configs = result.scalars().all()

        if not other_configs:
            raise HTTPException(
                status_code=400,
                detail=(
                    f"Cannot delete primary model for {task} - no other enabled models. "
                    f"Add a fallback model first or disable instead of deleting."
                )
            )

    await db.delete(config)
    await db.commit()

    return {
        "status": "success",
        "message": f"Deleted configuration for {task} -> {model_id}"
    }


# ===========================================================================
# MODEL HEALTH & STATUS
# ===========================================================================

@router.get("/health/{model_id}")
async def check_model_health(model_id: str):
    """
    Check if a model is available and responding.

    **Future Enhancement**: Will perform actual health check via Ollama API.

    **Current**: Returns model info from registry.
    """
    model = get_model(model_id)
    if not model:
        raise HTTPException(
            status_code=404,
            detail=f"Model '{model_id}' not found in registry"
        )

    # TODO: Implement actual health check
    # - Call Ollama API to check if model is loaded
    # - Test inference with sample text
    # - Measure response time

    return {
        "model_id": model_id,
        "status": "available",
        "provider": model.provider,
        "verified": model.verified,
        "enabled": model.enabled,
        "capabilities": [cap.task.value for cap in model.capabilities],
        "message": "Model available in registry (health check not yet implemented)"
    }


@router.get("/stats")
async def get_model_stats(db: AsyncSession = Depends(get_db)):
    """
    Get statistics about model usage and configuration.

    Returns:
    - Total models in registry
    - Models by task
    - Current configuration summary
    - Verified vs unverified models
    """
    # Count models in registry
    total_models = len(MODEL_REGISTRY)
    verified_count = len([m for m in MODEL_REGISTRY.values() if m.verified])

    # Count by task
    task_counts = {}
    for task in ModelTask:
        models = get_models_for_task(task)
        task_counts[task.value] = len(models)

    # Get active configurations
    result = await db.execute(
        select(ModelConfiguration).where(ModelConfiguration.enabled == True)
    )
    active_configs = result.scalars().all()

    return {
        "registry": {
            "total_models": total_models,
            "verified_models": verified_count,
            "unverified_models": total_models - verified_count,
            "models_by_task": task_counts
        },
        "configuration": {
            "total_configurations": len(active_configs),
            "tasks_configured": len(set(c.task for c in active_configs)),
            "primary_models": len([c for c in active_configs if c.priority == 1]),
            "fallback_models": len([c for c in active_configs if c.priority > 1])
        }
    }
