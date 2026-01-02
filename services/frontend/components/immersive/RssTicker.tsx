'use client';

import { useEffect, useState, useRef } from 'react';

interface RssItem {
  id: number;
  title: string;
  feed_name: string;
  published_at: string;
  url: string;
}

interface RssTickerProps {
  enabled: boolean;
}

export function RssTicker({ enabled }: RssTickerProps) {
  const [rssItems, setRssItems] = useState<RssItem[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const hasFetched = useRef(false);

  // Fetch latest RSS news
  useEffect(() => {
    if (!enabled) {
      return;
    }

    // Only fetch once when enabled
    if (hasFetched.current && rssItems.length > 0) {
      return;
    }

    const fetchRssNews = async () => {
      setIsLoading(true);
      try {
        const API_URL = process.env.NEXT_PUBLIC_API_URL || '';
        const response = await fetch(
          `${API_URL}/api/stream/rss?limit=15&hours=24`
        );
        if (response.ok) {
          const data = await response.json();
          const items: RssItem[] = data.map((item: {
            id: number;
            title: string;
            feed_name: string;
            published_at: string;
            url: string;
          }) => ({
            id: item.id,
            title: item.title,
            feed_name: item.feed_name,
            published_at: item.published_at,
            url: item.url,
          }));
          setRssItems(items);
          hasFetched.current = true;
        }
      } catch (error) {
        console.error('Failed to fetch RSS news:', error);
      } finally {
        setIsLoading(false);
      }
    };

    fetchRssNews();

    // Refresh every 5 minutes
    const interval = setInterval(() => {
      hasFetched.current = false;
      fetchRssNews();
    }, 5 * 60 * 1000);

    return () => clearInterval(interval);
  }, [enabled, rssItems.length]);

  // Reset fetch flag when disabled
  useEffect(() => {
    if (!enabled) {
      hasFetched.current = false;
    }
  }, [enabled]);

  // Don't render if disabled or no items
  if (!enabled || (rssItems.length === 0 && !isLoading)) {
    return null;
  }

  return (
    <div className="absolute top-16 left-0 right-0 z-20 overflow-hidden">
      <div className="bg-black/70 backdrop-blur-sm py-2 px-4">
        {isLoading && rssItems.length === 0 ? (
          <div className="flex items-center justify-center gap-2 text-white/60 text-sm">
            <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
            <span>Loading RSS news...</span>
          </div>
        ) : (
          <div className="flex items-center gap-4">
            {/* RSS indicator */}
            <div className="flex-shrink-0 flex items-center gap-2 text-cyan-400 text-sm font-medium">
              <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 20 20">
                <path d="M5 3a1 1 0 000 2c5.523 0 10 4.477 10 10a1 1 0 102 0C17 8.373 11.627 3 5 3z" />
                <path d="M4 9a1 1 0 011-1 7 7 0 017 7 1 1 0 11-2 0 5 5 0 00-5-5 1 1 0 01-1-1z" />
                <path d="M3 15a2 2 0 114 0 2 2 0 01-4 0z" />
              </svg>
              <span>RSS News</span>
            </div>

            {/* Scrolling ticker */}
            <div className="flex-1 overflow-hidden">
              <div className="flex gap-8 animate-scroll-x whitespace-nowrap">
                {rssItems.map((item) => (
                  <a
                    key={item.id}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-2 text-white/80 hover:text-white text-sm transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white/50">{item.feed_name}:</span>
                    <span className="max-w-sm truncate">{item.title}</span>
                  </a>
                ))}
                {/* Duplicate for seamless loop */}
                {rssItems.map((item) => (
                  <a
                    key={`dup-${item.id}`}
                    href={item.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex-shrink-0 flex items-center gap-2 text-white/80 hover:text-white text-sm transition-colors"
                    onClick={(e) => e.stopPropagation()}
                  >
                    <span className="text-white/50">{item.feed_name}:</span>
                    <span className="max-w-sm truncate">{item.title}</span>
                  </a>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
