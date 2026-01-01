'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useState, useEffect } from 'react';
import type { SearchParams, Channel } from '@/lib/types';
import { getChannels, API_URL } from '@/lib/api';
import { CountryFilter } from './CountryFilter';

interface SearchFiltersProps {
  initialParams: SearchParams;
}

type CountrySelection = 'all' | 'ukraine' | 'russia';

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
  const [topic, setTopic] = useState(initialParams.topic || '');
  const [isSpam, setIsSpam] = useState<string>(initialParams.is_spam === true ? 'true' : initialParams.is_spam === false ? 'false' : 'exclude');
  // New intelligence filters (replace osint_score)
  const [importanceLevel, setImportanceLevel] = useState(initialParams.importance_level || '');
  const [language, setLanguage] = useState(initialParams.language || '');
  const [needsHumanReview, setNeedsHumanReview] = useState<string>(
    initialParams.needs_human_review === true ? 'true' : initialParams.needs_human_review === false ? 'false' : 'any'
  );
  const [hasComments, setHasComments] = useState<string>(
    initialParams.has_comments === true ? 'true' : initialParams.has_comments === false ? 'false' : 'any'
  );
  const [minViews, setMinViews] = useState(initialParams.min_views?.toString() || '');
  const [minForwards, setMinForwards] = useState(initialParams.min_forwards?.toString() || '');
  // Date filters
  const [dateFrom, setDateFrom] = useState(initialParams.date_from || '');
  const [dateTo, setDateTo] = useState(initialParams.date_to || '');
  const [days, setDays] = useState(initialParams.days?.toString() || '');
  const [useSemantic, setUseSemantic] = useState(initialParams.use_semantic || false);

  // Country filter state
  const [countrySelection, setCountrySelection] = useState<CountrySelection>(() => {
    // Determine initial selection from channelFolder param
    if (initialParams.channel_folder === '%UA') return 'ukraine';
    if (initialParams.channel_folder === '%RU') return 'russia';
    return 'all';
  });

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

  // Channels state
  const [channels, setChannels] = useState<Channel[]>([]);
  const [channelsLoading, setChannelsLoading] = useState(true);

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

  // Build URL from filter state - used by all auto-apply handlers
  const buildFilterUrl = (overrides: Partial<{
    query: string;
    channelUsername: string;
    channelFolder: string;
    hasMedia: string;
    mediaType: string;
    topic: string;
    isSpam: string;
    importanceLevel: string;
    language: string;
    needsHumanReview: string;
    hasComments: string;
    minViews: string;
    minForwards: string;
    days: string;
    dateFrom: string;
    dateTo: string;
    useSemantic: boolean;
    sortBy: string;
    sortOrder: string;
  }> = {}) => {
    const params = new URLSearchParams();

    const q = overrides.query !== undefined ? overrides.query : query;
    const ch = overrides.channelUsername !== undefined ? overrides.channelUsername : channelUsername;
    const cf = overrides.channelFolder !== undefined ? overrides.channelFolder : channelFolder;
    const hm = overrides.hasMedia !== undefined ? overrides.hasMedia : hasMedia;
    const mt = overrides.mediaType !== undefined ? overrides.mediaType : mediaType;
    const tp = overrides.topic !== undefined ? overrides.topic : topic;
    const sp = overrides.isSpam !== undefined ? overrides.isSpam : isSpam;
    const imp = overrides.importanceLevel !== undefined ? overrides.importanceLevel : importanceLevel;
    const lang = overrides.language !== undefined ? overrides.language : language;
    const nhr = overrides.needsHumanReview !== undefined ? overrides.needsHumanReview : needsHumanReview;
    const hc = overrides.hasComments !== undefined ? overrides.hasComments : hasComments;
    const mv = overrides.minViews !== undefined ? overrides.minViews : minViews;
    const mf = overrides.minForwards !== undefined ? overrides.minForwards : minForwards;
    const d = overrides.days !== undefined ? overrides.days : days;
    const df = overrides.dateFrom !== undefined ? overrides.dateFrom : dateFrom;
    const dt = overrides.dateTo !== undefined ? overrides.dateTo : dateTo;
    const sem = overrides.useSemantic !== undefined ? overrides.useSemantic : useSemantic;
    const sb = overrides.sortBy !== undefined ? overrides.sortBy : sortBy;
    const so = overrides.sortOrder !== undefined ? overrides.sortOrder : sortOrder;

    if (q.trim()) params.set('q', q.trim());
    if (ch.trim()) params.set('channel_username', ch.trim());
    if (cf.trim()) params.set('channel_folder', cf.trim());
    if (hm !== 'any') params.set('has_media', hm);
    if (mt) params.set('media_type', mt);
    if (tp) params.set('topic', tp);
    if (sp !== 'exclude') params.set('is_spam', sp);
    // New intelligence filters
    if (imp) params.set('importance_level', imp);
    if (lang) params.set('language', lang);
    if (nhr !== 'any') params.set('needs_human_review', nhr);
    if (hc !== 'any') params.set('has_comments', hc);
    if (mv) params.set('min_views', mv);
    if (mf) params.set('min_forwards', mf);
    if (sem) params.set('use_semantic', 'true');

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

  // Handle country filter selection
  const handleCountrySelection = (selection: CountrySelection, channelUsernames: string[]) => {
    setCountrySelection(selection);

    let folderPattern = '';
    if (selection === 'ukraine') {
      folderPattern = '%UA';
    } else if (selection === 'russia') {
      folderPattern = '%RU';
    }

    setChannelFolder(folderPattern);
    // Clear individual channel selection when using country filter
    setChannelUsername('');

    router.push(buildFilterUrl({
      channelFolder: folderPattern,
      channelUsername: '',
    }));
  };

  // Count active filters
  const activeFilterCount = [
    query.trim(),
    channelUsername.trim() || channelFolder.trim(),
    hasMedia !== 'any',
    mediaType,
    topic,
    isSpam !== 'exclude',
    importanceLevel,
    language,
    needsHumanReview !== 'any',
    hasComments !== 'any',
    minViews,
    minForwards,
    days,
    dateFrom,
    dateTo,
    useSemantic,
  ].filter(Boolean).length;

  // Clear all filters
  const clearFilters = () => {
    setQuery('');
    setChannelUsername('');
    setChannelFolder('');
    setCountrySelection('all');
    setHasMedia('any');
    setMediaType('');
    setTopic('');
    setIsSpam('exclude');
    setImportanceLevel('');
    setLanguage('');
    setNeedsHumanReview('any');
    setHasComments('any');
    setMinViews('');
    setMinForwards('');
    setDateFrom('');
    setDateTo('');
    setDays('');
    setUseSemantic(false);
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

  // Feed token state for signed URLs
  const [feedToken, setFeedToken] = useState<string | null>(null);
  const [authRequired, setAuthRequired] = useState(false);
  const [authLoading, setAuthLoading] = useState(true);
  const [feedUrlGenerating, setFeedUrlGenerating] = useState(false);

  // Feed format options
  const feedFormats = [
    { id: 'rss', name: 'RSS 2.0', icon: '📰', description: 'Most compatible format' },
    { id: 'atom', name: 'Atom 1.0', icon: '⚛️', description: 'Modern standard (RFC 4287)' },
    { id: 'json', name: 'JSON Feed', icon: '📋', description: 'For developers & APIs' },
  ];

  // Check feed auth status and fetch user's token on mount
  useEffect(() => {
    const checkFeedAuth = async () => {
      try {
        // Check if auth is required
        const statusRes = await fetch(`${API_URL}/api/feed-tokens/auth-status`);
        if (statusRes.ok) {
          const statusData = await statusRes.json();
          setAuthRequired(statusData.auth_required);

          // If auth is required or optional, try to fetch user's tokens
          const tokenRes = await fetch(`${API_URL}/api/feed-tokens`, {
            credentials: 'include',
          });

          if (tokenRes.ok) {
            const tokenData = await tokenRes.json();
            const activeToken = tokenData.tokens.find((t: any) => t.is_active);
            if (activeToken) {
              setFeedToken(activeToken.id);
            }
          }
        }
      } catch (err) {
        // Ignore - feeds will work without auth if not required
        console.warn('Failed to check feed auth status:', err);
      } finally {
        setAuthLoading(false);
      }
    };

    checkFeedAuth();
  }, []);

  // Generate feed URL from current filters
  const getFeedUrl = async (format: string = 'rss'): Promise<string> => {
    const params = new URLSearchParams();
    params.set('format', format);
    if (query.trim()) params.set('q', query.trim());
    if (channelUsername.trim()) params.set('channel_username', channelUsername.trim());
    if (channelFolder.trim()) params.set('channel_folder', channelFolder.trim());
    if (hasMedia !== 'any') params.set('has_media', hasMedia);
    if (mediaType) params.set('media_type', mediaType);
    if (topic) params.set('topic', topic);
    if (isSpam !== 'exclude') params.set('is_spam', isSpam);
    // New intelligence filters
    if (importanceLevel) params.set('importance_level', importanceLevel);
    if (language) params.set('language', language);
    if (needsHumanReview !== 'any') params.set('needs_human_review', needsHumanReview);
    if (hasComments !== 'any') params.set('has_comments', hasComments);
    if (minViews) params.set('min_views', minViews);
    if (minForwards) params.set('min_forwards', minForwards);
    if (days) {
      params.set('days', days);
    } else {
      if (dateFrom) params.set('date_from', dateFrom);
      if (dateTo) params.set('date_to', dateTo);
    }
    // Include sorting in feeds
    if (sortBy !== 'telegram_date') params.set('sort_by', sortBy);
    if (sortOrder !== 'desc') params.set('sort_order', sortOrder);

    // If we have a token, request a signed URL
    if (feedToken) {
      try {
        const res = await fetch(`${API_URL}/api/feed-tokens/${feedToken}/sign-url`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          credentials: 'include',
          body: JSON.stringify({
            endpoint: '/rss/search',
            params: Object.fromEntries(params),
          }),
        });

        if (res.ok) {
          const data = await res.json();
          return data.url;
        } else {
          // Fall through to unsigned URL if signing fails
          console.warn('Failed to sign feed URL, using unsigned URL');
        }
      } catch (err) {
        // Fall through to unsigned URL on error
        console.warn('Error signing feed URL:', err);
      }
    }

    // Return unsigned URL (works when auth is not required)
    return `${API_URL}/rss/search?${params.toString()}`;
  };

  const copyFeedUrl = async (format: string) => {
    // Check if auth is required but no token available
    if (authRequired && !feedToken) {
      alert('Feed authentication is required. Please create a feed token in Settings > Feed Tokens first.');
      setShowFeedMenu(false);
      return;
    }

    setFeedUrlGenerating(true);
    try {
      const url = await getFeedUrl(format);
      await navigator.clipboard.writeText(url);
      const formatName = feedFormats.find(f => f.id === format)?.name || format.toUpperCase();
      alert(`${formatName} feed URL copied to clipboard!`);
      setShowFeedMenu(false);
    } catch (err) {
      console.error('Failed to copy feed URL:', err);
      alert('Failed to copy feed URL. Please try again.');
    } finally {
      setFeedUrlGenerating(false);
    }
  };

  const openFeedInNewTab = async (format: string) => {
    // Check if auth is required but no token available
    if (authRequired && !feedToken) {
      alert('Feed authentication is required. Please create a feed token in Settings > Feed Tokens first.');
      setShowFeedMenu(false);
      return;
    }

    setFeedUrlGenerating(true);
    try {
      const url = await getFeedUrl(format);
      window.open(url, '_blank');
      setShowFeedMenu(false);
    } catch (err) {
      console.error('Failed to open feed URL:', err);
      alert('Failed to open feed URL. Please try again.');
    } finally {
      setFeedUrlGenerating(false);
    }
  };

  return (
    <>
      {/* Country Filter - Prominent at top */}
      <CountryFilter
        channels={channels}
        currentSelection={countrySelection}
        onSelectionChange={handleCountrySelection}
      />

      <div className="glass rounded-xl overflow-hidden">
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
            placeholder={useSemantic ? "Find semantically similar messages..." : "Search in original or translated text..."}
            className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
          />

          {/* Semantic Search Toggle */}
          <div className="mt-3 flex items-start gap-3 p-3 bg-bg-secondary/50 rounded-lg border border-border-subtle">
            <input
              id="semantic-search"
              type="checkbox"
              checked={useSemantic}
              onChange={(e) => {
                setUseSemantic(e.target.checked);
                router.push(buildFilterUrl({ useSemantic: e.target.checked }));
              }}
              className="mt-0.5 w-4 h-4 rounded border-border bg-bg-secondary text-primary focus:ring-2 focus:ring-primary focus:ring-offset-0"
            />
            <label htmlFor="semantic-search" className="flex-1 cursor-pointer">
              <div className="flex items-center gap-2 text-sm font-medium text-text-primary">
                <span>🔍 Use Semantic Search</span>
                <span className="px-2 py-0.5 bg-primary/10 text-primary text-xs rounded">AI-Powered</span>
              </div>
              <p className="text-xs text-text-tertiary mt-1">
                Find messages by meaning, not just keywords. Uses AI embeddings for similarity matching.
              </p>
            </label>
          </div>
        </div>

        {/* Sorting Controls */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Sort By */}
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
              <option value="telegram_date">📅 Date (Telegram)</option>
              <option value="created_at">🆕 Date Added</option>
              <option value="importance_level">⭐ Importance Level</option>
              <option value="content_urgency_level">🚨 Urgency Level</option>
              <option value="osint_topic">📁 Topic</option>
              <option value="media_type">🎬 Media Type</option>
              <option value="language_detected">🌐 Language</option>
              <option value="message_id">🔢 Message ID</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Order messages by field
            </p>
          </div>

          {/* Sort Order */}
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
              <option value="desc">⬇️ Descending (High to Low, Newest First)</option>
              <option value="asc">⬆️ Ascending (Low to High, Oldest First)</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              {sortOrder === 'desc'
                ? (sortBy === 'telegram_date' || sortBy === 'created_at'
                   ? 'Newest messages first'
                   : 'Highest values first')
                : (sortBy === 'telegram_date' || sortBy === 'created_at'
                   ? 'Oldest messages first'
                   : 'Lowest values first')
              }
            </p>
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
                // Clear country filter when selecting individual channel
                if (e.target.value) {
                  setChannelFolder('');
                  setCountrySelection('all');
                }
                router.push(buildFilterUrl({
                  channelUsername: e.target.value,
                  channelFolder: '',
                }));
              }}
              disabled={channelsLoading}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent disabled:opacity-50 disabled:cursor-not-allowed"
            >
              <option value="">All Channels</option>

              {/* Group channels by folder */}
              {!channelsLoading && channels.length > 0 && (() => {
                // Separate channels by folder (Archive-UA, Monitor-UA, Archive-RU, Monitor-RU)
                const ukraineChannels = channels.filter(ch => ch.folder?.toUpperCase().includes('-UA'));
                const russiaChannels = channels.filter(ch => ch.folder?.toUpperCase().includes('-RU'));
                const otherChannels = channels.filter(ch =>
                  !ch.folder?.toUpperCase().includes('-UA') &&
                  !ch.folder?.toUpperCase().includes('-RU')
                );

                return (
                  <>
                    {ukraineChannels.length > 0 && (
                      <>
                        <option value="" disabled className="text-text-tertiary">──────────────</option>
                        <option value="" disabled className="text-text-secondary font-semibold">
                          🇺🇦 Ukrainian Channels
                        </option>
                        {ukraineChannels.map(ch => (
                          <option key={ch.id} value={ch.username || ''}>
                            {ch.name || ch.username || `Channel ${ch.telegram_id}`}
                            {ch.folder && ` [${ch.folder}]`}
                            {ch.verified && ' ✓'}
                          </option>
                        ))}
                      </>
                    )}

                    {russiaChannels.length > 0 && (
                      <>
                        <option value="" disabled className="text-text-tertiary">──────────────</option>
                        <option value="" disabled className="text-text-secondary font-semibold">
                          🇷🇺 Russian Channels
                        </option>
                        {russiaChannels.map(ch => (
                          <option key={ch.id} value={ch.username || ''}>
                            {ch.name || ch.username || `Channel ${ch.telegram_id}`}
                            {ch.folder && ` [${ch.folder}]`}
                            {ch.verified && ' ✓'}
                          </option>
                        ))}
                      </>
                    )}

                    {otherChannels.length > 0 && (
                      <>
                        <option value="" disabled className="text-text-tertiary">──────────────</option>
                        <option value="" disabled className="text-text-secondary font-semibold">
                          📁 Other Channels
                        </option>
                        {otherChannels.map(ch => (
                          <option key={ch.id} value={ch.username || ''}>
                            {ch.name || ch.username || `Channel ${ch.telegram_id}`}
                            {ch.folder && ` [${ch.folder}]`}
                            {ch.verified && ' ✓'}
                          </option>
                        ))}
                      </>
                    )}
                  </>
                );
              })()}
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
              <option value="photo">📷 Photos</option>
              <option value="video">🎥 Videos</option>
              <option value="document">📄 Documents</option>
              <option value="audio">🔊 Audio</option>
              <option value="voice">🎤 Voice</option>
            </select>
          </div>

          {/* Importance Level Filter */}
          <div>
            <label htmlFor="importance" className="block text-sm font-medium mb-2">
              Importance Level
            </label>
            <select
              id="importance"
              value={importanceLevel}
              onChange={(e) => {
                setImportanceLevel(e.target.value);
                router.push(buildFilterUrl({ importanceLevel: e.target.value }));
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="">All Levels</option>
              <option value="high">🔴 High Priority</option>
              <option value="medium">🟡 Medium Priority</option>
              <option value="low">⚪ Low Priority</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              AI-assessed intelligence value
            </p>
          </div>
        </div>

        {/* Filter Grid - Topic and Language */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Topic Filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="topic" className="block text-sm font-medium">
                Topic
              </label>
              {topic && (
                <button
                  onClick={() => {
                    setTopic('');
                    router.push(buildFilterUrl({ topic: '' }));
                  }}
                  className="text-xs text-accent-primary hover:underline"
                >
                  ×  Clear
                </button>
              )}
            </div>
            <select
              id="topic"
              value={topic}
              onChange={(e) => {
                setTopic(e.target.value);
                router.push(buildFilterUrl({ topic: e.target.value }));
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="">All Topics</option>
              <option value="combat">⚔️ Combat</option>
              <option value="equipment">🛡️ Equipment</option>
              <option value="casualties">💀 Casualties</option>
              <option value="movements">🚛 Movements</option>
              <option value="infrastructure">⚡ Infrastructure</option>
              <option value="humanitarian">🏘️ Humanitarian</option>
              <option value="diplomatic">🤝 Diplomatic</option>
              <option value="intelligence">🔍 Intelligence</option>
              <option value="propaganda">📢 Propaganda</option>
              <option value="units">🎖️ Units</option>
              <option value="locations">📍 Locations</option>
              <option value="general">📰 General</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Filter by AI-detected topic
            </p>
          </div>

          {/* Language Filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="language" className="block text-sm font-medium">
                Language
              </label>
              {language && (
                <button
                  onClick={() => {
                    setLanguage('');
                    router.push(buildFilterUrl({ language: '' }));
                  }}
                  className="text-xs text-accent-primary hover:underline"
                >
                  × Clear
                </button>
              )}
            </div>
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
              <option value="uk">🇺🇦 Ukrainian</option>
              <option value="ru">🇷🇺 Russian</option>
              <option value="en">🇬🇧 English</option>
              <option value="de">🇩🇪 German</option>
              <option value="fr">🇫🇷 French</option>
              <option value="pl">🇵🇱 Polish</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Detected source language
            </p>
          </div>
        </div>

        {/* Filter Grid - Spam and Social Filters */}
        <div className="grid grid-cols-1 md:grid-cols-4 gap-4">
          {/* Spam Filter */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label htmlFor="spam" className="block text-sm font-medium">
                Spam Filter
              </label>
              {isSpam !== 'exclude' && (
                <button
                  onClick={() => {
                    setIsSpam('exclude');
                    router.push(buildFilterUrl({ isSpam: 'exclude' }));
                  }}
                  className="text-xs text-accent-primary hover:underline"
                >
                  × Clear
                </button>
              )}
            </div>
            <select
              id="spam"
              value={isSpam}
              onChange={(e) => {
                setIsSpam(e.target.value);
                router.push(buildFilterUrl({ isSpam: e.target.value }));
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="exclude">Exclude Spam (default)</option>
              <option value="false">Only Non-Spam</option>
              <option value="true">Only Spam</option>
              <option value="any">Include All</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Control spam message visibility
            </p>
          </div>

          {/* Human Review Filter */}
          <div>
            <label htmlFor="human-review" className="block text-sm font-medium mb-2">
              Human Review
            </label>
            <select
              id="human-review"
              value={needsHumanReview}
              onChange={(e) => {
                setNeedsHumanReview(e.target.value);
                router.push(buildFilterUrl({ needsHumanReview: e.target.value }));
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            >
              <option value="any">Any Status</option>
              <option value="true">⚠️ Needs Review</option>
              <option value="false">✅ Reviewed/OK</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Review workflow status
            </p>
          </div>

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
              <option value="true">💬 Has Comments</option>
              <option value="false">No Comments</option>
            </select>
            <p className="text-xs text-text-tertiary mt-1">
              Posts with discussions
            </p>
          </div>
        </div>

        {/* Engagement Filters */}
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          {/* Minimum Views */}
          <div>
            <label htmlFor="min-views" className="block text-sm font-medium mb-2">
              Minimum Views
            </label>
            <div className="flex gap-2 items-center">
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
                className="flex-1 px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {minViews && (
                <button
                  onClick={() => {
                    setMinViews('');
                    router.push(buildFilterUrl({ minViews: '' }));
                  }}
                  className="text-xs text-accent-primary hover:underline px-2"
                >
                  × Clear
                </button>
              )}
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              👁️ Filter by view count threshold
            </p>
          </div>

          {/* Minimum Forwards */}
          <div>
            <label htmlFor="min-forwards" className="block text-sm font-medium mb-2">
              Minimum Forwards
            </label>
            <div className="flex gap-2 items-center">
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
                className="flex-1 px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
              />
              {minForwards && (
                <button
                  onClick={() => {
                    setMinForwards('');
                    router.push(buildFilterUrl({ minForwards: '' }));
                  }}
                  className="text-xs text-accent-primary hover:underline px-2"
                >
                  × Clear
                </button>
              )}
            </div>
            <p className="text-xs text-text-tertiary mt-1">
              ↗️ Filter viral/shared content
            </p>
          </div>
        </div>

        {/* Date Range Filters */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          {/* Quick Date Filter (Last N Days) */}
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
                  // Clear date range when using days filter
                  setDateFrom('');
                  setDateTo('');
                }
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
            <p className="text-xs text-text-tertiary mt-1">
              Quick filter by recency
            </p>
          </div>

          {/* Date From */}
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
                if (e.target.value) setDays(''); // Clear days when using date range
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>

          {/* Date To */}
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
                if (e.target.value) setDays(''); // Clear days when using date range
              }}
              className="w-full px-4 py-3 bg-bg-secondary border border-border rounded-lg text-text-primary focus:outline-none focus:ring-2 focus:ring-primary focus:border-transparent"
            />
          </div>
        </div>

        {/* Feed Subscribe Button with Format Dropdown */}
        <div className="flex justify-end relative">
          <div className="relative w-full max-w-md">
            {/* Warning if auth required but no token */}
            {authRequired && !feedToken && !authLoading && (
              <div className="mb-3 p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg text-sm text-amber-400">
                <p className="font-medium">Feed authentication is required</p>
                <p className="text-xs mt-1">
                  Please create a feed token in <a href="/settings/feed-tokens" className="underline hover:text-amber-300">Settings → Feed Tokens</a> to subscribe to feeds.
                </p>
              </div>
            )}

            {/* Info if token is available */}
            {feedToken && !authLoading && (
              <div className="mb-3 p-2 bg-green-500/10 border border-green-500/30 rounded-lg text-xs text-green-400">
                <p>Feed URLs will be signed with your authentication token</p>
              </div>
            )}

            <button
              onClick={() => setShowFeedMenu(!showFeedMenu)}
              disabled={feedUrlGenerating || (authRequired && !feedToken)}
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

            {/* Dropdown Menu */}
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
                <div className="p-2 border-t border-border">
                  <p className="text-xs text-text-tertiary px-2">
                    📰 RSS works everywhere • ⚛️ Atom has better content • 📋 JSON for code
                  </p>
                </div>
              </div>
            )}
          </div>

          {/* Click outside to close */}
          {showFeedMenu && (
            <div
              className="fixed inset-0 z-40"
              onClick={() => setShowFeedMenu(false)}
            />
          )}
        </div>

        {/* Active Filters Summary */}
        {(query || channelUsername || channelFolder || hasMedia !== 'any' || mediaType || topic || isSpam !== 'exclude' || importanceLevel || language || needsHumanReview !== 'any' || hasComments !== 'any' || minViews || minForwards || days || dateFrom || dateTo || useSemantic) && (
          <div className="pt-4 border-t border-border">
            <p className="text-sm text-text-tertiary mb-2">Active filters:</p>
            <div className="flex flex-wrap gap-2">
              {query && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                  Search: {query}
                </span>
              )}
              {useSemantic && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 text-sm rounded-full">
                  🔍 Semantic Search
                </span>
              )}
              {channelFolder && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                  Country: {channelFolder === '%UA' ? '🇺🇦 Ukraine' : '🇷🇺 Russia'}
                </span>
              )}
              {channelUsername && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                  Channel: {channelUsername}
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
              {topic && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                  Topic: {topic}
                </span>
              )}
              {importanceLevel && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-red-500/10 text-red-400 text-sm rounded-full">
                  Priority: {importanceLevel === 'high' ? '🔴 High' : importanceLevel === 'medium' ? '🟡 Medium' : '⚪ Low'}
                </span>
              )}
              {language && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-blue-500/10 text-blue-400 text-sm rounded-full">
                  Language: {language.toUpperCase()}
                </span>
              )}
              {needsHumanReview !== 'any' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-orange-500/10 text-orange-400 text-sm rounded-full">
                  Review: {needsHumanReview === 'true' ? '⚠️ Needs Review' : '✅ Reviewed'}
                </span>
              )}
              {hasComments !== 'any' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-green-500/10 text-green-400 text-sm rounded-full">
                  Comments: {hasComments === 'true' ? '💬 Has Comments' : 'No Comments'}
                </span>
              )}
              {minViews && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/10 text-cyan-400 text-sm rounded-full">
                  👁️ Min Views: {minViews}
                </span>
              )}
              {minForwards && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-cyan-500/10 text-cyan-400 text-sm rounded-full">
                  ↗️ Min Forwards: {minForwards}
                </span>
              )}
              {isSpam !== 'exclude' && (
                <span className="inline-flex items-center gap-1 px-3 py-1 bg-primary/10 text-primary text-sm rounded-full">
                  Spam: {isSpam === 'true' ? 'Only Spam' : isSpam === 'false' ? 'No Spam' : 'Include All'}
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
    </>
  );
}
