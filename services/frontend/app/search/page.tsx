'use client';

import { useState, useEffect, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import Link from 'next/link';
import { searchMessages, getChannels, getTopics, getCategories, getFolders } from '@/lib/api';
import type { Message, SearchResult, Channel, MessageTopic, ChannelCategory, TelegramFolder } from '@/lib/types';

/**
 * Search Page - Message Search with Advanced Filters
 *
 * Full-featured search for archived messages with all available filters.
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
            {message.topic && (
              <span className="px-1.5 py-0.5 bg-amber-500/20 text-amber-400 rounded text-xs">
                {message.topic}
              </span>
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

  // Search state
  const [query, setQuery] = useState(searchParams.get('q') || '');
  const [searchInput, setSearchInput] = useState(searchParams.get('q') || '');

  // Filter state
  const [channelUsername, setChannelUsername] = useState(searchParams.get('channel_username') || '');
  const [channelFolder, setChannelFolder] = useState(searchParams.get('channel_folder') || '');
  const [topic, setTopic] = useState(searchParams.get('topic') || '');
  const [categoryId, setCategoryId] = useState(searchParams.get('category_id') || '');
  const [language, setLanguage] = useState(searchParams.get('language') || '');
  const [hasMedia, setHasMedia] = useState<string>(searchParams.get('has_media') || 'any');
  const [mediaType, setMediaType] = useState(searchParams.get('media_type') || '');
  const [hasComments, setHasComments] = useState<string>(searchParams.get('has_comments') || 'any');
  const [days, setDays] = useState(searchParams.get('days') || '');
  const [sortBy, setSortBy] = useState(searchParams.get('sort_by') || 'telegram_date');
  const [sortOrder, setSortOrder] = useState(searchParams.get('sort_order') || 'desc');

  // Reference data
  const [channels, setChannels] = useState<Channel[]>([]);
  const [topics, setTopics] = useState<MessageTopic[]>([]);
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [folders, setFolders] = useState<TelegramFolder[]>([]);
  const [dataLoading, setDataLoading] = useState(true);

  // Results state
  const [results, setResults] = useState<SearchResult | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [showFilters, setShowFilters] = useState(false);

  // Load reference data
  useEffect(() => {
    const loadData = async () => {
      try {
        const [channelsData, topicsData, categoriesData, foldersData] = await Promise.all([
          getChannels(),
          getTopics(),
          getCategories(),
          getFolders(),
        ]);
        setChannels(channelsData);
        setTopics(topicsData);
        setCategories(categoriesData);
        setFolders(foldersData);
      } catch (err) {
        console.error('Failed to load filter data:', err);
      } finally {
        setDataLoading(false);
      }
    };
    loadData();
  }, []);

  const performSearch = useCallback(async () => {
    if (!query.trim() && !channelUsername && !channelFolder && !topic && !categoryId) {
      setResults(null);
      return;
    }

    setLoading(true);
    setError(null);

    try {
      const params: Record<string, any> = {
        page_size: 50,
        sort_by: sortBy,
        sort_order: sortOrder,
      };

      if (query.trim()) params.q = query.trim();
      if (channelUsername) params.channel_username = channelUsername;
      if (channelFolder) params.channel_folder = channelFolder;
      if (topic) params.topic = topic;
      if (categoryId) params.category_id = parseInt(categoryId);
      if (language) params.language = language;
      if (hasMedia !== 'any') params.has_media = hasMedia === 'true';
      if (mediaType) params.media_type = mediaType;
      if (hasComments !== 'any') params.has_comments = hasComments === 'true';
      if (days) params.days = parseInt(days);

      const response = await searchMessages(params);
      setResults(response);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Search failed');
    } finally {
      setLoading(false);
    }
  }, [query, channelUsername, channelFolder, topic, categoryId, language, hasMedia, mediaType, hasComments, days, sortBy, sortOrder]);

  useEffect(() => {
    performSearch();
  }, [performSearch]);

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    setQuery(searchInput);
    updateUrl();
  };

  const updateUrl = () => {
    const params = new URLSearchParams();
    if (searchInput.trim()) params.set('q', searchInput.trim());
    if (channelUsername) params.set('channel_username', channelUsername);
    if (channelFolder) params.set('channel_folder', channelFolder);
    if (topic) params.set('topic', topic);
    if (categoryId) params.set('category_id', categoryId);
    if (language) params.set('language', language);
    if (hasMedia !== 'any') params.set('has_media', hasMedia);
    if (mediaType) params.set('media_type', mediaType);
    if (hasComments !== 'any') params.set('has_comments', hasComments);
    if (days) params.set('days', days);
    if (sortBy !== 'telegram_date') params.set('sort_by', sortBy);
    if (sortOrder !== 'desc') params.set('sort_order', sortOrder);
    router.push(`/search?${params.toString()}`);
  };

  const clearFilters = () => {
    setSearchInput('');
    setQuery('');
    setChannelUsername('');
    setChannelFolder('');
    setTopic('');
    setCategoryId('');
    setLanguage('');
    setHasMedia('any');
    setMediaType('');
    setHasComments('any');
    setDays('');
    setSortBy('telegram_date');
    setSortOrder('desc');
    router.push('/search');
  };

  // Count active filters
  const activeFilterCount = [
    query.trim(),
    channelUsername,
    channelFolder,
    topic,
    categoryId,
    language,
    hasMedia !== 'any',
    mediaType,
    hasComments !== 'any',
    days,
  ].filter(Boolean).length;

  // Group channels by category
  const channelsByCategory = channels.reduce((acc, ch) => {
    const catName = ch.category?.name || 'uncategorized';
    if (!acc[catName]) acc[catName] = [];
    acc[catName].push(ch);
    return acc;
  }, {} as Record<string, Channel[]>);

  return (
    <div className="container mx-auto px-4 py-8 max-w-5xl">
      {/* Header */}
      <div className="mb-6">
        <h1 className="text-3xl font-bold text-text-primary">Search Messages</h1>
        <p className="text-text-secondary mt-1">
          Search through archived Telegram messages with advanced filters
        </p>
      </div>

      {/* Search Form */}
      <form onSubmit={handleSearch} className="glass p-4 mb-6 rounded-xl">
        {/* Main Search Input */}
        <div className="flex gap-2 mb-4">
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

        {/* Filter Toggle */}
        <div className="flex items-center justify-between mb-4">
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            className="flex items-center gap-2 text-sm text-text-secondary hover:text-text-primary"
          >
            <svg
              className={`w-4 h-4 transition-transform ${showFilters ? 'rotate-90' : ''}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            {showFilters ? 'Hide Filters' : 'Show Filters'}
            {activeFilterCount > 0 && (
              <span className="px-2 py-0.5 bg-accent-primary/20 text-accent-primary text-xs rounded-full">
                {activeFilterCount} active
              </span>
            )}
          </button>
          {activeFilterCount > 0 && (
            <button
              type="button"
              onClick={clearFilters}
              className="text-xs text-accent-primary hover:underline"
            >
              Clear All
            </button>
          )}
        </div>

        {/* Collapsible Filters */}
        {showFilters && (
          <div className="space-y-4 border-t border-border pt-4">
            {/* Row 1: Channel, Topic, Category */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Channel</label>
                <select
                  value={channelUsername}
                  onChange={(e) => setChannelUsername(e.target.value)}
                  disabled={dataLoading}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary disabled:opacity-50"
                >
                  <option value="">All Channels</option>
                  {Object.entries(channelsByCategory).map(([catName, catChannels]) => (
                    <optgroup key={catName} label={catName.charAt(0).toUpperCase() + catName.slice(1)}>
                      {catChannels.map(ch => (
                        <option key={ch.id} value={ch.username || ''}>
                          {ch.name || ch.username || `Channel ${ch.telegram_id}`}
                          {ch.verified && ' ✓'}
                        </option>
                      ))}
                    </optgroup>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Topic</label>
                <select
                  value={topic}
                  onChange={(e) => setTopic(e.target.value)}
                  disabled={dataLoading}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary disabled:opacity-50"
                >
                  <option value="">All Topics</option>
                  {topics.map(t => (
                    <option key={t.id} value={t.name}>
                      {t.label} ({t.message_count || 0})
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Category</label>
                <select
                  value={categoryId}
                  onChange={(e) => setCategoryId(e.target.value)}
                  disabled={dataLoading}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary disabled:opacity-50"
                >
                  <option value="">All Categories</option>
                  {categories.map(c => (
                    <option key={c.id} value={c.id.toString()}>
                      {c.name} ({c.channel_count || 0} channels)
                    </option>
                  ))}
                </select>
              </div>
            </div>

            {/* Row 2: Folder, Language, Media */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Telegram Folder</label>
                <select
                  value={channelFolder}
                  onChange={(e) => setChannelFolder(e.target.value)}
                  disabled={dataLoading}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary disabled:opacity-50"
                >
                  <option value="">All Folders</option>
                  {folders.map(f => (
                    <option key={f.name} value={f.name}>
                      {f.name} ({f.channel_count} channels)
                    </option>
                  ))}
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Language</label>
                <select
                  value={language}
                  onChange={(e) => setLanguage(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="">All Languages</option>
                  <option value="en">English</option>
                  <option value="uk">Ukrainian</option>
                  <option value="ru">Russian</option>
                  <option value="de">German</option>
                  <option value="fr">French</option>
                  <option value="pl">Polish</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Media</label>
                <select
                  value={hasMedia}
                  onChange={(e) => setHasMedia(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="any">Any</option>
                  <option value="true">With Media</option>
                  <option value="false">Text Only</option>
                </select>
              </div>
            </div>

            {/* Row 3: Media Type, Comments, Time Range */}
            <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Media Type</label>
                <select
                  value={mediaType}
                  onChange={(e) => setMediaType(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="">All Types</option>
                  <option value="photo">Photos</option>
                  <option value="video">Videos</option>
                  <option value="document">Documents</option>
                  <option value="audio">Audio</option>
                  <option value="voice">Voice</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Comments</label>
                <select
                  value={hasComments}
                  onChange={(e) => setHasComments(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="any">Any</option>
                  <option value="true">Has Comments</option>
                  <option value="false">No Comments</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Time Range</label>
                <select
                  value={days}
                  onChange={(e) => setDays(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="">All Time</option>
                  <option value="1">Last 24 Hours</option>
                  <option value="3">Last 3 Days</option>
                  <option value="7">Last Week</option>
                  <option value="30">Last Month</option>
                  <option value="90">Last 3 Months</option>
                </select>
              </div>
            </div>

            {/* Row 4: Sorting */}
            <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium mb-2">Sort By</label>
                <select
                  value={sortBy}
                  onChange={(e) => setSortBy(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="telegram_date">Date (Telegram)</option>
                  <option value="created_at">Date Added</option>
                  <option value="views">Views</option>
                  <option value="forwards">Forwards</option>
                </select>
              </div>

              <div>
                <label className="block text-sm font-medium mb-2">Order</label>
                <select
                  value={sortOrder}
                  onChange={(e) => setSortOrder(e.target.value)}
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-accent-primary"
                >
                  <option value="desc">Newest First</option>
                  <option value="asc">Oldest First</option>
                </select>
              </div>
            </div>

            {/* Apply Filters Button */}
            <div className="flex justify-end">
              <button
                type="submit"
                className="px-6 py-2 bg-accent-secondary text-white rounded-lg hover:bg-accent-secondary/80 transition-colors"
              >
                Apply Filters
              </button>
            </div>
          </div>
        )}

        {/* Active Filters Summary */}
        {activeFilterCount > 0 && !showFilters && (
          <div className="flex flex-wrap gap-2 pt-2 border-t border-border">
            {query && (
              <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
                Search: {query}
              </span>
            )}
            {channelUsername && (
              <span className="px-2 py-1 bg-primary/10 text-primary text-xs rounded-full">
                Channel: {channelUsername}
              </span>
            )}
            {channelFolder && (
              <span className="px-2 py-1 bg-purple-500/10 text-purple-400 text-xs rounded-full">
                Folder: {channelFolder}
              </span>
            )}
            {topic && (
              <span className="px-2 py-1 bg-amber-500/10 text-amber-400 text-xs rounded-full">
                Topic: {topics.find(t => t.name === topic)?.label || topic}
              </span>
            )}
            {categoryId && (
              <span className="px-2 py-1 bg-emerald-500/10 text-emerald-400 text-xs rounded-full">
                Category: {categories.find(c => c.id.toString() === categoryId)?.name || categoryId}
              </span>
            )}
            {language && (
              <span className="px-2 py-1 bg-blue-500/10 text-blue-400 text-xs rounded-full">
                Language: {language.toUpperCase()}
              </span>
            )}
            {hasMedia !== 'any' && (
              <span className="px-2 py-1 bg-cyan-500/10 text-cyan-400 text-xs rounded-full">
                Media: {hasMedia === 'true' ? 'With Media' : 'Text Only'}
              </span>
            )}
            {days && (
              <span className="px-2 py-1 bg-orange-500/10 text-orange-400 text-xs rounded-full">
                Last {days} days
              </span>
            )}
          </div>
        )}
      </form>

      {/* Results Count */}
      {results && (
        <div className="flex items-center justify-between mb-4 text-sm text-text-tertiary">
          <span>{results.total.toLocaleString()} messages found</span>
          {results.total_pages > 1 && (
            <span>Page {results.page} of {results.total_pages}</span>
          )}
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="glass p-4 text-red-400 mb-6">
          Error: {error}
        </div>
      )}

      {/* Loading State */}
      {loading && (
        <div className="text-center py-12 text-text-tertiary">
          Searching...
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
              No messages found matching your criteria
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
        <div className="text-center text-text-tertiary py-12 glass rounded-xl">
          <p className="mb-4 text-lg">Enter a search query or select filters to find messages</p>
          <p className="text-sm">
            Use the filters above to narrow down results by channel, topic, category, or other criteria
          </p>
        </div>
      )}
    </div>
  );
}

export default function SearchPage() {
  return (
    <Suspense fallback={
      <div className="container mx-auto px-4 py-8 max-w-5xl">
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
