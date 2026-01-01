'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { unifiedSearch } from '@/lib/api';
import type { UnifiedSearchResponse, SearchResultItem, SearchResultGroup } from '@/lib/types';
import LocationSearch from '@/components/search/LocationSearch';

type TabType = 'all' | 'messages' | 'events' | 'rss' | 'entities';

const TAB_LABELS: Record<TabType, string> = {
  all: 'All',
  messages: 'Messages',
  events: 'Events',
  rss: 'RSS Articles',
  entities: 'Entities',
};

function ResultCard({ item }: { item: SearchResultItem }) {
  const getLink = () => {
    switch (item.type) {
      case 'message': return `/messages/${item.id}`;
      case 'event': return `/events/${item.id}`;
      case 'rss': return item.metadata.url || '#';
      case 'entity': return `/entities/${item.metadata.source}/${item.id}`;
      default: return '#';
    }
  };

  const getIcon = () => {
    switch (item.type) {
      case 'message': return '💬';
      case 'event': return '📰';
      case 'rss': return '🌐';
      case 'entity': return '👤';
      default: return '📄';
    }
  };

  return (
    <Link
      href={getLink()}
      target={item.type === 'rss' ? '_blank' : undefined}
      className="block glass p-3 sm:p-4 hover:bg-bg-secondary/50 transition-colors"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="text-lg sm:text-xl flex-shrink-0">{getIcon()}</span>
        <div className="flex-1 min-w-0">
          <h3 className="font-medium text-text-primary line-clamp-2 sm:truncate">{item.title}</h3>
          {item.snippet && (
            <p className="text-sm text-text-secondary line-clamp-2 mt-1">{item.snippet}</p>
          )}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-xs text-text-tertiary">
            {item.score && <span>Score: {(item.score * 100).toFixed(0)}%</span>}
            {item.metadata.channel_name && <span>📢 {item.metadata.channel_name}</span>}
            {item.metadata.source_domain && <span>🌐 {item.metadata.source_domain}</span>}
            {item.metadata.entity_type && <span>🏷️ {item.metadata.entity_type}</span>}
          </div>
        </div>
      </div>
    </Link>
  );
}

