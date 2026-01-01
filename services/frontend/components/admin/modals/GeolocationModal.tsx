'use client';

import { useState, useEffect, useCallback } from 'react';
import debounce from 'lodash/debounce';

interface LocationSuggestion {
  geoname_id: number;
  name: string;
  name_en: string;
  admin1_name: string;
  country_code: string;
  latitude: number;
  longitude: number;
  population: number;
  feature_class: string;
}

interface GeolocationModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (
    latitude: number,
    longitude: number,
    location_name?: string,
    reason?: string
  ) => void;
  onRemove?: () => void;
  hasExisting?: boolean;
  loading?: boolean;
}

const API_URL = process.env.NEXT_PUBLIC_API_URL || 'http://localhost:8000';

export function GeolocationModal({
  isOpen,
  onClose,
  onSubmit,
  onRemove,
  hasExisting = false,
  loading = false,
}: GeolocationModalProps) {
  const [latitude, setLatitude] = useState('');
  const [longitude, setLongitude] = useState('');
  const [locationName, setLocationName] = useState('');
  const [reason, setReason] = useState('');
  const [searchQuery, setSearchQuery] = useState('');
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [isSearching, setIsSearching] = useState(false);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [inputMode, setInputMode] = useState<'search' | 'manual'>('search');

  // Reset form when modal opens
  useEffect(() => {
    if (isOpen) {
      setLatitude('');
      setLongitude('');
      setLocationName('');
      setReason('');
      setSearchQuery('');
      setSuggestions([]);
    }
  }, [isOpen]);

  // Debounced location search
  const searchLocations = useCallback(
    debounce(async (query: string) => {
      if (query.length < 2) {
        setSuggestions([]);
        return;
      }

      setIsSearching(true);
      try {
        const response = await fetch(
          `${API_URL}/api/map/locations/suggest?query=${encodeURIComponent(query)}&limit=10`
        );
        if (response.ok) {
          const data = await response.json();
          setSuggestions(data.suggestions || []);
          setShowSuggestions(true);
        }
      } catch (error) {
        console.error('Failed to search locations:', error);
      } finally {
        setIsSearching(false);
      }
    }, 300),
    []
  );

  const handleSearchChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const query = e.target.value;
    setSearchQuery(query);
    searchLocations(query);
  };

  const handleSelectSuggestion = (suggestion: LocationSuggestion) => {
    setLatitude(suggestion.latitude.toString());
    setLongitude(suggestion.longitude.toString());
    setLocationName(suggestion.name_en || suggestion.name);
    setSearchQuery(
      `${suggestion.name_en || suggestion.name}${suggestion.admin1_name ? `, ${suggestion.admin1_name}` : ''}, ${suggestion.country_code}`
    );
    setShowSuggestions(false);
  };

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const lat = parseFloat(latitude);
    const lng = parseFloat(longitude);

    if (isNaN(lat) || isNaN(lng)) {
      return;
    }

    onSubmit(lat, lng, locationName || undefined, reason || undefined);
  };

  const isValid =
    !isNaN(parseFloat(latitude)) &&
    !isNaN(parseFloat(longitude)) &&
    parseFloat(latitude) >= -90 &&
    parseFloat(latitude) <= 90 &&
    parseFloat(longitude) >= -180 &&
    parseFloat(longitude) <= 180;

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-lg">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary">
              {hasExisting ? 'Update Geolocation' : 'Add Geolocation'}
            </h3>
            <p className="text-sm text-text-secondary mt-1">
              Set or override the location for this message
            </p>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            {/* Input Mode Tabs */}
            <div className="flex gap-2">
              <button
                type="button"
                onClick={() => setInputMode('search')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'search'
                    ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400'
                    : 'bg-bg-secondary border border-border text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                🔍 Search Location
              </button>
              <button
                type="button"
                onClick={() => setInputMode('manual')}
                className={`flex-1 px-4 py-2 rounded-lg text-sm font-medium transition-colors ${
                  inputMode === 'manual'
                    ? 'bg-blue-500/20 border border-blue-500/50 text-blue-400'
                    : 'bg-bg-secondary border border-border text-text-secondary hover:bg-bg-tertiary'
                }`}
              >
                📍 Manual Coordinates
              </button>
            </div>

            {inputMode === 'search' && (
              <div className="relative">
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Search Location
                </label>
                <input
                  type="text"
                  value={searchQuery}
                  onChange={handleSearchChange}
                  onFocus={() => suggestions.length > 0 && setShowSuggestions(true)}
                  placeholder="Type a city or place name..."
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                {isSearching && (
                  <div className="absolute right-3 top-9 text-text-tertiary text-sm">
                    Searching...
                  </div>
                )}

                {/* Suggestions Dropdown */}
                {showSuggestions && suggestions.length > 0 && (
                  <div className="absolute z-10 w-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-60 overflow-y-auto">
                    {suggestions.map((suggestion) => (
                      <button
                        key={suggestion.geoname_id}
                        type="button"
                        onClick={() => handleSelectSuggestion(suggestion)}
                        className="w-full px-3 py-2 text-left hover:bg-bg-tertiary transition-colors first:rounded-t-lg last:rounded-b-lg"
                      >
                        <div className="font-medium text-text-primary">
                          {suggestion.name_en || suggestion.name}
                        </div>
                        <div className="text-xs text-text-secondary">
                          {suggestion.admin1_name && `${suggestion.admin1_name}, `}
                          {suggestion.country_code}
                          {suggestion.population > 0 && ` • Pop: ${suggestion.population.toLocaleString()}`}
                        </div>
                      </button>
                    ))}
                  </div>
                )}
              </div>
            )}

            {/* Coordinates */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Latitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={latitude}
                  onChange={(e) => setLatitude(e.target.value)}
                  placeholder="48.8566"
                  min="-90"
                  max="90"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-sm font-medium text-text-primary mb-1">
                  Longitude
                </label>
                <input
                  type="number"
                  step="any"
                  value={longitude}
                  onChange={(e) => setLongitude(e.target.value)}
                  placeholder="2.3522"
                  min="-180"
                  max="180"
                  className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>

            {/* Location Name */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Location Name (optional)
              </label>
              <input
                type="text"
                value={locationName}
                onChange={(e) => setLocationName(e.target.value)}
                placeholder="e.g., Kyiv, Ukraine"
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>

            {/* Reason */}
            <div>
              <label className="block text-sm font-medium text-text-primary mb-1">
                Reason (optional)
              </label>
              <textarea
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why are you setting this location?"
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
            </div>

            {/* Preview */}
            {isValid && (
              <div className="p-3 bg-green-500/10 border border-green-500/30 rounded-lg">
                <div className="text-sm text-green-400">
                  📍 Location Preview:
                  {locationName && <span className="font-medium"> {locationName}</span>}
                  <span className="text-green-400/70">
                    {' '}({parseFloat(latitude).toFixed(4)}, {parseFloat(longitude).toFixed(4)})
                  </span>
                </div>
              </div>
            )}
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-between items-center">
            <div>
              {hasExisting && onRemove && (
                <button
                  type="button"
                  onClick={onRemove}
                  disabled={loading}
                  className="px-4 py-2 bg-red-500/20 hover:bg-red-500/30 text-red-400 rounded-lg transition-colors"
                >
                  Remove Location
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
                disabled={loading || !isValid}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Location'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
