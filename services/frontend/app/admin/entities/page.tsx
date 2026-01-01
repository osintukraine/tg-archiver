'use client';

import { useState, useEffect, useCallback } from 'react';
import { Badge, StatCard, DataTable } from '@/components/admin';
import { adminApi } from '@/lib/admin-api';

/**
 * Admin - Entities Management
 *
 * Browse and search curated military/political entities.
 */

interface Entity {
  id: number;
  entity_type: string;
  name: string;
  aliases: string[] | null;
  description: string | null;
  latitude: number | null;
  longitude: number | null;
  source_reference: string;
  metadata: Record<string, unknown> | null;
  notes: string | null;
  has_embedding: boolean;
  mention_count: number;
  created_at: string | null;
  updated_at: string | null;
}

interface EntityStats {
  total_entities: number;
  entities_with_embeddings: number;
  entities_with_coordinates: number;
  by_type: Record<string, number>;
  by_source: Record<string, number>;
  top_mentioned: Array<{id: number; name: string; type: string; mentions: number}>;
}

const ENTITY_TYPES = [
  'equipment', 'individual', 'organization', 'location', 'event',
  'military_unit', 'ship', 'aircraft', 'military_vehicle',
  'military_weapon', 'electronic_warfare', 'component'
];

const TYPE_COLORS: Record<string, 'default' | 'success' | 'warning' | 'error' | 'info'> = {
  individual: 'info',
  organization: 'success',
  military_unit: 'warning',
  equipment: 'default',
  location: 'default',
  ship: 'info',
  aircraft: 'warning',
  military_vehicle: 'default',
  military_weapon: 'error',
};

