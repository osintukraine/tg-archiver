"""
Flowsint Export API - Export network graph data to Flowsint format

Provides endpoints to export intelligence graph data in Flowsint-compatible format
for advanced investigation and analysis in standalone Flowsint deployment.

Flowsint Format:
- Nodes with unique IDs, labels, types, and properties
- Edges with source/target references, labels, and weights
- Metadata for context and attribution
"""

from fastapi import APIRouter, Depends, HTTPException, Query, Response
from fastapi.responses import JSONResponse
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, text
from typing import List, Dict, Any
import json
from datetime import datetime

from shared.python.models import Message, Channel
from ..database import get_db

router = APIRouter(prefix="/api/messages", tags=["flowsint"])


@router.get("/{message_id}/network/export")
async def export_network_to_flowsint(
    message_id: int,
    format: str = Query("flowsint", description="Export format (flowsint, gephi, graphml)"),
    include_similar: bool = Query(True, description="Include similar messages"),
    similarity_threshold: float = Query(0.8, ge=0.5, le=1.0),
    db: AsyncSession = Depends(get_db),
):
    """
    Export network graph data to Flowsint format for external investigation.

    **Flowsint Export Format**:
    ```json
    {
      "graph": {
        "nodes": [
          {
            "id": "msg-123",
            "label": "Message about...",
            "type": "message",
            "properties": {
              "importance_level": "high",
              "channel": "Demo Channel",
              "created_at": "2025-11-11T..."
            }
          }
        ],
        "edges": [
          {
            "id": "edge-1",
            "source": "msg-123",
            "target": "entity-45",
            "label": "mentions",
            "weight": 0.95,
            "type": "entity_match"
          }
        ]
      },
      "metadata": {
        "exported_at": "2025-11-11T...",
        "source": "OSINT Intelligence Platform",
        "message_id": 123,
        "total_nodes": 22,
        "total_edges": 21
      }
    }
    ```

    **Usage**:
    1. Export data from this endpoint
    2. Import JSON into Flowsint via UI or API
    3. Perform advanced graph analysis (centrality, communities, etc.)
    4. Export findings back or share visualizations
    """

    # Get message with full context
    result = await db.execute(
        select(Message)
        .join(Message.channel)
        .where(Message.id == message_id)
    )
    message = result.scalar_one_or_none()

    if not message:
        raise HTTPException(status_code=404, detail="Message not found")

    # Build nodes and edges (reuse network graph logic)
    nodes: List[Dict[str, Any]] = []
    edges: List[Dict[str, Any]] = []

    # Center node: The message
    nodes.append({
        "id": f"msg-{message.id}",
        "label": (message.content_translated or message.content or "")[:100],
        "type": "message",
        "properties": {
            "content": message.content_translated or message.content,
            "importance_level": message.importance_level,
            "osint_topic": message.osint_topic,
            "channel": message.channel.name if message.channel else None,
            "telegram_date": message.telegram_date.isoformat() if message.telegram_date else None,
            "created_at": message.created_at.isoformat(),
            "is_spam": message.is_spam,
            "sentiment": message.content_sentiment,
            "urgency": message.content_urgency_level,
        }
    })

    # Query curated entity matches
    curated_query = text("""
        SELECT
            me.entity_id,
            me.similarity_score,
            me.match_type,
            ce.entity_type,
            ce.name,
            ce.description,
            ce.source_reference
        FROM message_entities me
        JOIN curated_entities ce ON me.entity_id = ce.id
        WHERE me.message_id = :message_id
        ORDER BY me.similarity_score DESC
        LIMIT 50
    """)

    curated_result = await db.execute(curated_query, {"message_id": message_id})
    curated_entities = list(curated_result)

    # Add curated entity nodes and edges
    for row in curated_entities:
        node_id = f"entity-{row.entity_id}"

        nodes.append({
            "id": node_id,
            "label": row.name,
            "type": f"curated_{row.entity_type}",
            "properties": {
                "entity_type": row.entity_type,
                "description": row.description,
                "source": row.source_reference,
                "match_type": row.match_type,
                "confidence": float(row.similarity_score)
            }
        })

        edges.append({
            "id": f"edge-msg-{message.id}-entity-{row.entity_id}",
            "source": f"msg-{message.id}",
            "target": node_id,
            "label": f"{row.match_type} ({int(row.similarity_score * 100)}%)",
            "weight": float(row.similarity_score),
            "type": "entity_match",
            "properties": {
                "match_method": row.match_type,
                "confidence": float(row.similarity_score)
            }
        })

    # Query AI tags
    tags_query = text("""
        SELECT tag, tag_type, confidence, generated_by
        FROM message_tags
        WHERE message_id = :message_id
        AND confidence >= 0.5
        ORDER BY confidence DESC
        LIMIT 20
    """)

    tags_result = await db.execute(tags_query, {"message_id": message_id})
    ai_tags = list(tags_result)

    # Add AI tag nodes and edges
    for idx, row in enumerate(ai_tags):
        node_id = f"tag-{row.tag_type}-{idx}"

        nodes.append({
            "id": node_id,
            "label": row.tag,
            "type": f"ai_tag_{row.tag_type}",
            "properties": {
                "tag": row.tag,
                "tag_type": row.tag_type,
                "confidence": float(row.confidence),
                "generated_by": row.generated_by
            }
        })

        edges.append({
            "id": f"edge-msg-{message.id}-tag-{idx}",
            "source": f"msg-{message.id}",
            "target": node_id,
            "label": f"{row.tag_type} ({int(row.confidence * 100)}%)",
            "weight": float(row.confidence),
            "type": "ai_tag",
            "properties": {
                "tag_type": row.tag_type,
                "confidence": float(row.confidence)
            }
        })

    # Build Flowsint-compatible export
    flowsint_export = {
        "graph": {
            "nodes": nodes,
            "edges": edges
        },
        "metadata": {
            "exported_at": datetime.utcnow().isoformat(),
            "source": "OSINT Intelligence Platform",
            "source_url": f"http://localhost:3000/messages/{message_id}",
            "message_id": message_id,
            "total_nodes": len(nodes),
            "total_edges": len(edges),
            "entity_sources": list(set(row.source_reference for row in curated_entities)),
            "export_format": format
        }
    }

    # Return as downloadable JSON
    return Response(
        content=json.dumps(flowsint_export, indent=2),
        media_type="application/json",
        headers={
            "Content-Disposition": f"attachment; filename=flowsint-export-{message_id}.json"
        }
    )
