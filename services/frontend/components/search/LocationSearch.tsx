'use client';

import { useState, useEffect, useRef } from 'react';
import { API_URL } from '../../lib/api';

interface LocationSuggestion {
  name: string;
  name_local: string | null;
  country_code: string;
  latitude: number;
  longitude: number;
  population: number | null;
}

interface LocationSearchProps {
  onLocationSelect: (location: {
    name: string;
    lat: number;
    lng: number;
    radius_km: number;
  } | null) => void;
  initialLocation?: string;
  initialRadius?: number;
}

const RADIUS_OPTIONS = [
  { value: 10, label: '10 km' },
  { value: 25, label: '25 km' },
  { value: 50, label: '50 km' },
  { value: 100, label: '100 km' },
];

export default function LocationSearch({
  onLocationSelect,
  initialLocation = '',
  initialRadius = 25,
}: LocationSearchProps) {
  const [input, setInput] = useState(initialLocation);
  const [suggestions, setSuggestions] = useState<LocationSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const [selectedLocation, setSelectedLocation] = useState<LocationSuggestion | null>(null);
  const [radius, setRadius] = useState(initialRadius);
  const [loading, setLoading] = useState(false);
  const debounceTimer = useRef<NodeJS.Timeout | null>(null);
  const wrapperRef = useRef<HTMLDivElement>(null);

  // Close dropdown when clicking outside
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target as Node)) {
        setShowSuggestions(false);
      }
    };

    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Debounced API call for location suggestions
  useEffect(() => {
    if (debounceTimer.current) {
      clearTimeout(debounceTimer.current);
    }

    if (input.trim().length < 2) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }

    debounceTimer.current = setTimeout(async () => {
      setLoading(true);
      try {
        const params = new URLSearchParams({ q: input.trim(), limit: '10' });
        const res = await fetch(`${API_URL}/api/map/locations/suggest?${params}`);

        if (!res.ok) {
          throw new Error('Failed to fetch location suggestions');
        }

        const data: LocationSuggestion[] = await res.json();
        setSuggestions(data);
        setShowSuggestions(data.length > 0);
      } catch (error) {
        console.error('Error fetching location suggestions:', error);
        setSuggestions([]);
      } finally {
        setLoading(false);
      }
    }, 300);

    return () => {
      if (debounceTimer.current) {
        clearTimeout(debounceTimer.current);
      }
    };
  }, [input]);

  const handleInputChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const value = e.target.value;
    setInput(value);

    // Clear selected location if user modifies input
    if (selectedLocation && value !== selectedLocation.name) {
      setSelectedLocation(null);
      onLocationSelect(null);
    }
  };

  const handleSelectSuggestion = (suggestion: LocationSuggestion) => {
    setInput(suggestion.name);
    setSelectedLocation(suggestion);
    setShowSuggestions(false);

    // Emit selection to parent
    onLocationSelect({
      name: suggestion.name,
      lat: suggestion.latitude,
      lng: suggestion.longitude,
      radius_km: radius,
    });
  };

  const handleRadiusChange = (newRadius: number) => {
    setRadius(newRadius);

    // If location is already selected, emit updated radius
    if (selectedLocation) {
      onLocationSelect({
        name: selectedLocation.name,
        lat: selectedLocation.latitude,
        lng: selectedLocation.longitude,
        radius_km: newRadius,
      });
    }
  };

  const handleClear = () => {
    setInput('');
    setSelectedLocation(null);
    setSuggestions([]);
    setShowSuggestions(false);
    onLocationSelect(null);
  };

  return (
    <div ref={wrapperRef} className="relative">
      <div className="flex flex-col gap-2">
        {/* Location Input */}
        <div className="relative">
          <input
            type="text"
            value={input}
            onChange={handleInputChange}
            placeholder="Search location (e.g., Kyiv, Bakhmut)..."
            className="w-full bg-bg-secondary border border-border rounded-lg px-4 py-2 pr-10 text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-accent-primary"
          />

          {/* Loading indicator */}
          {loading && (
            <div className="absolute right-10 top-1/2 -translate-y-1/2">
              <div className="animate-spin h-4 w-4 border-2 border-accent-primary border-t-transparent rounded-full"></div>
            </div>
          )}

          {/* Clear button */}
          {input && (
            <button
              onClick={handleClear}
              className="absolute right-3 top-1/2 -translate-y-1/2 text-text-tertiary hover:text-text-primary"
              title="Clear location"
            >
              ✕
            </button>
          )}

          {/* Suggestions Dropdown */}
          {showSuggestions && suggestions.length > 0 && (
            <div className="absolute z-50 w-full mt-1 bg-bg-secondary border border-border rounded-lg shadow-lg max-h-64 overflow-y-auto">
              {suggestions.map((suggestion, index) => (
                <button
                  key={index}
                  onClick={() => handleSelectSuggestion(suggestion)}
                  className="w-full text-left px-4 py-2 hover:bg-bg-tertiary transition-colors border-b border-border last:border-b-0"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="font-medium text-text-primary truncate">
                        {suggestion.name}
                      </div>
                      {suggestion.name_local && suggestion.name_local !== suggestion.name && (
                        <div className="text-sm text-text-secondary truncate">
                          {suggestion.name_local}
                        </div>
                      )}
                    </div>
                    <div className="flex items-center gap-2 ml-2 flex-shrink-0">
                      <span className="text-xs text-text-tertiary uppercase">
                        {suggestion.country_code}
                      </span>
                      {suggestion.population && (
                        <span className="text-xs text-text-tertiary">
                          {suggestion.population.toLocaleString()}
                        </span>
                      )}
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}
        </div>

        {/* Radius Selector */}
        {selectedLocation && (
          <div className="flex items-center gap-2">
            <span className="text-sm text-text-tertiary whitespace-nowrap">Radius:</span>
            <div className="flex gap-1">
              {RADIUS_OPTIONS.map((option) => (
                <button
                  key={option.value}
                  onClick={() => handleRadiusChange(option.value)}
                  className={`px-3 py-1 text-xs rounded transition-colors ${
                    radius === option.value
                      ? 'bg-accent-primary text-white'
                      : 'bg-bg-tertiary text-text-secondary hover:bg-bg-secondary'
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Selected Location Display */}
        {selectedLocation && (
          <div className="text-xs text-text-secondary flex items-center gap-2">
            <span className="inline-flex items-center gap-1">
              📍 {selectedLocation.name}
            </span>
            <span className="text-text-tertiary">
              ({selectedLocation.latitude.toFixed(4)}, {selectedLocation.longitude.toFixed(4)})
            </span>
          </div>
        )}
      </div>
    </div>
  );
}
