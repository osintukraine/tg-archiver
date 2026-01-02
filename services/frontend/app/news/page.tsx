'use client';

import { useState, useEffect, useCallback } from 'react';
import { formatDistanceToNow } from 'date-fns';
import { ExternalLink, Clock, User, Rss, RefreshCw } from 'lucide-react';

// Use relative URLs when behind proxy, or NEXT_PUBLIC_API_URL for direct access
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

interface RssArticle {
  id: number;
  feed_name: string;
  feed_category: string | null;
  trust_level: number | null;
  title: string;
  summary: string | null;
  content: string;
  author: string | null;
  published_at: string;
  url: string;
}

function ArticleCard({ article }: { article: RssArticle }) {
  // Use summary if available, otherwise truncate content
  const description = article.summary || article.content;
  const truncatedDescription = description.length > 300
    ? description.slice(0, 300) + '...'
    : description;

  // Strip HTML tags for display
  const cleanDescription = truncatedDescription.replace(/<[^>]*>/g, '');

  return (
    <article className="glass rounded-xl p-6 hover:border-primary/50 transition-all duration-200">
      <div className="flex items-start justify-between gap-4">
        <div className="flex-1 min-w-0">
          {/* Feed info */}
          <div className="flex items-center gap-2 text-sm text-text-tertiary mb-2">
            <Rss className="w-4 h-4" />
            <span className="font-medium text-primary">{article.feed_name}</span>
            {article.feed_category && (
              <>
                <span className="text-text-tertiary">•</span>
                <span>{article.feed_category}</span>
              </>
            )}
          </div>

          {/* Title */}
          <h2 className="text-lg font-semibold text-text-primary mb-2 line-clamp-2">
            <a
              href={article.url}
              target="_blank"
              rel="noopener noreferrer"
              className="hover:text-primary transition-colors"
            >
              {article.title}
            </a>
          </h2>

          {/* Description */}
          <p className="text-text-secondary text-sm mb-4 line-clamp-3">
            {cleanDescription}
          </p>

          {/* Meta info */}
          <div className="flex items-center gap-4 text-xs text-text-tertiary">
            <div className="flex items-center gap-1">
              <Clock className="w-3.5 h-3.5" />
              <span>{formatDistanceToNow(new Date(article.published_at), { addSuffix: true })}</span>
            </div>
            {article.author && (
              <div className="flex items-center gap-1">
                <User className="w-3.5 h-3.5" />
                <span>{article.author}</span>
              </div>
            )}
          </div>
        </div>

        {/* Read more link */}
        <a
          href={article.url}
          target="_blank"
          rel="noopener noreferrer"
          className="flex-shrink-0 p-2 rounded-lg bg-bg-secondary hover:bg-primary/10 text-text-secondary hover:text-primary transition-colors"
          title="Read full article"
        >
          <ExternalLink className="w-5 h-5" />
        </a>
      </div>
    </article>
  );
}

export default function NewsPage() {
  const [articles, setArticles] = useState<RssArticle[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [hours, setHours] = useState(24);

  const fetchArticles = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const response = await fetch(`${API_URL}/api/stream/rss?limit=50&hours=${hours}`);
      if (!response.ok) {
        throw new Error(`Failed to fetch articles: ${response.status}`);
      }
      const data = await response.json();
      setArticles(data);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to load articles');
    } finally {
      setLoading(false);
    }
  }, [hours]);

  useEffect(() => {
    fetchArticles();
  }, [fetchArticles]);

  return (
    <div className="container mx-auto px-4 py-8 max-w-4xl">
      {/* Header */}
      <div className="flex items-center justify-between mb-8">
        <div>
          <h1 className="text-3xl font-bold text-text-primary flex items-center gap-3">
            <Rss className="w-8 h-8 text-primary" />
            News Feed
          </h1>
          <p className="text-text-secondary mt-1">
            Latest articles from subscribed RSS feeds
          </p>
        </div>

        <div className="flex items-center gap-3">
          {/* Time range selector */}
          <select
            value={hours}
            onChange={(e) => setHours(Number(e.target.value))}
            className="bg-bg-secondary border border-border rounded-lg px-3 py-2 text-sm text-text-primary focus:outline-none focus:ring-2 focus:ring-primary"
          >
            <option value={6}>Last 6 hours</option>
            <option value={12}>Last 12 hours</option>
            <option value={24}>Last 24 hours</option>
            <option value={48}>Last 2 days</option>
            <option value={72}>Last 3 days</option>
            <option value={168}>Last week</option>
          </select>

          {/* Refresh button */}
          <button
            onClick={fetchArticles}
            disabled={loading}
            className="p-2 rounded-lg bg-bg-secondary hover:bg-bg-tertiary text-text-secondary hover:text-primary transition-colors disabled:opacity-50"
            title="Refresh"
          >
            <RefreshCw className={`w-5 h-5 ${loading ? 'animate-spin' : ''}`} />
          </button>
        </div>
      </div>

      {/* Error state */}
      {error && (
        <div className="glass p-4 rounded-xl text-red-400 mb-6">
          <p className="font-medium">Error loading articles</p>
          <p className="text-sm text-red-400/70">{error}</p>
        </div>
      )}

      {/* Loading state */}
      {loading && articles.length === 0 && (
        <div className="space-y-4">
          {[...Array(5)].map((_, i) => (
            <div key={i} className="glass rounded-xl p-6 animate-pulse">
              <div className="h-4 bg-bg-tertiary rounded w-1/4 mb-3" />
              <div className="h-6 bg-bg-tertiary rounded w-3/4 mb-2" />
              <div className="h-4 bg-bg-tertiary rounded w-full mb-2" />
              <div className="h-4 bg-bg-tertiary rounded w-2/3" />
            </div>
          ))}
        </div>
      )}

      {/* Empty state */}
      {!loading && articles.length === 0 && !error && (
        <div className="glass rounded-xl p-12 text-center">
          <Rss className="w-12 h-12 text-text-tertiary mx-auto mb-4" />
          <h3 className="text-lg font-medium text-text-primary mb-2">No articles found</h3>
          <p className="text-text-secondary">
            No RSS articles have been ingested in the selected time period.
          </p>
        </div>
      )}

      {/* Articles list */}
      {articles.length > 0 && (
        <div className="space-y-4">
          {articles.map((article) => (
            <ArticleCard key={article.id} article={article} />
          ))}
        </div>
      )}

      {/* Footer info */}
      {articles.length > 0 && (
        <div className="mt-8 text-center text-text-tertiary text-sm">
          Showing {articles.length} articles from the last {hours} hours
        </div>
      )}
    </div>
  );
}
