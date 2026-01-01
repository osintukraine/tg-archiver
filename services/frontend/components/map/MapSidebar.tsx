'use client';

import { useState, useEffect, useCallback } from 'react';
import { Settings, Activity, X, ChevronLeft, ChevronRight } from 'lucide-react';
import { API_URL } from '../../lib/api';
import MapExpandedCard from './MapExpandedCard';
import type { MapMessageProperties } from './MapHoverCard';

// Region focus options
export type RegionFocus = 'conflict' | 'worldwide';

// Conflict zone bounding box (Ukraine + border regions)
export const CONFLICT_ZONE_BBOX = {
  south: 44.0,
  north: 53.0,
  west: 22.0,
  east: 42.0,
};

interface HotLocation {
  location_name: string;
  message_count: number;
  latitude: number;
  longitude: number;
}

interface RecentMessage {
  message_id: number;
  channel_name: string;
  channel_affiliation: string;
  content: string;
  content_translated: string;
  location_name: string;
  telegram_date: string;
  latitude: number;
  longitude: number;
}

interface MapSidebarProps {
  // Filter state (lifted up to MapView)
  regionFocus: RegionFocus;
  onRegionFocusChange: (focus: RegionFocus) => void;

  // Layer toggles
  showClusters: boolean;
  onShowClustersChange: (show: boolean) => void;
  showEvents: boolean;
  onShowEventsChange: (show: boolean) => void;
  showHeatMap: boolean;
  onShowHeatMapChange: (show: boolean) => void;
  showTrajectories: boolean;
  onShowTrajectoriesChange: (show: boolean) => void;
  showVessels: boolean;
  onShowVesselsChange: (show: boolean) => void;
  liveUpdatesEnabled: boolean;
  onLiveUpdatesChange: (enabled: boolean) => void;

  // WebSocket status
  wsStatus: string;
  wsRetryCount: number;
  wsMaxRetries: number;
  onWsReconnect: () => void;

  // Heat map settings
  heatMapRadius: number;
  onHeatMapRadiusChange: (radius: number) => void;
  heatMapOpacity: number;
  onHeatMapOpacityChange: (opacity: number) => void;

  // Selected message (for expanded view)
  selectedMessage: MapMessageProperties | null;
  onSelectedMessageChange: (msg: MapMessageProperties | null) => void;

  // Map interaction
  onFlyToLocation: (lat: number, lng: number, zoom?: number) => void;
}

