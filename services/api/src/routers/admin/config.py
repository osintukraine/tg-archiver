"""
Admin Configuration API

Provides runtime platform configuration management.
Settings are stored in the database and grouped by category.
"""

from fastapi import APIRouter, Depends, Query, HTTPException
from sqlalchemy import text
from sqlalchemy.ext.asyncio import AsyncSession
from datetime import datetime
from pydantic import BaseModel
from typing import List, Optional, Dict, Any
import os
import re

from ...database import get_db
from ...dependencies import AdminUser

router = APIRouter(prefix="/api/admin/config", tags=["admin-config"])


class ConfigItem(BaseModel):
    """Configuration item."""
    id: int
    category: str
    key: str
    value: Optional[str]
    description: Optional[str]
    data_type: str
    is_secret: bool
    restart_required: bool
    last_modified_at: Optional[datetime]


class ConfigListResponse(BaseModel):
    """Grouped configuration response."""
    categories: Dict[str, List[ConfigItem]]
    total: int


class ConfigUpdateRequest(BaseModel):
    """Request to update a config value."""
    value: str


class ConfigBulkUpdateRequest(BaseModel):
    """Request to update multiple config values."""
    updates: Dict[str, str]  # key -> value


class ModelConfigItem(BaseModel):
    """Model configuration item."""
    id: int
    task: str
    model_id: str
    enabled: bool
    priority: int
    override_config: Optional[Dict[str, Any]]
    created_at: Optional[datetime]
    updated_at: Optional[datetime]


class ModelConfigUpdateRequest(BaseModel):
    """Request to update model configuration."""
    model_id: Optional[str] = None
    enabled: Optional[bool] = None
    priority: Optional[int] = None
    override_config: Optional[Dict[str, Any]] = None


@router.get("/", response_model=ConfigListResponse)
async def get_all_config(
    admin: AdminUser,
    category: Optional[str] = None,
    include_secrets: bool = False,
    db: AsyncSession = Depends(get_db)
) -> ConfigListResponse:
    """
    Get all configuration items grouped by category.

    Returns platform configuration settings organized by category.
    Secrets are automatically masked with "********" unless explicitly requested.
    This protects sensitive values like API keys, tokens, and passwords from
    accidental exposure in admin UIs or logs.

    Args:
        admin: Authenticated admin user (from dependency injection)
        category: Optional category filter (e.g., "llm", "telegram", "storage")
        include_secrets: If True, returns unmasked secret values (default: False)
        db: Database session (from dependency injection)

    Returns:
        ConfigListResponse with categories dict and total count.
        Secret values are masked unless include_secrets=True.

    Security:
        Only admin users can access this endpoint.
        Secrets are masked by default to prevent accidental exposure.
    """
    query = """
        SELECT id, category, key, value, description, data_type,
               is_secret, restart_required, last_modified_at
        FROM platform_config
        WHERE 1=1
    """
    params = {}

    if category:
        query += " AND category = :category"
        params["category"] = category

    query += " ORDER BY category, key"

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    categories: Dict[str, List[ConfigItem]] = {}
    for row in rows:
        item = ConfigItem(
            id=row[0],
            category=row[1],
            key=row[2],
            value="********" if row[6] and not include_secrets else row[3],
            description=row[4],
            data_type=row[5],
            is_secret=row[6],
            restart_required=row[7],
            last_modified_at=row[8],
        )
        if item.category not in categories:
            categories[item.category] = []
        categories[item.category].append(item)

    return ConfigListResponse(
        categories=categories,
        total=len(rows),
    )


