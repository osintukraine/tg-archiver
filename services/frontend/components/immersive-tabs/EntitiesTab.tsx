'use client';

/**
 * EntitiesTab Component
 *
 * Full entity matches display:
 * - OpenSanctions entities (full cards with risk classification, datasets, aliases)
 * - Curated entities grouped by entity_type (equipment, military_unit, etc.)
 * - Legacy entities (deprecated regex-based)
 * - Source distribution chart
 */

import type { Message, Channel, CuratedEntityMatch } from '@/lib/types';
import EntityChip from '../EntityChip';

interface EntitiesTabProps {
  message: Message;
  channel?: Channel;
}

// Entity type icons for grouping
const ENTITY_TYPE_LABELS: Record<string, { label: string; icon: string; color: string }> = {
  equipment: { label: 'Military Equipment', icon: '⚔️', color: 'text-blue-400' },
  military_unit: { label: 'Military Units', icon: '🎖️', color: 'text-purple-400' },
  aircraft: { label: 'Aircraft', icon: '🚁', color: 'text-cyan-400' },
  ship: { label: 'Naval Vessels', icon: '⛴️', color: 'text-teal-400' },
  individual: { label: 'Individuals', icon: '👤', color: 'text-green-400' },
  organization: { label: 'Organizations', icon: '🏢', color: 'text-yellow-400' },
  location: { label: 'Locations', icon: '📍', color: 'text-orange-400' },
  event: { label: 'Events', icon: '📅', color: 'text-pink-400' },
};

// Helper to format legacy entities
function formatLegacyEntities(entities: Record<string, any> | null | undefined): { type: string; items: string[] }[] {
  if (!entities) return [];

  const formatted: { type: string; items: string[] }[] = [];

  // Extract hashtags
  if (entities.hashtags && Array.isArray(entities.hashtags) && entities.hashtags.length > 0) {
    formatted.push({
      type: 'Hashtags',
      items: entities.hashtags.map((tag: string) => `#${tag}`)
    });
  }

  // Extract mentions
  if (entities.mentions && Array.isArray(entities.mentions) && entities.mentions.length > 0) {
    formatted.push({
      type: 'Mentions',
      items: entities.mentions.map((mention: string) =>
        mention.startsWith('@') ? mention : `@${mention}`
      )
    });
  }

  // Extract locations
  if (entities.locations && Array.isArray(entities.locations) && entities.locations.length > 0) {
    formatted.push({
      type: 'Locations',
      items: entities.locations.map((loc: any) => loc.name || 'Unknown Location')
    });
  }

  return formatted;
}