function ResultGroup({
  title,
  group,
  onSeeAll
}: {
  title: string;
  group: SearchResultGroup;
  onSeeAll: () => void;
}) {
  if (group.items.length === 0) return null;

  return (
    <div className="mb-6">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-text-primary">
          {title} <span className="text-text-tertiary">({group.total})</span>
        </h2>
        {group.has_more && (
          <button
            onClick={onSeeAll}
            className="text-sm text-accent-primary hover:underline"
          >
            See all →
          </button>
        )}
      </div>
      <div className="space-y-2">
        {group.items.map((item) => (
          <ResultCard key={`${item.type}-${item.id}`} item={item} />
        ))}
      </div>
    </div>
  );
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [mode, setMode] = useState<'text' | 'semantic'>(
    (searchParams.get('mode') as 'text' | 'semantic') || 'text'
  );
  const [activeTab, setActiveTab] = useState<TabType>(
    (searchParams.get('tab') as TabType) || 'all'
  );
  const [location, setLocation] = useState<{
    name: string;
    lat: number;
    lng: number;
    radius_km: number;
  } | null>(null);
  const [results, setResults] = useState<UnifiedSearchResponse | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const performSearch = useCallback(async () => {
    if (!query.trim()) {
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const types = activeTab === 'all'
        ? 'messages,events,rss,entities'
        : activeTab;

      const searchParams: any = {
        q: query,
        mode,
        types,
        limit_per_type: activeTab === 'all' ? 5 : 20,
      };

      // Add location parameters if set
      if (location) {
        searchParams.lat = location.lat;
        searchParams.lng = location.lng;
        searchParams.radius_km = location.radius_km;
      }

      const response = await unifiedSearch(searchParams);
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, mode, activeTab, location]);

  useEffect(() => {
    performSearch();
  }, [performSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
    const params = new URLSearchParams();
    params.set('q', searchInput);
    params.set('mode', mode);
    params.set('tab', activeTab);
    router.push(`/search?${params.toString()}`);
  };

  const handleTabChange = (tab: TabType) => {
    setActiveTab(tab);
    const params = new URLSearchParams(searchParams.toString());
    params.set('tab', tab);
    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary">Search</h1>
        <p className="text-text-secondary mt-1">
          Search across messages, events, RSS articles, and entities
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="mb-6">
        <div className="flex flex-col gap-3">
          <div className="flex gap-2">
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder={mode === 'semantic' ? "Search by meaning..." : "Search by keywords..."}
              className="flex-1 bg-bg-secondary border border-border rounded-lg px-4 py-3 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
            />
            <button
              type="submit"
              disabled={loading}
              className="px-6 py-3 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/80 transition-colors disabled:opacity-50"
            >
              {loading ? 'Searching...' : 'Search'}
            </button>
          </div>

          {/* Search Mode Toggle */}
          <div className="flex flex-wrap items-center gap-2 sm:gap-3">
            <span className="text-sm text-text-tertiary">Mode:</span>
            <div className="flex bg-bg-secondary rounded-lg p-1">
              <button
                type="button"
                onClick={() => setMode('text')}
                className={`px-4 py-2 sm:px-3 sm:py-1.5 text-sm rounded transition-colors ${
                  mode === 'text'
                    ? 'bg-accent-primary text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                📝 Keywords
              </button>
              <button
                type="button"
                onClick={() => setMode('semantic')}
                className={`px-4 py-2 sm:px-3 sm:py-1.5 text-sm rounded transition-colors ${
                  mode === 'semantic'
                    ? 'bg-purple-600 text-white'
                    : 'text-text-secondary hover:text-text-primary'
                }`}
              >
                🧠 Semantic
              </button>
            </div>
            {results && (
              <span className="text-xs text-text-tertiary sm:ml-auto">
                {results.timing_ms}ms
              </span>
            )}
          </div>

          {/* Location Filter */}
          <div className="border-t border-border pt-3">
            <label className="block text-sm font-medium text-text-primary mb-2">
              📍 Filter by Location (Optional)
            </label>
            <LocationSearch
              onLocationSelect={(loc) => {
                setLocation(loc);
                if (query.trim()) {
                  // Trigger search if there's already a query
                  setTimeout(() => performSearch(), 100);
                }
              }}
            />
          </div>
        </div>
      </form>

      {/* Tabs */}
      <div className="flex gap-1.5 sm:gap-2 mb-6 border-b border-border pb-2 overflow-x-auto -mx-4 px-4 sm:mx-0 sm:px-0">
        {(Object.keys(TAB_LABELS) as TabType[]).map((tab) => {
          const count = tab === 'all'
            ? Object.values(results?.results || {}).reduce((sum, g) => sum + (g?.total || 0), 0)
            : results?.results?.[tab]?.total || 0;

          return (
            <button
              key={tab}
              onClick={() => handleTabChange(tab)}
              className={`px-3 py-2.5 sm:px-4 sm:py-2 text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                activeTab === tab
                  ? 'bg-accent-primary text-white'
                  : 'text-text-secondary hover:bg-bg-secondary'
              }`}
            >
              {TAB_LABELS[tab]}
              {query && <span className="ml-1 opacity-70">({count})</span>}
            </button>
          );
        })}
      </div>

      {/* Error */}
      {error && (
        <div className="glass p-4 text-red-400 mb-6">
          Error: {error}
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        <div>
          {activeTab === 'all' ? (
            <>
              {results.results.messages && (
                <ResultGroup
                  title="Messages"
                  group={results.results.messages}
                  onSeeAll={() => handleTabChange('messages')}
                />
              )}
              {results.results.events && (
                <ResultGroup
                  title="Events"
                  group={results.results.events}
                  onSeeAll={() => handleTabChange('events')}
                />
              )}
              {results.results.rss && (
                <ResultGroup
                  title="RSS Articles"
                  group={results.results.rss}
                  onSeeAll={() => handleTabChange('rss')}
                />
              )}
              {results.results.entities && (
                <ResultGroup
                  title="Entities"
                  group={results.results.entities}
                  onSeeAll={() => handleTabChange('entities')}
                />
              )}
              {Object.values(results.results).every(g => !g || g.items.length === 0) && (
                <div className="text-center text-text-tertiary py-12">
                  No results found for &ldquo;{query}&rdquo;
                </div>
              )}
            </>
          ) : (
            <div className="space-y-2">
              {results.results[activeTab]?.items.map((item) => (
                <ResultCard key={`${item.type}-${item.id}`} item={item} />
              ))}
              {(!results.results[activeTab] || results.results[activeTab]?.items.length === 0) && (
                <div className="text-center text-text-tertiary py-12">
                  No {activeTab} found for &ldquo;{query}&rdquo;
                </div>
              )}
            </div>
          )}
        </div>
      )}

      {/* Empty State */}
      {!loading && !results && !error && (
        <div className="text-center text-text-tertiary py-12">
          Enter a search query to find messages, events, articles, and entities
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8 max-w-4xl">
        <div className="mb-8">
          <h1 className="text-3xl font-bold text-text-primary">Search</h1>
          <p className="text-text-secondary mt-1">Loading...</p>
        </div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}