export default function EntitiesPage() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [stats, setStats] = useState<EntityStats | null>(null);
  const [sources, setSources] = useState<{source: string; count: number}[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [page, setPage] = useState(1);
  const [totalPages, setTotalPages] = useState(1);
  const [total, setTotal] = useState(0);

  // Filters
  const [search, setSearch] = useState('');
  const [entityType, setEntityType] = useState<string>('');
  const [source, setSource] = useState<string>('');
  const [hasLocation, setHasLocation] = useState<boolean | undefined>(undefined);

  // Selected entity detail
  const [selectedEntity, setSelectedEntity] = useState<Entity | null>(null);

  const fetchEntities = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams({
        page: page.toString(),
        page_size: '25',
        sort_by: 'mention_count',
        sort_order: 'desc',
      });
      if (search) params.append('search', search);
      if (entityType) params.append('entity_type', entityType);
      if (source) params.append('source', source);
      if (hasLocation !== undefined) params.append('has_location', hasLocation.toString());

      const data = await adminApi.get(`/api/admin/entities?${params}`);
      setEntities(data.items);
      setTotalPages(data.total_pages);
      setTotal(data.total);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unknown error');
    } finally {
      setLoading(false);
    }
  }, [page, search, entityType, source, hasLocation]);

  const fetchStats = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/entities/stats');
      setStats(data);
    } catch (err) {
      console.error('Failed to fetch entity stats:', err);
    }
  }, []);

  const fetchSources = useCallback(async () => {
    try {
      const data = await adminApi.get('/api/admin/entities/sources');
      setSources(data);
    } catch (err) {
      console.error('Failed to fetch sources:', err);
    }
  }, []);

  useEffect(() => {
    fetchEntities();
  }, [fetchEntities]);

  useEffect(() => {
    fetchStats();
    fetchSources();
  }, [fetchStats, fetchSources]);

  const columns = [
    {
      key: 'name',
      label: 'Entity',
      render: (_: unknown, entity: Entity) => (
        <div>
          <div className="font-medium text-text-primary">{entity.name}</div>
          {entity.aliases && entity.aliases.length > 0 && (
            <div className="text-xs text-text-tertiary truncate max-w-xs">
              aka: {entity.aliases.slice(0, 2).join(', ')}
              {entity.aliases.length > 2 && ` +${entity.aliases.length - 2}`}
            </div>
          )}
        </div>
      ),
    },
    {
      key: 'entity_type',
      label: 'Type',
      render: (_: unknown, entity: Entity) => (
        <Badge variant={TYPE_COLORS[entity.entity_type] || 'default'} size="sm">
          {entity.entity_type.replace(/_/g, ' ')}
        </Badge>
      ),
    },
    {
      key: 'source_reference',
      label: 'Source',
      render: (_: unknown, entity: Entity) => (
        <span className="text-sm text-text-secondary">{entity.source_reference}</span>
      ),
    },
    {
      key: 'mention_count',
      label: 'Mentions',
      render: (_: unknown, entity: Entity) => (
        <span className="text-sm font-medium text-text-primary">
          {entity.mention_count.toLocaleString()}
        </span>
      ),
    },
    {
      key: 'status',
      label: 'Status',
      render: (_: unknown, entity: Entity) => (
        <div className="flex gap-1">
          {entity.has_embedding && (
            <Badge variant="success" size="sm">Embedded</Badge>
          )}
          {entity.latitude && entity.longitude && (
            <Badge variant="info" size="sm">Geo</Badge>
          )}
        </div>
      ),
    },
    {
      key: 'actions',
      label: '',
      render: (_: unknown, entity: Entity) => (
        <button
          onClick={() => setSelectedEntity(entity)}
          className="text-blue-500 hover:text-blue-400 text-sm"
        >
          View
        </button>
      ),
    },
  ];

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-start">
        <div>
          <h1 className="text-2xl font-bold text-text-primary">Entities</h1>
          <p className="text-text-secondary mt-1">
            Browse curated military and political entities
          </p>
        </div>
      </div>

      {/* Stats Cards */}
      {stats && (
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
          <StatCard
            title="Total Entities"
            value={stats.total_entities}
            icon={<span className="text-2xl">🎯</span>}
          />
          <StatCard
            title="With Embeddings"
            value={stats.entities_with_embeddings}
            icon={<span className="text-2xl">🧠</span>}
          />
          <StatCard
            title="With Coordinates"
            value={stats.entities_with_coordinates}
            icon={<span className="text-2xl">📍</span>}
          />
          <StatCard
            title="Filtered Results"
            value={total}
            icon={<span className="text-2xl">🔍</span>}
          />
        </div>
      )}

      {/* Type Distribution */}
      {stats && (
        <div className="glass p-4">
          <h3 className="text-sm font-medium text-text-secondary mb-3">By Entity Type</h3>
          <div className="flex flex-wrap gap-2">
            {Object.entries(stats.by_type).sort((a, b) => b[1] - a[1]).map(([type, count]) => (
              <button
                key={type}
                onClick={() => { setEntityType(type === entityType ? '' : type); setPage(1); }}
                className={`px-3 py-1 rounded-full text-xs border transition-colors ${
                  entityType === type
                    ? 'bg-blue-500 text-white border-blue-500'
                    : 'bg-bg-secondary text-text-secondary border-border-subtle hover:bg-bg-tertiary'
                }`}
              >
                {type.replace(/_/g, ' ')} ({count})
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filters */}
      <div className="glass p-4">
        <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
          <div className="col-span-2">
            <input
              type="text"
              placeholder="Search entities..."
              value={search}
              onChange={(e) => { setSearch(e.target.value); setPage(1); }}
              className="w-full bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
            />
          </div>
          <select
            value={entityType}
            onChange={(e) => { setEntityType(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Types</option>
            {ENTITY_TYPES.map((t) => (
              <option key={t} value={t}>{t.replace(/_/g, ' ')}</option>
            ))}
          </select>
          <select
            value={source}
            onChange={(e) => { setSource(e.target.value); setPage(1); }}
            className="bg-bg-secondary border border-border-subtle rounded px-3 py-2 text-sm"
          >
            <option value="">All Sources</option>
            {sources.map((s) => (
              <option key={s.source} value={s.source}>{s.source} ({s.count})</option>
            ))}
          </select>
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={hasLocation === true}
              onChange={(e) => setHasLocation(e.target.checked ? true : undefined)}
              className="rounded"
            />
            With location
          </label>
        </div>
      </div>

      {/* Error State */}
      {error && (
        <div className="glass p-8 text-center text-red-500">Error: {error}</div>
      )}

      {/* Table */}
      {!error && (
        <DataTable
          columns={columns}
          data={entities}
          keyExtractor={(entity) => entity.id}
          loading={loading}
          emptyMessage="No entities found"
        />
      )}

      {/* Pagination */}
      {totalPages > 1 && (
        <div className="flex justify-center gap-2">
          <button
            onClick={() => setPage((p) => Math.max(1, p - 1))}
            disabled={page === 1}
            className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
          >
            Previous
          </button>
          <span className="px-4 py-2 text-text-secondary">
            Page {page} of {totalPages}
          </span>
          <button
            onClick={() => setPage((p) => Math.min(totalPages, p + 1))}
            disabled={page === totalPages}
            className="px-4 py-2 bg-bg-secondary rounded disabled:opacity-50"
          >
            Next
          </button>
        </div>
      )}

      {/* Entity Detail Modal */}
      {selectedEntity && (
        <div
          className="fixed inset-0 bg-black/80 z-50 flex items-center justify-center p-4"
          onClick={() => setSelectedEntity(null)}
        >
          <div
            className="glass max-w-2xl w-full max-h-[90vh] overflow-auto"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="p-4 border-b border-border-subtle flex justify-between items-center">
              <div>
                <h3 className="font-semibold text-text-primary">{selectedEntity.name}</h3>
                <Badge variant={TYPE_COLORS[selectedEntity.entity_type] || 'default'} size="sm">
                  {selectedEntity.entity_type.replace(/_/g, ' ')}
                </Badge>
              </div>
              <button
                onClick={() => setSelectedEntity(null)}
                className="p-2 hover:bg-bg-secondary rounded-full"
              >
                <svg className="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
            <div className="p-4 space-y-4">
              {selectedEntity.description && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Description</div>
                  <p className="text-text-primary">{selectedEntity.description}</p>
                </div>
              )}
              {selectedEntity.aliases && selectedEntity.aliases.length > 0 && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Aliases</div>
                  <div className="flex flex-wrap gap-1">
                    {selectedEntity.aliases.map((alias, i) => (
                      <Badge key={i} variant="default" size="sm">{alias}</Badge>
                    ))}
                  </div>
                </div>
              )}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <div className="text-sm text-text-secondary mb-1">Source</div>
                  <p className="text-text-primary">{selectedEntity.source_reference}</p>
                </div>
                <div>
                  <div className="text-sm text-text-secondary mb-1">Mentions</div>
                  <p className="text-text-primary font-medium">{selectedEntity.mention_count}</p>
                </div>
              </div>
              {selectedEntity.latitude && selectedEntity.longitude && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Location</div>
                  <p className="text-text-primary">
                    {selectedEntity.latitude.toFixed(4)}, {selectedEntity.longitude.toFixed(4)}
                  </p>
                </div>
              )}
              {selectedEntity.notes && (
                <div>
                  <div className="text-sm text-text-secondary mb-1">Notes</div>
                  <p className="text-text-primary text-sm">{selectedEntity.notes}</p>
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