export default function EntitiesTab({ message }: EntitiesTabProps) {
  const hasOpenSanctions = message.opensanctions_entities && message.opensanctions_entities.length > 0;
  const hasCurated = message.curated_entities && message.curated_entities.length > 0;
  const legacyEntities = formatLegacyEntities(message.entities);
  const hasLegacy = legacyEntities.length > 0;

  const hasAnyEntities = hasOpenSanctions || hasCurated || hasLegacy;

  if (!hasAnyEntities) {
    return (
      <div className="flex items-center justify-center min-h-[300px]">
        <div className="text-center text-text-tertiary">
          <div className="text-4xl mb-2">🏷️</div>
          <p>No entity matches found</p>
          <p className="text-xs mt-2">Entities are detected through AI matching and knowledge graph lookups</p>
        </div>
      </div>
    );
  }

  // Group curated entities by type
  const curatedByType: Record<string, CuratedEntityMatch[]> = {};
  if (hasCurated && message.curated_entities) {
    message.curated_entities.forEach(entity => {
      if (!curatedByType[entity.entity_type]) {
        curatedByType[entity.entity_type] = [];
      }
      curatedByType[entity.entity_type]!.push(entity);
    });
  }

  // Calculate source distribution for curated entities
  const sourceDistribution: Record<string, number> = {};
  if (hasCurated) {
    message.curated_entities!.forEach(entity => {
      const source = entity.source_reference;
      sourceDistribution[source] = (sourceDistribution[source] || 0) + 1;
    });
  }

  return (
    <div className="space-y-6">
      {/* OpenSanctions Entities (High Priority) */}
      {hasOpenSanctions && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🚨</span>
            <h3 className="text-sm font-medium text-red-400">
              Sanctioned / High-Risk Entities ({message.opensanctions_entities!.length})
            </h3>
          </div>
          <div className="bg-red-500/5 border border-red-500/20 rounded-lg p-4">
            <p className="text-xs text-text-secondary mb-4">
              These entities appear in international sanctions databases, PEP registries, or criminal watchlists.
              Data sourced from OpenSanctions (aggregates OFAC, EU, UN, Interpol, and other official sources).
            </p>
            <div className="grid grid-cols-1 gap-3">
              {message.opensanctions_entities!.map((entity, idx) => (
                <div key={idx}>
                  <EntityChip entity={entity} mode="detailed" />
                  {/* Additional details for OpenSanctions */}
                  {entity.aliases && entity.aliases.length > 0 && (
                    <div className="mt-2 ml-4 text-xs text-text-tertiary">
                      <span className="font-medium">Known aliases:</span>{' '}
                      {entity.aliases.slice(0, 5).join(', ')}
                      {entity.aliases.length > 5 && ` (+${entity.aliases.length - 5} more)`}
                    </div>
                  )}
                  {entity.description && (
                    <div className="mt-2 ml-4 text-xs text-text-secondary line-clamp-2">
                      {entity.description}
                    </div>
                  )}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Curated Knowledge Graph Entities */}
      {hasCurated && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">🗂️</span>
            <h3 className="text-sm font-medium text-blue-400">
              Knowledge Graph Matches ({message.curated_entities!.length})
            </h3>
          </div>
          <div className="bg-blue-500/5 border border-blue-500/20 rounded-lg p-4">
            <p className="text-xs text-text-secondary mb-4">
              Matched against 1,425+ curated entities from ArmyGuide, Root.NK, and ODIN databases.
              Includes military equipment, units, individuals, and organizations.
            </p>

            {/* Grouped by entity type */}
            <div className="space-y-6">
              {Object.entries(curatedByType).map(([type, entities]) => {
                const typeInfo = ENTITY_TYPE_LABELS[type] || {
                  label: type.replace('_', ' '),
                  icon: '🏷️',
                  color: 'text-text-secondary'
                };

                return (
                  <div key={type}>
                    <div className={`flex items-center gap-2 mb-3 ${typeInfo.color}`}>
                      <span>{typeInfo.icon}</span>
                      <h4 className="text-sm font-medium capitalize">
                        {typeInfo.label} ({entities.length})
                      </h4>
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 gap-3 ml-6">
                      {entities.map((entity, idx) => (
                        <EntityChip key={idx} entity={entity} mode="detailed" />
                      ))}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* Source Distribution */}
      {hasCurated && Object.keys(sourceDistribution).length > 0 && (
        <div>
          <h3 className="text-sm font-medium text-text-tertiary mb-3">Source Distribution</h3>
          <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
            <div className="space-y-2">
              {Object.entries(sourceDistribution)
                .sort(([, a], [, b]) => b - a)
                .map(([source, count]) => {
                  const percentage = (count / message.curated_entities!.length) * 100;
                  return (
                    <div key={source}>
                      <div className="flex items-center justify-between text-sm mb-1">
                        <span className="text-text-secondary">{source}</span>
                        <span className="text-text-primary font-medium">{count} match{count !== 1 ? 'es' : ''}</span>
                      </div>
                      <div className="w-full bg-bg-tertiary rounded-full h-2">
                        <div
                          className="bg-accent-primary rounded-full h-2 transition-all duration-300"
                          style={{ width: `${percentage}%` }}
                        />
                      </div>
                    </div>
                  );
                })}
            </div>
          </div>
        </div>
      )}

      {/* Legacy Entities (Deprecated) */}
      {hasLegacy && (
        <div>
          <div className="flex items-center gap-2 mb-4">
            <span className="text-xl">⚠️</span>
            <h3 className="text-sm font-medium text-text-tertiary">
              Legacy Entities (Deprecated)
            </h3>
          </div>
          <div className="bg-gray-500/5 border border-gray-500/20 rounded-lg p-4">
            <p className="text-xs text-text-secondary mb-4">
              These entities were detected using legacy regex-based extraction.
              This method is deprecated in favor of AI-powered entity matching.
            </p>
            <div className="space-y-4">
              {legacyEntities.map(({ type, items }) => (
                <div key={type}>
                  <div className="text-xs text-text-tertiary mb-2 font-medium">{type}</div>
                  <div className="flex flex-wrap gap-2">
                    {items.map((item, idx) => (
                      <span
                        key={idx}
                        className="px-3 py-1.5 rounded text-sm bg-gray-500/15 text-gray-400 border border-gray-500/30"
                      >
                        {item}
                      </span>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* Entity Matching Info */}
      <div className="bg-bg-secondary rounded-lg p-4 border border-border-subtle">
        <h3 className="text-sm font-medium text-text-tertiary mb-3">About Entity Matching</h3>
        <div className="text-xs text-text-secondary space-y-2">
          <p>
            <strong className="text-text-primary">OpenSanctions:</strong> Real-time matching against
            international sanctions lists, PEP databases, and criminal watchlists. Updated daily from official sources.
          </p>
          <p>
            <strong className="text-text-primary">Knowledge Graph:</strong> Semantic matching against
            1,425+ curated entities from military intelligence databases (ArmyGuide, Root.NK, ODIN).
          </p>
          <p>
            <strong className="text-text-primary">Match Types:</strong>
          </p>
          <ul className="list-disc list-inside ml-2 space-y-1">
            <li><strong>exact_name:</strong> Direct name match</li>
            <li><strong>alias:</strong> Matched known alias or alternative name</li>
            <li><strong>hashtag:</strong> Matched entity-specific hashtag</li>
            <li><strong>semantic:</strong> AI-powered similarity match</li>
          </ul>
        </div>
      </div>
    </div>
  );
}