export default function MapSidebar({
  regionFocus,
  onRegionFocusChange,
  showClusters,
  onShowClustersChange,
  showEvents,
  onShowEventsChange,
  showHeatMap,
  onShowHeatMapChange,
  showTrajectories,
  onShowTrajectoriesChange,
  showVessels,
  onShowVesselsChange,
  liveUpdatesEnabled,
  onLiveUpdatesChange,
  wsStatus,
  wsRetryCount,
  wsMaxRetries,
  onWsReconnect,
  heatMapRadius,
  onHeatMapRadiusChange,
  heatMapOpacity,
  onHeatMapOpacityChange,
  selectedMessage,
  onSelectedMessageChange,
  onFlyToLocation,
}: MapSidebarProps) {
  const [activeTab, setActiveTab] = useState<'filters' | 'feed'>('feed');
  // Start collapsed on mobile, expanded on desktop
  const [isCollapsed, setIsCollapsed] = useState(true); // Default true, updated on mount
  const [hotLocations, setHotLocations] = useState<HotLocation[]>([]);
  const [recentMessages, setRecentMessages] = useState<RecentMessage[]>([]);
  const [feedLoading, setFeedLoading] = useState(false);

  // Set initial collapsed state based on screen size
  useEffect(() => {
    const mediaQuery = window.matchMedia('(min-width: 768px)');
    // On desktop (≥768px), start expanded; on mobile, start collapsed
    setIsCollapsed(!mediaQuery.matches);

    // Optional: Listen for resize changes
    const handleChange = (e: MediaQueryListEvent) => {
      // Only auto-collapse when going mobile → don't force expand
      if (!e.matches) {
        setIsCollapsed(true);
      }
    };
    mediaQuery.addEventListener('change', handleChange);
    return () => mediaQuery.removeEventListener('change', handleChange);
  }, []);

  // Load hot locations and recent messages
  const loadFeedData = useCallback(async () => {
    setFeedLoading(true);
    try {
      // Load hot locations
      const hotRes = await fetch(`${API_URL}/api/map/hot-locations?hours=24&limit=5`);
      if (hotRes.ok) {
        const hotData = await hotRes.json();
        setHotLocations(hotData.locations || []);
      }

      // Load recent messages
      const recentRes = await fetch(`${API_URL}/api/map/recent-messages?limit=10`);
      if (recentRes.ok) {
        const recentData = await recentRes.json();
        setRecentMessages(recentData.messages || []);
      }
    } catch (e) {
      console.error('Error loading feed data:', e);
    } finally {
      setFeedLoading(false);
    }
  }, []);

  // Load feed data on mount and periodically
  useEffect(() => {
    loadFeedData();
    const interval = setInterval(loadFeedData, 60000); // Refresh every minute
    return () => clearInterval(interval);
  }, [loadFeedData]);

  // When a message is selected, switch to feed tab to show it
  useEffect(() => {
    if (selectedMessage) {
      setActiveTab('feed');
    }
  }, [selectedMessage]);

  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'connected': return '#10b981';
      case 'connecting': return '#f59e0b';
      case 'error': return '#ef4444';
      case 'failed': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'connected': return 'Live';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Error';
      case 'failed': return 'Failed';
      default: return 'Offline';
    }
  };

  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  if (isCollapsed) {
    return (
      <div className="h-full flex items-center">
        <button
          onClick={() => setIsCollapsed(false)}
          className="bg-bg-elevated border border-border rounded-l-lg p-3 md:p-2 hover:bg-bg-secondary transition-colors shadow-lg md:shadow-none"
          title="Expand sidebar"
        >
          <ChevronLeft className="w-6 h-6 md:w-5 md:h-5 text-text-secondary" />
        </button>
      </div>
    );
  }

  return (
    <div className="h-full w-[300px] md:w-[350px] bg-bg-elevated border-l border-border flex flex-col">
      {/* Header with tabs and collapse */}
      <div className="flex items-center border-b border-border">
        {/* Tabs */}
        <div className="flex flex-1">
          <button
            onClick={() => setActiveTab('filters')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'filters'
                ? 'text-primary border-b-2 border-primary bg-bg-base'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
            }`}
          >
            <Settings className="w-4 h-4" />
            Filters
          </button>
          <button
            onClick={() => setActiveTab('feed')}
            className={`flex-1 flex items-center justify-center gap-2 px-4 py-3 text-sm font-medium transition-colors ${
              activeTab === 'feed'
                ? 'text-primary border-b-2 border-primary bg-bg-base'
                : 'text-text-secondary hover:text-text-primary hover:bg-bg-secondary'
            }`}
          >
            <Activity className="w-4 h-4" />
            Feed
            {selectedMessage && (
              <span className="w-2 h-2 bg-primary rounded-full" />
            )}
          </button>
        </div>

        {/* Collapse button */}
        <button
          onClick={() => setIsCollapsed(true)}
          className="p-3 text-text-tertiary hover:text-text-primary hover:bg-bg-secondary transition-colors"
          title="Collapse sidebar"
        >
          <ChevronRight className="w-5 h-5" />
        </button>
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-y-auto">
        {activeTab === 'filters' ? (
          <FiltersTab
            regionFocus={regionFocus}
            onRegionFocusChange={onRegionFocusChange}
            showClusters={showClusters}
            onShowClustersChange={onShowClustersChange}
            showEvents={showEvents}
            onShowEventsChange={onShowEventsChange}
            showHeatMap={showHeatMap}
            onShowHeatMapChange={onShowHeatMapChange}
            showTrajectories={showTrajectories}
            onShowTrajectoriesChange={onShowTrajectoriesChange}
            showVessels={showVessels}
            onShowVesselsChange={onShowVesselsChange}
            liveUpdatesEnabled={liveUpdatesEnabled}
            onLiveUpdatesChange={onLiveUpdatesChange}
            wsStatus={wsStatus}
            wsRetryCount={wsRetryCount}
            wsMaxRetries={wsMaxRetries}
            onWsReconnect={onWsReconnect}
            heatMapRadius={heatMapRadius}
            onHeatMapRadiusChange={onHeatMapRadiusChange}
            heatMapOpacity={heatMapOpacity}
            onHeatMapOpacityChange={onHeatMapOpacityChange}
          />
        ) : (
          <FeedTab
            selectedMessage={selectedMessage}
            onSelectedMessageChange={onSelectedMessageChange}
            hotLocations={hotLocations}
            recentMessages={recentMessages}
            loading={feedLoading}
            onFlyToLocation={onFlyToLocation}
          />
        )}
      </div>
    </div>
  );
}

// Filters Tab Component
function FiltersTab({
  regionFocus,
  onRegionFocusChange,
  showClusters,
  onShowClustersChange,
  showEvents,
  onShowEventsChange,
  showHeatMap,
  onShowHeatMapChange,
  showTrajectories,
  onShowTrajectoriesChange,
  showVessels,
  onShowVesselsChange,
  liveUpdatesEnabled,
  onLiveUpdatesChange,
  wsStatus,
  wsRetryCount,
  wsMaxRetries,
  onWsReconnect,
  heatMapRadius,
  onHeatMapRadiusChange,
  heatMapOpacity,
  onHeatMapOpacityChange,
}: {
  regionFocus: RegionFocus;
  onRegionFocusChange: (focus: RegionFocus) => void;
  showClusters: boolean;
  onShowClustersChange: (show: boolean) => void;
  showEvents: boolean;
  onShowEventsChange: (show: boolean) => void;
  showHeatMap: boolean;
  onShowHeatMapChange: (show: boolean) => void;
  showTrajectories: boolean;
  onShowTrajectoriesChange: (show: boolean) => void;
  showVessels: boolean;
  onShowVesselsChange: (show: boolean) => void;
  liveUpdatesEnabled: boolean;
  onLiveUpdatesChange: (enabled: boolean) => void;
  wsStatus: string;
  wsRetryCount: number;
  wsMaxRetries: number;
  onWsReconnect: () => void;
  heatMapRadius: number;
  onHeatMapRadiusChange: (radius: number) => void;
  heatMapOpacity: number;
  onHeatMapOpacityChange: (opacity: number) => void;
}) {
  const getStatusColor = (status: string): string => {
    switch (status) {
      case 'connected': return '#10b981';
      case 'connecting': return '#f59e0b';
      case 'error': return '#ef4444';
      case 'failed': return '#dc2626';
      default: return '#6b7280';
    }
  };

  const getStatusLabel = (status: string): string => {
    switch (status) {
      case 'connected': return 'Live';
      case 'connecting': return 'Connecting...';
      case 'error': return 'Error';
      case 'failed': return 'Failed';
      default: return 'Offline';
    }
  };

  return (
    <div className="p-4 space-y-6">
      {/* Region Focus */}
      <section>
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          Region Focus
        </h3>
        <div className="flex gap-2">
          <button
            onClick={() => onRegionFocusChange('conflict')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              regionFocus === 'conflict'
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            🇺🇦 Conflict Zone
          </button>
          <button
            onClick={() => onRegionFocusChange('worldwide')}
            className={`flex-1 flex items-center justify-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors ${
              regionFocus === 'worldwide'
                ? 'bg-primary text-white'
                : 'bg-bg-secondary text-text-secondary hover:bg-bg-tertiary'
            }`}
          >
            🌍 Worldwide
          </button>
        </div>
      </section>

      {/* Layers */}
      <section>
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          Map Layers
        </h3>
        <div className="space-y-2">
          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showClusters}
              onChange={(e) => onShowClustersChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Event Clusters</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showEvents}
              onChange={(e) => onShowEventsChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Verified Events</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showHeatMap}
              onChange={(e) => onShowHeatMapChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Heat Map</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showTrajectories}
              onChange={(e) => onShowTrajectoriesChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Trajectories</span>
            <span className="text-xs text-text-tertiary ml-auto">Drone paths</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={showVessels}
              onChange={(e) => onShowVesselsChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Vessels</span>
            <span className="text-xs text-text-tertiary ml-auto">Shadow Fleet</span>
          </label>

          <label className="flex items-center gap-3 cursor-pointer">
            <input
              type="checkbox"
              checked={liveUpdatesEnabled}
              onChange={(e) => onLiveUpdatesChange(e.target.checked)}
              className="w-4 h-4 rounded border-border text-primary focus:ring-primary"
            />
            <span className="text-sm text-text-primary">Live Updates</span>
            <div className="flex items-center gap-1.5 ml-auto">
              <div
                className="w-2 h-2 rounded-full"
                style={{ backgroundColor: getStatusColor(wsStatus) }}
              />
              <span className="text-xs text-text-tertiary">{getStatusLabel(wsStatus)}</span>
            </div>
          </label>

          {wsStatus === 'connecting' && wsRetryCount > 0 && (
            <div className="text-xs text-text-tertiary ml-7">
              Retry {wsRetryCount}/{wsMaxRetries}
            </div>
          )}

          {wsStatus === 'failed' && (
            <button
              onClick={onWsReconnect}
              className="ml-7 text-xs bg-primary hover:bg-primary/80 text-white px-2 py-1 rounded"
            >
              Reconnect
            </button>
          )}
        </div>
      </section>

      {/* Heat Map Settings */}
      {showHeatMap && (
        <section>
          <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
            Heat Map Settings
          </h3>
          <div className="space-y-4">
            <div>
              <div className="flex justify-between text-xs text-text-secondary mb-1">
                <span>Radius</span>
                <span>{heatMapRadius}px</span>
              </div>
              <input
                type="range"
                min="10"
                max="50"
                value={heatMapRadius}
                onChange={(e) => onHeatMapRadiusChange(Number(e.target.value))}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer"
              />
            </div>

            <div>
              <div className="flex justify-between text-xs text-text-secondary mb-1">
                <span>Opacity</span>
                <span>{Math.round(heatMapOpacity * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={heatMapOpacity * 100}
                onChange={(e) => onHeatMapOpacityChange(Number(e.target.value) / 100)}
                className="w-full h-2 bg-bg-tertiary rounded-lg appearance-none cursor-pointer"
              />
            </div>
          </div>
        </section>
      )}

      {/* Legend */}
      <section>
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          Legend
        </h3>
        <div className="space-y-3">
          <div>
            <div className="text-xs text-text-secondary mb-2">Sources</div>
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5">
                <span className="text-base">🇺🇦</span>
                <span className="text-xs text-text-primary">Ukrainian</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base">🇷🇺</span>
                <span className="text-xs text-text-primary">Russian</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="text-base">🏳️</span>
                <span className="text-xs text-text-primary">Unknown</span>
              </div>
            </div>
          </div>

          <div>
            <div className="text-xs text-text-secondary mb-2">Confidence</div>
            <div className="flex gap-4">
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-green-500" />
                <span className="text-xs text-text-primary">High</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-yellow-500" />
                <span className="text-xs text-text-primary">Medium</span>
              </div>
              <div className="flex items-center gap-1.5">
                <span className="w-3 h-3 rounded-full bg-red-500" />
                <span className="text-xs text-text-primary">Low</span>
              </div>
            </div>
          </div>
        </div>

        <p className="mt-4 text-xs text-text-tertiary italic">
          📍 Locations extracted from message text. Precision varies.
        </p>
      </section>
    </div>
  );
}

// Feed Tab Component
function FeedTab({
  selectedMessage,
  onSelectedMessageChange,
  hotLocations,
  recentMessages,
  loading,
  onFlyToLocation,
}: {
  selectedMessage: MapMessageProperties | null;
  onSelectedMessageChange: (msg: MapMessageProperties | null) => void;
  hotLocations: HotLocation[];
  recentMessages: RecentMessage[];
  loading: boolean;
  onFlyToLocation: (lat: number, lng: number, zoom?: number) => void;
}) {
  const formatTimeAgo = (dateString: string): string => {
    const date = new Date(dateString);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;

    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;

    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // If a message is selected, show the expanded card
  if (selectedMessage) {
    return (
      <div className="p-4">
        <div className="flex items-center justify-between mb-4">
          <h3 className="text-sm font-semibold text-text-primary">Selected Message</h3>
          <button
            onClick={() => onSelectedMessageChange(null)}
            className="p-1 hover:bg-bg-secondary rounded text-text-tertiary hover:text-text-primary transition-colors"
            title="Close"
          >
            <X className="w-4 h-4" />
          </button>
        </div>
        <MapExpandedCard
          properties={selectedMessage}
          onClose={() => onSelectedMessageChange(null)}
          embedded={true}
        />
      </div>
    );
  }

  // Default feed view
  return (
    <div className="p-4 space-y-6">
      {/* Hot Locations */}
      <section>
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          📍 Hot Locations (24h)
        </h3>
        {loading ? (
          <div className="text-sm text-text-tertiary">Loading...</div>
        ) : hotLocations.length > 0 ? (
          <div className="space-y-2">
            {hotLocations.map((loc, idx) => (
              <button
                key={idx}
                onClick={() => onFlyToLocation(loc.latitude, loc.longitude, 10)}
                className="w-full flex items-center justify-between p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors text-left"
              >
                <span className="text-sm text-text-primary">{loc.location_name}</span>
                <span className="text-xs text-text-tertiary">{loc.message_count} msgs</span>
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">No data available</div>
        )}
      </section>

      {/* Recent Messages */}
      <section>
        <h3 className="text-xs font-semibold text-text-tertiary uppercase tracking-wider mb-3">
          🔴 Recent Activity
        </h3>
        {loading ? (
          <div className="text-sm text-text-tertiary">Loading...</div>
        ) : recentMessages.length > 0 ? (
          <div className="space-y-3">
            {recentMessages.map((msg) => (
              <button
                key={msg.message_id}
                onClick={() => onFlyToLocation(msg.latitude, msg.longitude, 12)}
                className="w-full p-3 rounded-lg bg-bg-secondary hover:bg-bg-tertiary transition-colors text-left"
              >
                <div className="flex items-center justify-between mb-1">
                  <div className="flex items-center gap-2">
                    <span className="text-base">
                      {msg.channel_affiliation === 'ua' ? '🇺🇦' :
                       msg.channel_affiliation === 'ru' ? '🇷🇺' : '🏳️'}
                    </span>
                    <span className="text-xs font-medium text-text-primary truncate max-w-[150px]">
                      {msg.channel_name}
                    </span>
                  </div>
                  <span className="text-xs text-text-tertiary">
                    {formatTimeAgo(msg.telegram_date)}
                  </span>
                </div>
                <p className="text-xs text-text-secondary line-clamp-2">
                  {msg.content_translated || msg.content}
                </p>
                {msg.location_name && (
                  <div className="mt-1 text-xs text-text-tertiary">
                    📍 {msg.location_name}
                  </div>
                )}
              </button>
            ))}
          </div>
        ) : (
          <div className="text-sm text-text-tertiary">No recent messages</div>
        )}
      </section>
    </div>
  );
}
