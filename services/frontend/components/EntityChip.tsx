'use client';

/**
 * EntityChip Component
 *
 * Display curated and OpenSanctions entity matches.
 * Two variants: curated (blue) and OpenSanctions (red warning).
 */

import type { CuratedEntityMatch, OpenSanctionsEntityMatch } from '@/lib/types';

interface EntityChipProps {
  entity: CuratedEntityMatch | OpenSanctionsEntityMatch;
  mode?: 'compact' | 'detailed' | 'immersive';
  maxWidth?: string;
  onClick?: () => void;
}

const ENTITY_TYPE_ICONS: Record<string, string> = {
  // Curated entities
  equipment: '⚔️',
  military_unit: '🎖️',
  aircraft: '🚁',
  ship: '⛴️',
  individual: '👤',
  organization: '🏢',
  location: '📍',
  event: '📅',

  // OpenSanctions (always use warning icon)
  Person: '🔴',
  Organization: '🔴',
  Company: '🔴',
  LegalEntity: '🔴',
  PublicBody: '🔴',
  Family: '🔴',
  default: '🔴'
};

const CURATED_COLORS: Record<string, string> = {
  equipment: 'bg-blue-500/15 text-blue-400 border-blue-500/30',
  military_unit: 'bg-purple-500/15 text-purple-400 border-purple-500/30',
  aircraft: 'bg-cyan-500/15 text-cyan-400 border-cyan-500/30',
  ship: 'bg-teal-500/15 text-teal-400 border-teal-500/30',
  individual: 'bg-green-500/15 text-green-400 border-green-500/30',
  organization: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/30',
  location: 'bg-orange-500/15 text-orange-400 border-orange-500/30',
  event: 'bg-pink-500/15 text-pink-400 border-pink-500/30',
  default: 'bg-blue-500/15 text-blue-400 border-blue-500/30'
};

const SANCTIONS_COLORS: Record<string, string> = {
  sanctioned: 'bg-red-500/20 text-red-400 border-red-500/40',
  pep: 'bg-orange-500/20 text-orange-400 border-orange-500/40',
  criminal: 'bg-red-600/20 text-red-500 border-red-600/40',
  corporate: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/40',
  default: 'bg-red-500/20 text-red-400 border-red-500/40'
};

// Type guard to check if entity is OpenSanctions
function isOpenSanctionsEntity(entity: CuratedEntityMatch | OpenSanctionsEntityMatch): entity is OpenSanctionsEntityMatch {
  return 'opensanctions_id' in entity;
}

// Type guard to check if entity is Curated
function isCuratedEntity(entity: CuratedEntityMatch | OpenSanctionsEntityMatch): entity is CuratedEntityMatch {
  return 'source_reference' in entity;
}

export default function EntityChip({
  entity,
  mode = 'compact',
  maxWidth,
  onClick
}: EntityChipProps) {
  const isOpenSanctions = isOpenSanctionsEntity(entity);
  const isCurated = isCuratedEntity(entity);
  const isCompact = mode === 'compact';

  if (isOpenSanctions) {
    // OpenSanctions entity (sanctioned/PEP/criminal)
    const riskColor = SANCTIONS_COLORS[entity.risk_classification] || SANCTIONS_COLORS.default;
    const icon = ENTITY_TYPE_ICONS[entity.entity_type] || ENTITY_TYPE_ICONS.default;
    const confidence = Math.round(entity.match_score * 100);
    const primaryDataset = entity.datasets[0] || 'SANCTIONED';

    if (isCompact) {
      return (
        <span
          className={`
            inline-flex items-center gap-1
            ${riskColor}
            border rounded
            px-2 py-0.5 text-xs
            whitespace-nowrap
            ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
            ${maxWidth ? `max-w-[${maxWidth}]` : 'max-w-xs'}
            overflow-hidden
          `}
          onClick={onClick}
          title={`${entity.name} - ${primaryDataset} (${confidence}% match)`}
        >
          <span>{icon}</span>
          <span className="font-medium truncate">{entity.name}</span>
          <span className="text-[10px] opacity-80">{primaryDataset}</span>
        </span>
      );
    }

    // Detailed mode
    return (
      <div
        className={`
          ${riskColor}
          border-2 rounded-lg
          p-3
          ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
          ${maxWidth || 'max-w-md'}
        `}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <span className="font-medium">{entity.name}</span>
          </div>
          <span className="text-xs px-2 py-0.5 rounded bg-current/20 whitespace-nowrap">
            {entity.risk_classification.toUpperCase()}
          </span>
        </div>

        <div className="text-xs opacity-80 mb-2">
          {entity.entity_type} • {confidence}% match
        </div>

        <div className="flex flex-wrap gap-1">
          {entity.datasets.slice(0, 3).map((dataset, idx) => (
            <span
              key={idx}
              className="text-[10px] px-1.5 py-0.5 rounded bg-current/10 border border-current/20"
            >
              {dataset}
            </span>
          ))}
          {entity.datasets.length > 3 && (
            <span className="text-[10px] px-1.5 py-0.5 opacity-60">
              +{entity.datasets.length - 3} more
            </span>
          )}
        </div>
      </div>
    );
  }

  if (isCurated) {
    // Curated entity (equipment/military units/etc.)
    const typeColor = CURATED_COLORS[entity.entity_type] || CURATED_COLORS.default;
    const icon = ENTITY_TYPE_ICONS[entity.entity_type] || '🏷️';
    const confidence = Math.round(entity.similarity_score * 100);

    if (isCompact) {
      return (
        <span
          className={`
            inline-flex items-center gap-1
            ${typeColor}
            border rounded
            px-2 py-0.5 text-xs
            whitespace-nowrap
            ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
            ${maxWidth ? `max-w-[${maxWidth}]` : 'max-w-xs'}
            overflow-hidden
          `}
          onClick={onClick}
          title={`${entity.name} (${entity.entity_type}) - ${confidence}% match from ${entity.source_reference}`}
        >
          <span>{icon}</span>
          <span className="font-medium truncate">{entity.name}</span>
          <span className="text-[10px] opacity-80">{confidence}%</span>
        </span>
      );
    }

    // Detailed mode
    return (
      <div
        className={`
          ${typeColor}
          border rounded-lg
          p-3
          ${onClick ? 'cursor-pointer hover:opacity-80' : ''}
          ${maxWidth || 'max-w-md'}
        `}
        onClick={onClick}
      >
        <div className="flex items-start justify-between gap-2 mb-2">
          <div className="flex items-center gap-2">
            <span className="text-xl">{icon}</span>
            <span className="font-medium">{entity.name}</span>
          </div>
          <span className="text-lg font-bold">{confidence}%</span>
        </div>

        {entity.description && (
          <div className="text-xs opacity-80 mb-2 line-clamp-2">
            {entity.description}
          </div>
        )}

        <div className="flex items-center gap-2 text-xs opacity-70">
          <span className="capitalize">{entity.entity_type.replace('_', ' ')}</span>
          <span>•</span>
          <span>{entity.match_type}</span>
          <span>•</span>
          <span>{entity.source_reference}</span>
        </div>
      </div>
    );
  }

  return null;
}
