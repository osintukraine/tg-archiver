'use client';

import { useState, useEffect, useCallback } from 'react';
import debounce from 'lodash/debounce';

interface EventSuggestion {
  id: number;
  title: string;
  summary: string;
  event_type: string;
  tier_status: string;
  message_count: number;
  created_at: string;
}

interface LinkEventModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (eventId: number, reason?: string) => void;
  onUnlink?: () => void;
  currentEventId?: number | null;
  loading?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

const TIER_COLORS: Record<string, string> = {
  rumor: 'bg-red-500/20 text-red-400 border-red-500/30',
  unconfirmed: 'bg-yellow-500/20 text-yellow-400 border-yellow-500/30',
  confirmed: 'bg-orange-500/20 text-orange-400 border-orange-500/30',
  verified: 'bg-green-500/20 text-green-400 border-green-500/30',
};

export function LinkEventModal({
  isOpen,
  onClose,
  onSubmit,
  onUnlink,
  currentEventId,
  loading = false,
}: LinkEventModalProps) {
  const [searchQuery, setSearchQuery] = useState('');
  const [events, setEvents] = useState<EventSuggestion[]>([]);
  const [selectedEventId, setSelectedEventId] = useState<number | null>(currentEventId || null);
  const [reason, setReason] = useState('');
  const [isSearching, setIsSearching] = useState(false);
  const [recentEvents, setRecentEvents] = useState<EventSuggestion[]>([]);

  // Load recent events on mount
  useEffect(() => {
    if (isOpen) {
      fetchRecentEvents();
      setSelectedEventId(currentEventId || null);
      setReason('');
      setSearchQuery('');
      setEvents([]);
    }
  }, [isOpen, currentEventId]);

  const fetchRecentEvents = async () => {
    try {
      const response = await fetch(
        `${API_URL}/api/events?page=1&page_size=10&tab=active`
      );
      if (response.ok) {
        const data = await response.json();
        setRecentEvents(data.events || []);
      }
    } catch (error) {
      console.error('Failed to fetch recent events:', error);
    }
  };

  // Debounced event search
  const searchEvents = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) {
        setEvents([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `${API_URL}/api/events?search=${encodeURIComponent(query)}&search_mode=text&page_size=20`
        );
        if (response.ok) {
          const data = await response.json();
          setEvents(data.events || []);
        }
      } catch (error) {
        console.error('Failed to search events:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300),
    []
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    searchEvents(query);
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedEventId) {
      onSubmit(selectedEventId, reason || undefined);
    }
  };

  const displayEvents = searchQuery.length >= 2 ? events : recentEvents;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-xl max-h-[80vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary">Link to Event</h3>
            <p className="text-sm text-text-secondary mt-1">
              Connect this message to an event cluster
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {/* Search */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Search Events
              </label>
              <input
                type="text"
                value={searchQuery}
                onChange={handleSearchChange}
                placeholder="Search by event title or description..."
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
              {isSearching && (
                <div className="text-sm text-text-tertiary mt-1">Searching...</div>
              )}
            </div>

            {/* Event List */}
            <div className="space-y-2">
              <div className="text-sm font-medium text-text-secondary">
                {searchQuery.length >= 2 ? 'Search Results' : 'Recent Active Events'}
              </div>

              {displayEvents.length === 0 ? (
                <div className="text-center py-8 text-text-tertiary">
                  {searchQuery.length >= 2
                    ? 'No events found matching your search'
                    : 'No recent events available'}
                </div>
              ) : (
                <div className="space-y-2 max-h-64 overflow-y-auto">
                  {displayEvents.map((event) => (
                    <button
                      key={event.id}
                      type="button"
                      onClick={() => setSelectedEventId(event.id)}
                      className={`w-full p-3 rounded-lg border text-left transition-colors ${
                        selectedEventId === event.id
                          ? 'bg-blue-500/20 border-blue-500/50'
                          : 'bg-bg-secondary border-border hover:bg-bg-tertiary'
                      }`}
                    >
                      <div className="flex items-start justify-between gap-2">
                        <div className="flex-1 min-w-0">
                          <div className="font-medium text-text-primary truncate">
                            {event.title}
                          </div>
                          <div className="text-xs text-text-secondary line-clamp-2 mt-1">
                            {event.summary}
                          </div>
                        </div>
                        <div className="flex flex-col items-end gap-1">
                          <span
                            className={`px-2 py-0.5 text-xs rounded-full border ${
                              TIER_COLORS[event.tier_status] || TIER_COLORS.rumor
                            }`}
                          >
                            {event.tier_status}
                          </span>
                          <span className="text-xs text-text-tertiary">
                            {event.message_count} msgs
                          </span>
                        </div>
                      </div>
                      <div className="flex items-center gap-2 mt-2 text-xs text-text-tertiary">
                        <span className="bg-bg-tertiary px-1.5 py-0.5 rounded">
                          {event.event_type}
                        </span>
                        <span>•</span>
                        <span>
                          {new Date(event.created_at).toLocaleDateString()}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              )}
            </div>

            {/* Selected Event Preview */}
            {selectedEventId && (
              <div className="p-3 bg-blue-500/10 border border-blue-500/30 rounded-lg">
                <div className="text-sm text-blue-400">
                  ✓ Selected Event #{selectedEventId}
                </div>
              </div>
            )}

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you linking this message to the event?"
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-between items-center">
            <div>
              {currentEventId && onUnlink && (
                <button
                  type="button"
                  onClick={onUnlink}
                  disabled={loading}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                >
                  Unlink Event
                </button>
              )}
            </div>
            <div className="flex gap-3">
              <button
                type="button"
                onClick={onClose}
                disabled={loading}
                className="px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary text-text-secondary rounded-lg transition-colors"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={loading || !selectedEventId}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Linking...' : 'Link to Event'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