@router.get("/categories")
async def get_categories(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get list of configuration categories with counts.

    Returns summary statistics for each configuration category.
    Useful for building navigation UI or understanding configuration scope.

    Args:
        admin: Authenticated admin user (from dependency injection)
        db: Database session (from dependency injection)

    Returns:
        List of dicts with category, count, and secrets_count fields.
        Example: [{"category": "llm", "count": 5, "secrets_count": 1}]

    Security:
        Only admin users can access this endpoint.
    """
    result = await db.execute(text("""
        SELECT category, COUNT(*) as count,
               SUM(CASE WHEN is_secret THEN 1 ELSE 0 END) as secrets_count
        FROM platform_config
        GROUP BY category
        ORDER BY category
    """))
    return [
        {"category": row[0], "count": row[1], "secrets_count": row[2]}
        for row in result.fetchall()
    ]


@router.get("/{key}")
async def get_config_item(
    key: str,
    admin: AdminUser,
    include_secret: bool = False,
    db: AsyncSession = Depends(get_db)
) -> ConfigItem:
    """
    Get a specific configuration item by key.

    Retrieves a single configuration setting with all metadata.
    Useful for detailed inspection or editing UI.

    Args:
        key: Configuration key name (e.g., "llm.default_model")
        admin: Authenticated admin user (from dependency injection)
        include_secret: If True, returns unmasked secret value (default: False)
        db: Database session (from dependency injection)

    Returns:
        ConfigItem with full metadata including data_type and restart_required flag.
        Secret values are masked unless include_secret=True.

    Raises:
        HTTPException 404: Configuration key not found

    Security:
        Only admin users can access this endpoint.
        Secrets are masked by default.
    """
    result = await db.execute(text("""
        SELECT id, category, key, value, description, data_type,
               is_secret, restart_required, last_modified_at
        FROM platform_config
        WHERE key = :key
    """), {"key": key})

    row = result.fetchone()
    if not row:
        raise HTTPException(status_code=404, detail=f"Config key '{key}' not found")

    return ConfigItem(
        id=row[0],
        category=row[1],
        key=row[2],
        value="********" if row[6] and not include_secret else row[3],
        description=row[4],
        data_type=row[5],
        is_secret=row[6],
        restart_required=row[7],
        last_modified_at=row[8],
    )


@router.put("/{key}")
async def update_config_item(
    key: str,
    request: ConfigUpdateRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update a configuration value.

    Updates a single configuration setting with type validation.
    Values are validated against the config item's data_type to prevent
    invalid configuration states. Changes are persisted immediately to the
    platform_config table.

    Args:
        key: Configuration key name (e.g., "llm.default_model")
        request: Update request with new value
        admin: Authenticated admin user (from dependency injection)
        db: Database session (from dependency injection)

    Returns:
        Dict with success status, updated key, and restart_required flag.
        Example: {"success": true, "key": "llm.model", "restart_required": true}

    Raises:
        HTTPException 404: Configuration key not found
        HTTPException 400: Invalid value for configured data_type

    Side Effects:
        Updates platform_config.value and last_modified_at in database.
        If restart_required=True, platform services must be restarted to apply.

    Type Validation:
        - boolean: Must be "true" or "false" (case-insensitive)
        - integer: Must parse as valid integer
        - float: Must parse as valid float
        - string: No validation

    Security:
        Only admin users can access this endpoint.
    """
    # Check if key exists
    check_result = await db.execute(text(
        "SELECT id, data_type, restart_required FROM platform_config WHERE key = :key"
    ), {"key": key})
    row = check_result.fetchone()

    if not row:
        raise HTTPException(status_code=404, detail=f"Config key '{key}' not found")

    config_id, data_type, restart_required = row

    # Validate value against data_type
    try:
        if data_type == "boolean":
            if request.value.lower() not in ("true", "false"):
                raise ValueError("Boolean value must be 'true' or 'false'")
        elif data_type == "integer":
            int(request.value)
        elif data_type == "float":
            float(request.value)
    except ValueError as e:
        raise HTTPException(status_code=400, detail=f"Invalid value for type {data_type}: {str(e)}")

    # Update
    await db.execute(text("""
        UPDATE platform_config
        SET value = :value, last_modified_at = NOW()
        WHERE key = :key
    """), {"key": key, "value": request.value})
    await db.commit()

    return {
        "success": True,
        "key": key,
        "restart_required": restart_required,
        "message": f"Updated '{key}'" + (" (restart required)" if restart_required else "")
    }


@router.put("/bulk/update")
async def bulk_update_config(
    admin: AdminUser,
    request: ConfigBulkUpdateRequest,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update multiple configuration values at once.

    Performs bulk updates to multiple configuration settings in a single transaction.
    Each value is validated against its data_type before updating. Partial success
    is possible - successful updates are committed even if some fail validation.

    Args:
        admin: Authenticated admin user (from dependency injection)
        request: Bulk update request with dict of key->value mappings
        db: Database session (from dependency injection)

    Returns:
        Dict with success status, list of updated keys, list of errors, and restart flag.
        Example:
        {
            "success": true,
            "updated": ["llm.model", "storage.path"],
            "errors": [{"key": "invalid.key", "error": "Key not found"}],
            "restart_required": true
        }

    Side Effects:
        Updates platform_config.value and last_modified_at for all successful updates.
        All successful updates are committed even if some items fail.
        If any updated item has restart_required=True, response flag is set.

    Type Validation:
        Same validation rules as single update endpoint.
        Invalid values are added to errors list but don't block other updates.

    Security:
        Only admin users can access this endpoint.
    """
    updated = []
    errors = []
    restart_required = False

    for key, value in request.updates.items():
        try:
            # Check if key exists
            check_result = await db.execute(text(
                "SELECT data_type, restart_required FROM platform_config WHERE key = :key"
            ), {"key": key})
            row = check_result.fetchone()

            if not row:
                errors.append({"key": key, "error": "Key not found"})
                continue

            data_type, needs_restart = row

            # Validate value
            if data_type == "boolean":
                if value.lower() not in ("true", "false"):
                    errors.append({"key": key, "error": "Invalid boolean value"})
                    continue
            elif data_type == "integer":
                try:
                    int(value)
                except ValueError:
                    errors.append({"key": key, "error": "Invalid integer value"})
                    continue
            elif data_type == "float":
                try:
                    float(value)
                except ValueError:
                    errors.append({"key": key, "error": "Invalid float value"})
                    continue

            # Update
            await db.execute(text("""
                UPDATE platform_config
                SET value = :value, last_modified_at = NOW()
                WHERE key = :key
            """), {"key": key, "value": value})

            updated.append(key)
            if needs_restart:
                restart_required = True

        except Exception as e:
            errors.append({"key": key, "error": str(e)})

    await db.commit()

    return {
        "success": len(errors) == 0,
        "updated": updated,
        "errors": errors,
        "restart_required": restart_required,
    }


# Model Configuration Endpoints

@router.get("/models/")
async def get_model_configs(
    admin: AdminUser,
    task: Optional[str] = None,
    db: AsyncSession = Depends(get_db)
) -> List[ModelConfigItem]:
    """
    Get model configurations.

    Returns LLM model configurations for AI enrichment tasks.
    Each task (e.g., "classification", "tagging", "embedding") can have
    multiple model configurations with different priorities for fallback.

    Args:
        admin: Authenticated admin user (from dependency injection)
        task: Optional task filter (e.g., "classification", "tagging")
        db: Database session (from dependency injection)

    Returns:
        List of ModelConfigItem ordered by task and priority.
        Higher priority models are tried first in fallback chains.

    Example Response:
        [
            {
                "id": 1,
                "task": "classification",
                "model_id": "qwen2.5:3b",
                "enabled": true,
                "priority": 1,
                "override_config": {"temperature": 0.7},
                "created_at": "2024-01-01T00:00:00",
                "updated_at": "2024-01-01T00:00:00"
            }
        ]

    Security:
        Only admin users can access this endpoint.
    """
    query = """
        SELECT id, task, model_id, enabled, priority, override_config, created_at, updated_at
        FROM model_configuration
        WHERE 1=1
    """
    params = {}

    if task:
        query += " AND task = :task"
        params["task"] = task

    query += " ORDER BY task, priority"

    result = await db.execute(text(query), params)
    rows = result.fetchall()

    return [
        ModelConfigItem(
            id=row[0],
            task=row[1],
            model_id=row[2],
            enabled=row[3],
            priority=row[4],
            override_config=row[5],
            created_at=row[6],
            updated_at=row[7],
        )
        for row in rows
    ]


@router.get("/models/tasks")
async def get_model_tasks(admin: AdminUser, db: AsyncSession = Depends(get_db)) -> List[Dict[str, Any]]:
    """
    Get distinct model tasks.

    Returns summary of all AI tasks with model configuration counts.
    Useful for building navigation UI or understanding which tasks have
    configured models.

    Args:
        admin: Authenticated admin user (from dependency injection)
        db: Database session (from dependency injection)

    Returns:
        List of dicts with task, model_count, and enabled_count fields.
        Example:
        [
            {
                "task": "classification",
                "model_count": 3,
                "enabled_count": 2
            }
        ]

    Security:
        Only admin users can access this endpoint.
    """
    result = await db.execute(text("""
        SELECT DISTINCT task,
               COUNT(*) as model_count,
               SUM(CASE WHEN enabled THEN 1 ELSE 0 END) as enabled_count
        FROM model_configuration
        GROUP BY task
        ORDER BY task
    """))
    return [
        {"task": row[0], "model_count": row[1], "enabled_count": row[2]}
        for row in result.fetchall()
    ]


@router.put("/models/{config_id}")
async def update_model_config(
    config_id: int,
    request: ModelConfigUpdateRequest,
    admin: AdminUser,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Update model configuration.

    Updates an existing model configuration with partial updates.
    Only provided fields are updated - null/missing fields are ignored.
    Useful for enabling/disabling models or adjusting priority without
    changing other settings.

    Args:
        config_id: Model configuration ID (from model_configuration table)
        request: Update request with optional fields
        admin: Authenticated admin user (from dependency injection)
        db: Database session (from dependency injection)

    Returns:
        Dict with success status and message.
        Example: {"success": true, "message": "Model configuration updated"}

    Raises:
        HTTPException 404: Model configuration not found
        HTTPException 400: No fields provided to update

    Side Effects:
        Updates model_configuration table and sets updated_at to current time.

    Security:
        Only admin users can access this endpoint.
    """
    updates = []
    params = {"config_id": config_id}

    if request.model_id is not None:
        updates.append("model_id = :model_id")
        params["model_id"] = request.model_id

    if request.enabled is not None:
        updates.append("enabled = :enabled")
        params["enabled"] = request.enabled

    if request.priority is not None:
        updates.append("priority = :priority")
        params["priority"] = request.priority

    if request.override_config is not None:
        updates.append("override_config = :override_config")
        params["override_config"] = request.override_config

    if not updates:
        raise HTTPException(status_code=400, detail="No fields to update")

    updates.append("updated_at = NOW()")

    query = f"UPDATE model_configuration SET {', '.join(updates)} WHERE id = :config_id"
    result = await db.execute(text(query), params)
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Model config not found")

    return {"success": True, "message": "Model configuration updated"}


@router.post("/models/")
async def create_model_config(
    admin: AdminUser,
    task: str = Query(...),
    model_id: str = Query(...),
    enabled: bool = True,
    priority: int = 1,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Create new model configuration.

    Adds a new LLM model configuration for an AI enrichment task.
    Models with higher priority are tried first in fallback chains.
    This enables multi-model fallback strategies for improved reliability.

    Args:
        admin: Authenticated admin user (from dependency injection)
        task: Task name (e.g., "classification", "tagging", "embedding")
        model_id: Ollama model ID (e.g., "qwen2.5:3b", "llama2:7b")
        enabled: Whether model is active (default: True)
        priority: Priority order for fallback (higher = tried first, default: 1)
        db: Database session (from dependency injection)

    Returns:
        Dict with success status, new config ID, and message.
        Example: {"success": true, "id": 5, "message": "Created model config for classification"}

    Raises:
        HTTPException 409: Configuration already exists for this task/model combination

    Side Effects:
        Inserts new row into model_configuration table.

    Security:
        Only admin users can access this endpoint.
    """
    # Check if already exists
    check = await db.execute(text(
        "SELECT id FROM model_configuration WHERE task = :task AND model_id = :model_id"
    ), {"task": task, "model_id": model_id})
    if check.fetchone():
        raise HTTPException(status_code=409, detail="Configuration already exists for this task/model")

    result = await db.execute(text("""
        INSERT INTO model_configuration (task, model_id, enabled, priority)
        VALUES (:task, :model_id, :enabled, :priority)
        RETURNING id
    """), {"task": task, "model_id": model_id, "enabled": enabled, "priority": priority})
    await db.commit()

    new_id = result.scalar()
    return {"success": True, "id": new_id, "message": f"Created model config for {task}"}


@router.delete("/models/{config_id}")
async def delete_model_config(
    admin: AdminUser,
    config_id: int,
    db: AsyncSession = Depends(get_db)
) -> Dict[str, Any]:
    """
    Delete model configuration.

    Removes a model configuration from the system.
    Use this to clean up unused model configs or remove deprecated models.

    Args:
        admin: Authenticated admin user (from dependency injection)
        config_id: Model configuration ID to delete
        db: Database session (from dependency injection)

    Returns:
        Dict with success status and message.
        Example: {"success": true, "message": "Model configuration deleted"}

    Raises:
        HTTPException 404: Model configuration not found

    Side Effects:
        Permanently deletes row from model_configuration table.

    Security:
        Only admin users can access this endpoint.
    """
    result = await db.execute(text(
        "DELETE FROM model_configuration WHERE id = :config_id"
    ), {"config_id": config_id})
    await db.commit()

    if result.rowcount == 0:
        raise HTTPException(status_code=404, detail="Model config not found")

    return {"success": True, "message": "Model configuration deleted"}


# Environment Variables Endpoint

ENV_VAR_ALLOWLIST: Dict[str, str] = {
    "HARDWARE_TIER": "Auto-detected hardware tier (laptop, laptop-gpu, server, server-gpu)",
    "POSTGRES_HOST": "PostgreSQL database host",
    "POSTGRES_PORT": "PostgreSQL database port",
    "REDIS_HOST": "Redis cache host",
    "REDIS_PORT": "Redis cache port",
    "MINIO_ENDPOINT": "MinIO S3-compatible storage endpoint",
    "OLLAMA_HOST": "Ollama LLM server host",
    "LLM_MODEL": "Default LLM model for classification",
    "TELEGRAM_SESSION_NAME": "Telegram session identifier",
    "LOG_LEVEL": "Application logging level",
    "ENVIRONMENT": "Deployment environment (development/production)",
}

# Patterns for secrets that should be masked
SECRET_PATTERNS = [
    r".*PASSWORD.*",
    r".*SECRET.*",
    r".*KEY.*",
    r".*TOKEN.*",
    r".*API_ID.*",
    r".*API_HASH.*",
]


def is_secret_key(key: str) -> bool:
    """
    Check if an environment variable key should be treated as a secret.

    Uses regex pattern matching to identify sensitive environment variables
    that should be masked in API responses.

    Args:
        key: Environment variable name to check

    Returns:
        True if key matches any secret pattern, False otherwise

    Secret Patterns:
        - PASSWORD, SECRET, KEY, TOKEN, API_ID, API_HASH (case-insensitive)
    """
    return any(re.match(pattern, key, re.IGNORECASE) for pattern in SECRET_PATTERNS)


def mask_value(key: str, value: str) -> str:
    """
    Mask secret values, showing only first/last 2 chars.

    Protects sensitive values while still allowing identification.
    For example, "abcd1234efgh" becomes "ab******gh".

    Args:
        key: Environment variable name (determines if masking is needed)
        value: Raw environment variable value

    Returns:
        Masked value if key is secret, otherwise original value.
        Values <=4 chars are fully masked as "****".

    Security:
        Secret detection uses is_secret_key() pattern matching.
    """
    if is_secret_key(key):
        if len(value) <= 4:
            return "****"
        return f"{value[:2]}{'*' * (len(value) - 4)}{value[-2:]}"
    return value


class EnvVarItem(BaseModel):
    """Environment variable display item."""
    key: str
    value: str
    description: str
    mutable: bool = False
    source: str = "environment"
    is_secret: bool = False


class EnvVarsResponse(BaseModel):
    """Environment variables response."""
    env_vars: List[EnvVarItem]
    timestamp: datetime


@router.get("/env", response_model=EnvVarsResponse)
async def get_env_vars(admin: AdminUser) -> EnvVarsResponse:
    """
    Get read-only environment variables for display.

    Returns allowlisted environment variables with descriptions and metadata.
    Useful for debugging deployment issues or verifying configuration.
    Secret values (passwords, tokens, API keys) are automatically masked.

    Environment variables are divided into two categories:
    1. Allowlisted variables (defined in ENV_VAR_ALLOWLIST)
    2. OSINT_* prefixed variables (platform-specific overrides)

    Args:
        admin: Authenticated admin user (from dependency injection)

    Returns:
        EnvVarsResponse with list of environment variables and timestamp.
        Each variable includes:
        - key: Variable name
        - value: Masked or plain value
        - description: Human-readable description
        - mutable: Always False (env vars are read-only)
        - source: Always "environment"
        - is_secret: True if value is masked

    Security:
        Only admin users can access this endpoint.
        Secret values are masked using mask_value() function.
        Only allowlisted and OSINT_* variables are exposed.

    Important:
        This endpoint is read-only. Environment variables cannot be modified
        via API - they must be changed in .env or deployment config and
        services restarted.
    """
    result = []

    for key, description in ENV_VAR_ALLOWLIST.items():
        value = os.environ.get(key)
        if value is not None:
            result.append(EnvVarItem(
                key=key,
                value=mask_value(key, value),
                description=description,
                mutable=False,
                source="environment",
                is_secret=is_secret_key(key),
            ))

    # Also include any OSINT_* prefixed vars
    for key, value in os.environ.items():
        if key.startswith("OSINT_") and key not in ENV_VAR_ALLOWLIST:
            result.append(EnvVarItem(
                key=key,
                value=mask_value(key, value),
                description=f"Platform override: {key}",
                mutable=False,
                source="environment",
                is_secret=is_secret_key(key),
            ))

    # Sort by key name
    result.sort(key=lambda x: x.key)

    return EnvVarsResponse(
        env_vars=result,
        timestamp=datetime.now(),
    )
