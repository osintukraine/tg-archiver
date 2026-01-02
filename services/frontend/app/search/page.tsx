'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchMessages } from '@/lib/api';
import type { Message, SearchResult } from '@/lib/types';

/**
 * Search Page - Message Search
 *
 * Simple keyword search for archived messages.
 * Removed: semantic search, events, rss, entities, location filter
 */

function MessageCard({ message }: { message: Message }) {
  const formatDate = (dateStr: string | null) => {
    if (!dateStr) return '';
    return new Date(dateStr).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  return (
    <Link
      href={`/messages/${message.id}`}
      className="block glass p-3 sm:p-4 hover:bg-bg-secondary/50 transition-colors"
    >
      <div className="flex items-start gap-2 sm:gap-3">
        <span className="text-lg sm:text-xl flex-shrink-0">
          {message.media_type ? '🖼️' : '💬'}
        </span>
        <div className="flex-1 min-w-0">
          <p className="text-text-primary line-clamp-3">
            {message.content_translated || message.content || '(No content)'}
          </p>
          <div className="flex flex-wrap items-center gap-2 sm:gap-3 mt-2 text-xs text-text-tertiary">
            {message.channel?.name && (
              <span className="flex items-center gap-1">
                📢 {message.channel.name}
                {message.channel.verified && '✓'}
              </span>
            )}
            {message.telegram_date && (
              <span>{formatDate(message.telegram_date)}</span>
            )}
            {message.views != null && message.views > 0 && (
              <span>👁️ {message.views.toLocaleString()}</span>
            )}
            {message.forwards != null && message.forwards > 0 && (
              <span>↗️ {message.forwards}</span>
            )}
            {message.media_type && (
              <span>📎 {message.media_type}</span>
            )}
          </div>
        </div>
      </div>
    </Link>
  );
}

function SearchPageContent() {
  const router = useRouter();
  const searchParams = useSearchParams();

  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');
  const [hasMedia, setHasMedia] = useState<boolean | undefined>(undefined);
  const [results, setResults] = useState<SearchResult | null>(null);
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
      const response = await searchMessages({
        q: query,
        has_media: hasMedia,
        page_size: 50,
        sort_by: 'telegram_date',
        sort_order: 'desc',
      });
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, hasMedia]);

  useEffect(() => {
    performSearch();
  }, [performSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
    const params = new URLSearchParams();
    params.set('q', searchInput);
    if (hasMedia !== undefined) {
      params.set('has_media', String(hasMedia));
    }
    router.push(`/search?${params.toString()}`);
  };

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-text-primary">Search Messages</h1>
        <p className="text-text-secondary mt-1">
          Search through archived Telegram messages
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
              placeholder="Search by keywords..."
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

          {/* Filters */}
          <div className="flex flex-wrap items-center gap-3">
            <span className="text-sm text-text-tertiary">Filter:</span>
            <label className="flex items-center gap-2 text-sm text-text-secondary cursor-pointer">
              <input
                type="checkbox"
                checked={hasMedia === true}
                onChange={(e) => setHasMedia(e.target.checked ? true : undefined)}
                className="rounded"
              />
              Has media
            </label>
            {results && (
              <span className="text-xs text-text-tertiary ml-auto">
                {results.total.toLocaleString()} results
              </span>
            )}
          </div>
        </div>
      </form>

      {/* Error */}
      {error && (
        <div className="glass p-4 text-red-400 mb-6">
          Error: {error}
        </div>
      )}

      {/* Results */}
      {!loading && results && (
        <div className="space-y-2">
          {results.items.map((message) => (
            <MessageCard key={message.id} message={message} />
          ))}
          {results.items.length === 0 && (
            <div className="text-center text-text-tertiary py-12">
              No messages found for &ldquo;{query}&rdquo;
            </div>
          )}
        </div>
      )}

      {/* Pagination */}
      {results && results.total_pages > 1 && (
        <div className="flex justify-center gap-2 mt-8">
          <span className="text-sm text-text-tertiary">
            Page {results.page} of {results.total_pages}
          </span>
        </div>
      )}

      {/* Empty State */}
      {!loading && !results && !error && (
        <div className="text-center text-text-tertiary py-12">
          <p className="mb-4">Enter a search query to find messages</p>
          <p className="text-sm">
            Tip: Use keywords from the message content, channel name, or author
          </p>
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
          <h1 className="text-3xl font-bold text-text-primary">Search Messages</h1>
          <p className="text-text-secondary mt-1">Loading...</p>
        </div>
      </div>
    }>
      <SearchPageContent />
    </Suspense>
  );
}
