'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { SearchParams, Channel, MessageTopic, ChannelCategory, TelegramFolder } from '@/lib/types';
import { getChannels, getTopics, getCategories, getFolders, API_URL } from '@/lib/api';
import { getAuthHeaders } from '@/lib/auth-utils';

interface SearchFiltersProps {
  initialParams: SearchParams;
}

export function SearchFilters({ initialParams }: SearchFiltersProps) {
  const router = useRouter();
  const searchParams = useSearchParams();

  // Local state for controlled inputs
  const [query, setQuery] = useState(initialParams.q || '');
  const [channelUsername, setChannelUsername] = useState(initialParams.channel_username || '');
  const [channelFolder, setChannelFolder] = useState(initialParams.channel_folder || '');
  const [hasMedia, setHasMedia] = useState<string>(
    initialParams.has_media === true ? 'true' : initialParams.has_media === false ? 'false' : 'any'
  );
  const [mediaType, setMediaType] = useState(initialParams.media_type || '');
  const [language, setLanguage] = useState(initialParams.language || '');
  const [hasComments, setHasComments] = useState<string>(
    initialParams.has_comments === true ? 'true' : initialParams.has_comments === false ? 'false' : 'any'
  );
  const [minViews, setMinViews] = useState(initialParams.min_views?.toString() || '');
  const [minForwards, setMinForwards] = useState(initialParams.min_forwards?.toString() || '');
  // Date filters
  const [dateFrom, setDateFrom] = useState(initialParams.date_from || '');
  const [dateTo, setDateTo] = useState(initialParams.date_to || '');
  const [days, setDays] = useState(initialParams.days?.toString() || '');

  // Sorting state
  const [sortBy, setSortBy] = useState(initialParams.sort_by || 'telegram_date');
  const [sortOrder, setSortOrder] = useState(initialParams.sort_order || 'desc');

  // Collapse state (persisted in localStorage)
  const [isCollapsed, setIsCollapsed] = useState(() => {
    if (typeof window !== 'undefined') {
      const saved = localStorage.getItem('filters-collapsed');
      return saved === 'true';
    }
    return false;
  });

  // Persist collapse state
  useEffect(() => {
    if (typeof window !== 'undefined') {
      localStorage.setItem('filters-collapsed', isCollapsed.toString());
    }
  }, [isCollapsed]);

  // Topic filter state
  const [topic, setTopic] = useState(initialParams.topic || '');

  // Category filter state (filter channels by category)
  const [categoryId, setCategoryId] = useState(initialParams.category_id?.toString() || '');

  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

  // Topics state
  const [topics, setTopics] = useState<MessageTopic[]>([]);
  const [topicsLoading, setTopicsLoading] = useState(true);

  // Categories state
  const [categories, setCategories] = useState<ChannelCategory[]>([]);
  const [categoriesLoading, setCategoriesLoading] = useState(true);

  // Folders state
  const [folders, setFolders] = useState<TelegramFolder[]>([]);
  const [foldersLoading, setFoldersLoading] = useState(true);

  // Fetch channels on mount
  useEffect(() => {
    const loadChannels = async () => {
      try {
        const data = await getChannels();
        setChannels(data);
      } catch (error) {
        console.error('Failed to load channels:', error);
      } finally {
        setChannelsLoading(false);
      }
    };

    loadChannels();
  }, []);

  // Fetch topics on mount
  useEffect(() => {
    const loadTopics = async () => {
      try {
        const data = await getTopics();
        setTopics(data);
      } catch (error) {
        console.error('Failed to load topics:', error);
      } finally {
        setTopicsLoading(false);
      }
    };

    loadTopics();
  }, []);

  // Fetch categories on mount
  useEffect(() => {
    const loadCategories = async () => {
      try {
        const data = await getCategories();
        setCategories(data);
      } catch (error) {
        console.error('Failed to load categories:', error);
      } finally {
        setCategoriesLoading(false);
      }
    };

    loadCategories();
  }, []);

  // Fetch folders on mount
  useEffect(() => {
    const loadFolders = async () => {
      try {
        const data = await getFolders();
        setFolders(data);
      } catch (error) {
        console.error('Failed to load folders:', error);
      } finally {
        setFoldersLoading(false);
      }
    };

    loadFolders();
  }, []);

  // Build URL from filter state
  const buildFilterUrl = (overrides: Partial<{
    query: string;
    channelUsername: string;
    channelFolder: string;
    topic: string;
    categoryId: string;
    hasMedia: string;
    mediaType: string;
    language: string;
    hasComments: string;
    minViews: string;
    minForwards: string;
    days: string;
    dateFrom: string;
    dateTo: string;
    sortBy: string;
    sortOrder: string;
  }> = {}) => {
    const params = new URLSearchParams();

    const q = overrides.query !== undefined ? overrides.query : query;
    const ch = overrides.channelUsername !== undefined ? overrides.channelUsername : channelUsername;
    const cf = overrides.channelFolder !== undefined ? overrides.channelFolder : channelFolder;
    const tp = overrides.topic !== undefined ? overrides.topic : topic;
    const cat = overrides.categoryId !== undefined ? overrides.categoryId : categoryId;
    const hm = overrides.hasMedia !== undefined ? overrides.hasMedia : hasMedia;
    const mt = overrides.mediaType !== undefined ? overrides.mediaType : mediaType;
    const lang = overrides.language !== undefined ? overrides.language : language;
    const hc = overrides.hasComments !== undefined ? overrides.hasComments : hasComments;
    const mv = overrides.minViews !== undefined ? overrides.minViews : minViews;
    const mf = overrides.minForwards !== undefined ? overrides.minForwards : minForwards;
    const d = overrides.days !== undefined ? overrides.days : days;
    const df = overrides.dateFrom !== undefined ? overrides.dateFrom : dateFrom;
    const dt = overrides.dateTo !== undefined ? overrides.dateTo : dateTo;
    const sb = overrides.sortBy !== undefined ? overrides.sortBy : sortBy;
    const so = overrides.sortOrder !== undefined ? overrides.sortOrder : sortOrder;

    if (q.trim()) params.set('q', q.trim());
    if (ch.trim()) params.set('channel_username', ch.trim());
    if (cf.trim()) params.set('channel_folder', cf.trim());
    if (tp) params.set('topic', tp);
    if (cat) params.set('category_id', cat);
    if (hm !== 'any') params.set('has_media', hm);
    if (mt) params.set('media_type', mt);
    if (lang) params.set('language', lang);
    if (hc !== 'any') params.set('has_comments', hc);
    if (mv) params.set('min_views', mv);
    if (mf) params.set('min_forwards', mf);

    // Date filters (mutually exclusive: either days OR date_from/date_to)
    if (d) {
      params.set('days', d);
    } else {
      if (df) params.set('date_from', df);
      if (dt) params.set('date_to', dt);
    }

    // Sorting parameters (only include if not default)
    if (sb !== 'telegram_date') params.set('sort_by', sb);
    if (so !== 'desc') params.set('sort_order', so);

    params.set('page', '1');
    return `/?${params.toString()}`;
  };

  // Count active filters
  const activeFilterCount = [
    query.trim(),
    channelUsername.trim(),
    channelFolder.trim(),
    topic,
    categoryId,
    hasMedia !== 'any',
    mediaType,
    language,
    hasComments !== 'any',
    minViews,
    minForwards,
    days,
    dateFrom,
    dateTo,
  ].filter(Boolean).length;

  // Clear all filters
  const clearFilters = () => {
    setQuery('');
    setChannelUsername('');
    setChannelFolder('');
    setTopic('');
    setCategoryId('');
    setHasMedia('any');
    setMediaType('');
    setLanguage('');
    setHasComments('any');
    setMinViews('');
    setMinForwards('');
    setDateFrom('');
    setDateTo('');
    setDays('');
    setSortBy('telegram_date');
    setSortOrder('desc');
    router.push('/');
  };

  // Handle Enter key in search input
  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      router.push(buildFilterUrl({ query }));
    }
  };

  // Feed format state for dropdown
  const [showFeedMenu, setShowFeedMenu] = useState(false);

  // Feed auth state
  const [authRequired, setAuthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [feedUrlGenerating, setFeedUrlGenerating] = useState(false);

  // Feed format options
  const feedFormats = [
    { id: 'rss', name: 'RSS 2.0', icon: '📰', description: 'Most compatible format' },
    { id: 'atom', name: 'Atom 1.0', icon: '⚛️', description: 'Modern standard (RFC 4287)' },
    { id: 'json', name: 'JSON Feed', icon: '📋', description: 'For developers & APIs' },
  ];

  // Check feed auth status on mount
  useEffect(() => {
    const checkFeedAuth = async () => {
      try {
        const statusRes = await fetch(`${API_URL}/api/feed-tokens/auth-status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setAuthRequired(statusData.auth_required);
        }
      } catch (err) {
        console.warn('Failed to check feed auth status:', err);
      } finally {
        setAuthLoading(false);
      }
    };

    checkFeedAuth();
  }, []);

  // Generate feed URL from current filters
  const getFeedUrl = (format: string = 'rss'): string => {
    const params = new URLSearchParams();
    params.set('format', format);
    if (query.trim()) params.set('q', query.trim());
    if (channelUsername.trim()) params.set('channel_username', channelUsername.trim());
    if (channelFolder.trim()) params.set('channel_folder', channelFolder.trim());
    if (hasMedia !== 'any') params.set('has_media', hasMedia);
    if (mediaType) params.set('media_type', mediaType);
    if (language) params.set('language', language);
    if (hasComments !== 'any') params.set('has_comments', hasComments);
    if (minViews) params.set('min_views', minViews);
    if (minForwards) params.set('min_forwards', minForwards);
    if (days) {
      params.set('days', days);
    } else {
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
    }
    if (sortBy !== 'telegram_date') params.set('sort_by', sortBy);
    if (sortOrder !== 'desc') params.set('sort_order', sortOrder);

    // Build full URL with origin for external feed readers
    const baseUrl = API_URL || (typeof window !== 'undefined' ? window.location.origin : '');
    return `${baseUrl}/api/rss/search?${params.toString()}`;
  };

  const copyFeedUrl = async (format: string) => {
    if (authRequired) {
      alert('Feed authentication is required. Add your feed token to the URL: ?token=YOUR_TOKEN\n\nGenerate a token in Settings > Feed Tokens first.');
    }

    setFeedUrlGenerating(true);
    try {
      const url = getFeedUrl(format);
      await navigator.clipboard.writeText(url);
      const formatName = feedFormats.find(f => f.id === format)?.name || format.toUpperCase();
      alert(`${formatName} feed URL copied to clipboard!${authRequired ? '\n\nRemember to add your token: ?token=YOUR_TOKEN' : ''}`);
      setShowFeedMenu(false);
    } catch (err) {
      console.error('Failed to copy feed URL:', err);
      alert('Failed to copy feed URL. Please try again.');
    } finally {
      setFeedUrlGenerating(false);
    }
  };

  const openFeedInNewTab = (format: string) => {
    if (authRequired) {
      alert('Feed authentication is required. Add your feed token to the URL: ?token=YOUR_TOKEN\n\nGenerate a token in Settings > Feed Tokens first.');
    }

    const url = getFeedUrl(format);
    window.open(url, '_blank');
    setShowFeedMenu(false);
  };

  // Group channels by category
  const channelsByCategory = channels.reduce((acc, ch) => {
    const catName = ch.category?.name || 'uncategorized';
    if (!acc[catName]) acc[catName] = [];
    acc[catName].push(ch);
    return acc;
  }, {} as Record<string, Channel[]>);

  return (
    <div className="glass rounded-xl overflow-hidden mb-6">
      {/* Header with Toggle Button */}
      <div className="flex items-center justify-between p-4 border-b border-border bg-bg-secondary/30">
        <div className="flex items-center gap-3">
          <button
            onClick={() => setIsCollapsed(!isCollapsed)}
            className="flex items-center gap-2 text-text-primary hover:text-primary transition-colors"
            aria-label={isCollapsed ? 'Expand filters' : 'Collapse filters'}
          >
            <svg
              className={`w-5 h-5 transition-transform duration-200 ${isCollapsed ? 'rotate-0' : 'rotate-90'}`}
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
            </svg>
            <span className="font-semibold">
              {isCollapsed ? 'Show Filters' : 'Hide Filters'}
            </span>
          </button>
          {activeFilterCount > 0 && (
            <span className="px-2 py-1 bg-accent-primary/10 text-accent-primary text-xs rounded-full font-medium">
              {activeFilterCount} active
            </span>
          )}
        </div>
        {activeFilterCount > 0 && (
          <button
            onClick={clearFilters}
            className="text-xs text-accent-primary hover:underline font-medium"
          >
            Clear All
          </button>
        )}
      </div>

      {/* Collapsible Content */}
      <div
        className={`transition-all duration-300 ease-in-out overflow-hidden ${
          isCollapsed ? 'max-h-0' : 'max-h-[5000px]'
        }`}
      >
        <div className="p-6 space-y-6">

          {/* Search Input */}
          <div>
            <label htmlFor="search" className="block text-sm font-medium mb-2">
              Search Messages
            </label>
            <input
              id="search"
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={handleKeyDown}
              placeholder="Search in original or translated text..."
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Sorting Controls */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label htmlFor="sort-by" className="block text-sm font-medium mb-2">
                Sort By
              </label>
              <select
                id="sort-by"
                value={sortBy}
                onChange={(e) => {
                  setSortBy(e.target.value);
                  router.push(buildFilterUrl({ sortBy: e.target.value }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="telegram_date">Date (Telegram)</option>
                <option value="created_at">Date Added</option>
                <option value="media_type">Media Type</option>
                <option value="message_id">Message ID</option>
              </select>
            </div>

            <div>
              <label htmlFor="sort-order" className="block text-sm font-medium mb-2">
                Sort Order
              </label>
              <select
                id="sort-order"
                value={sortOrder}
                onChange={(e) => {
                  const newValue = e.target.value as 'asc' | 'desc';
                  setSortOrder(newValue);
                  router.push(buildFilterUrl({ sortOrder: newValue }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="desc">Descending (Newest First)</option>
                <option value="asc">Ascending (Oldest First)</option>
              </select>
            </div>
          </div>

          {/* Filter Grid - Main Filters */}
          <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
            {/* Channel Filter */}
            <div>
              <label htmlFor="channel" className="block text-sm font-medium mb-2">
                Channel {channelsLoading && <span className="text-text-tertiary text-xs">(loading...)</span>}
              </label>
              <select
                id="channel"
                value={channelUsername}
                onChange={(e) => {
                  setChannelUsername(e.target.value);
                  router.push(buildFilterUrl({ channelUsername: e.target.value }));
                }}
                disabled={channelsLoading}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              >
                <option value="">All Channels</option>
                {!channelsLoading && Object.entries(channelsByCategory).map(([catName, catChannels]) => (
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
              <p className="text-xs text-text-tertiary mt-1">
                {channelsLoading ? 'Loading channels...' : `${channels.length} channels available`}
              </p>
            </div>

            {/* Media Type Filter */}
            <div>
              <label htmlFor="media" className="block text-sm font-medium mb-2">
                Media Type
              </label>
              <select
                id="media"
                value={hasMedia}
                onChange={(e) => {
                  setHasMedia(e.target.value);
                  router.push(buildFilterUrl({ hasMedia: e.target.value }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="any">Any (with or without media)</option>
                <option value="true">With Media (photos/videos)</option>
                <option value="false">Text Only</option>
              </select>
            </div>

            {/* Specific Media Type Filter */}
            <div>
              <label htmlFor="media-type" className="block text-sm font-medium mb-2">
                Specific Media Type
              </label>
              <select
                id="media-type"
                value={mediaType}
                onChange={(e) => {
                  setMediaType(e.target.value);
                  router.push(buildFilterUrl({ mediaType: e.target.value }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">All Media Types</option>
                <option value="photo">Photos</option>
                <option value="video">Videos</option>
                <option value="document">Documents</option>
                <option value="audio">Audio</option>
                <option value="voice">Voice</option>
              </select>
            </div>

            {/* Language Filter */}
            <div>
              <label htmlFor="language" className="block text-sm font-medium mb-2">
                Language
              </label>
              <select
                id="language"
                value={language}
                onChange={(e) => {
                  setLanguage(e.target.value);
                  router.push(buildFilterUrl({ language: e.target.value }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
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
          </div>

          {/* Filter Grid - Topic, Category, Folder */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Topic Filter */}
            <div>
              <label htmlFor="topic" className="block text-sm font-medium mb-2">
                Topic {topicsLoading && <span className="text-text-tertiary text-xs">(loading...)</span>}
              </label>
              <select
                id="topic"
                value={topic}
                onChange={(e) => {
                  setTopic(e.target.value);
                  router.push(buildFilterUrl({ topic: e.target.value }));
                }}
                disabled={topicsLoading}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              >
                <option value="">All Topics</option>
                {!topicsLoading && topics.map(t => (
                  <option key={t.id} value={t.name}>
                    {t.label} ({t.message_count || 0})
                  </option>
                ))}
              </select>
            </div>

            {/* Category Filter */}
            <div>
              <label htmlFor="category" className="block text-sm font-medium mb-2">
                Category {categoriesLoading && <span className="text-text-tertiary text-xs">(loading...)</span>}
              </label>
              <select
                id="category"
                value={categoryId}
                onChange={(e) => {
                  setCategoryId(e.target.value);
                  router.push(buildFilterUrl({ categoryId: e.target.value }));
                }}
                disabled={categoriesLoading}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              >
                <option value="">All Categories</option>
                {!categoriesLoading && categories.map(c => (
                  <option key={c.id} value={c.id.toString()}>
                    {c.name} ({c.channel_count || 0} channels)
                  </option>
                ))}
              </select>
            </div>

            {/* Folder Filter */}
            <div>
              <label htmlFor="folder" className="block text-sm font-medium mb-2">
                Telegram Folder {foldersLoading && <span className="text-text-tertiary text-xs">(loading...)</span>}
              </label>
              <select
                id="folder"
                value={channelFolder}
                onChange={(e) => {
                  setChannelFolder(e.target.value);
                  router.push(buildFilterUrl({ channelFolder: e.target.value }));
                }}
                disabled={foldersLoading}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50"
              >
                <option value="">All Folders</option>
                {!foldersLoading && folders.map(f => (
                  <option key={f.name} value={f.name}>
                    {f.name} ({f.channel_count} channels)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* Filter Grid - Additional Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            {/* Has Comments Filter */}
            <div>
              <label htmlFor="has-comments" className="block text-sm font-medium mb-2">
                Discussion Thread
              </label>
              <select
                id="has-comments"
                value={hasComments}
                onChange={(e) => {
                  setHasComments(e.target.value);
                  router.push(buildFilterUrl({ hasComments: e.target.value }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="any">Any</option>
                <option value="true">Has Comments</option>
                <option value="false">No Comments</option>
              </select>
            </div>

            {/* Minimum Views */}
            <div>
              <label htmlFor="min-views" className="block text-sm font-medium mb-2">
                Minimum Views
              </label>
              <input
                id="min-views"
                type="number"
                min="0"
                placeholder="e.g. 1000"
                value={minViews}
                onChange={(e) => setMinViews(e.target.value)}
                onBlur={() => router.push(buildFilterUrl({ minViews }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    router.push(buildFilterUrl({ minViews }));
                  }
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>

            {/* Minimum Forwards */}
            <div>
              <label htmlFor="min-forwards" className="block text-sm font-medium mb-2">
                Minimum Forwards
              </label>
              <input
                id="min-forwards"
                type="number"
                min="0"
                placeholder="e.g. 50"
                value={minForwards}
                onChange={(e) => setMinForwards(e.target.value)}
                onBlur={() => router.push(buildFilterUrl({ minForwards }))}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    router.push(buildFilterUrl({ minForwards }));
                  }
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
            </div>
          </div>

          {/* Date Range Filters */}
          <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
            <div>
              <label htmlFor="days" className="block text-sm font-medium mb-2">
                Last N Days
              </label>
              <select
                id="days"
                value={days}
                onChange={(e) => {
                  setDays(e.target.value);
                  if (e.target.value) {
                    setDateFrom('');
                    setDateTo('');
                  }
                  router.push(buildFilterUrl({ days: e.target.value, dateFrom: '', dateTo: '' }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              >
                <option value="">All Time</option>
                <option value="1">Last 24 Hours</option>
                <option value="3">Last 3 Days</option>
                <option value="7">Last Week</option>
                <option value="30">Last Month</option>
                <option value="90">Last 3 Months</option>
              </select>
            </div>

            <div>
              <label htmlFor="date-from" className="block text-sm font-medium mb-2">
                From Date
              </label>
              <input
                id="date-from"
                type="date"
                value={dateFrom}
                onChange={(e) => {
                  setDateFrom(e.target.value);
                  if (e.target.value) setDays('');
                  router.push(buildFilterUrl({ dateFrom: e.target.value, days: '' }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>

            <div>
              <label htmlFor="date-to" className="block text-sm font-medium mb-2">
                To Date
              </label>
              <input
                id="date-to"
                type="date"
                value={dateTo}
                onChange={(e) => {
                  setDateTo(e.target.value);
                  if (e.target.value) setDays('');
                  router.push(buildFilterUrl({ dateTo: e.target.value, days: '' }));
                }}
                className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
              />
            </div>
          </div>

          {/* Feed Subscribe Button with Format Dropdown */}
          <div className="flex justify-end relative">
            <div className="relative w-full max-w-md">
              {authRequired && !authLoading && (
                <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-400">
                  <p className="font-medium">Feed authentication is required</p>
                  <p className="text-xs mt-1">
                    Add <code className="bg-amber-500/20 px-1 rounded">?token=YOUR_TOKEN</code> to the URL.
                    Create a token in <a href="/settings/feed-tokens" className="underline hover:text-amber-300">Settings</a>.
                  </p>
                </div>
              )}

              <button
                onClick={() => setShowFeedMenu(!showFeedMenu)}
                disabled={feedUrlGenerating}
                className="w-full px-6 py-3 bg-accent-secondary hover:bg-accent-secondary/90 border border-accent-secondary text-white font-medium rounded-lg transition-colors focus:outline-none focus:ring-2 focus:ring-accent-secondary flex items-center justify-center gap-2 disabled:opacity-50 disabled:cursor-not-allowed"
                title="Subscribe to feed with current filters"
              >
                <svg className="w-5 h-5" fill="currentColor" viewBox="0 0 20 20">
                  <path d="M5 3a1 1 0 000 2c5.523 0 10 4.477 10 10a1 1 0 102 0C17 8.373 11.627 3 5 3z"/>
                  <path d="M4 9a1 1 0 011-1 7 7 0 017 7 1 1 0 11-2 0 5 5 0 00-5-5 1 1 0 01-1-1zM3 15a2 2 0 114 0 2 2 0 01-4 0z"/>
                </svg>
                {feedUrlGenerating ? 'Generating URL...' : 'Subscribe Feed'}
                <svg className={`w-4 h-4 transition-transform ${showFeedMenu ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
                </svg>
              </button>

              {showFeedMenu && (
                <div className="absolute right-0 bottom-full mb-2 w-72 bg-bg-secondary border border-border rounded-lg shadow-xl z-50">
                  <div className="p-2 border-b border-border">
                    <p className="text-xs text-text-tertiary px-2">Choose your preferred format:</p>
                  </div>
                  <div className="p-2 space-y-1">
                    {feedFormats.map((format) => (
                      <div key={format.id} className="flex items-center gap-2">
                        <button
                          onClick={() => copyFeedUrl(format.id)}
                          className="flex-1 flex items-center gap-3 px-3 py-2 rounded-md hover:bg-bg-tertiary transition-colors text-left"
                          title={`Copy ${format.name} URL`}
                        >
                          <span className="text-lg">{format.icon}</span>
                          <div className="flex-1 min-w-0">
                            <div className="text-sm font-medium text-text-primary">{format.name}</div>
                            <div className="text-xs text-text-tertiary truncate">{format.description}</div>
                          </div>
                          <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z" />
                          </svg>
                        </button>
                        <button
                          onClick={() => openFeedInNewTab(format.id)}
                          className="p-2 rounded-md hover:bg-bg-tertiary transition-colors"
                          title={`Open ${format.name} in new tab`}
                        >
                          <svg className="w-4 h-4 text-text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 6H6a2 2 0 00-2 2v10a2 2 0 002 2h10a2 2 0 002-2v-4M14 4h6m0 0v6m0-6L10 14" />
                          </svg>
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>

            {showFeedMenu && (
              <div
                className="fixed inset-0 z-40"
                onClick={() => setShowFeedMenu(false)}
              />
            )}
          </div>

          {/* Active Filters Summary */}
          {activeFilterCount > 0 && (
            <div className="pt-4 border-t border-border">
              <p className="text-sm text-text-tertiary mb-2">Active filters:</p>
              <div className="flex flex-wrap gap-2">
                {query && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Search: {query}
                  </span>
                )}
                {channelUsername && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Channel: {channelUsername}
                  </span>
                )}
                {channelFolder && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-purple-500/10 text-purple-400 text-sm rounded-full">
                    Folder: {channelFolder}
                  </span>
                )}
                {topic && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-amber-500/10 text-amber-400 text-sm rounded-full">
                    Topic: {topics.find(t => t.name === topic)?.label || topic}
                  </span>
                )}
                {categoryId && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-emerald-500/10 text-emerald-400 text-sm rounded-full">
                    Category: {categories.find(c => c.id.toString() === categoryId)?.name || categoryId}
                  </span>
                )}
                {hasMedia !== 'any' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Media: {hasMedia === 'true' ? 'With Media' : 'Text Only'}
                  </span>
                )}
                {mediaType && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Type: {mediaType}
                  </span>
                )}
                {language && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/10 text-blue-400 text-sm rounded-full">
                    Language: {language.toUpperCase()}
                  </span>
                )}
                {hasComments !== 'any' && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 text-sm rounded-full">
                    Comments: {hasComments === 'true' ? 'Has Comments' : 'No Comments'}
                  </span>
                )}
                {minViews && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/10 text-cyan-400 text-sm rounded-full">
                    Min Views: {minViews}
                  </span>
                )}
                {minForwards && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/10 text-cyan-400 text-sm rounded-full">
                    Min Forwards: {minForwards}
                  </span>
                )}
                {days && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Last {days} days
                  </span>
                )}
                {(dateFrom || dateTo) && (
                  <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                    Date: {dateFrom || '...'} to {dateTo || '...'}
                  </span>
                )}
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
