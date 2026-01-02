// services/frontend-nextjs/components/about/tabs/ActivityTab.tsx

'use client';

import { useState } from 'react';
import Link from 'next/link';
import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from 'recharts';
import {
  Activity,
  TrendingUp,
  Radio,
  Hash,
  ChevronRight,
  Loader2,
  Zap,
} from 'lucide-react';
import { useActivityData } from '@/hooks/useActivityData';
import {
  VolumeTimeframe,
  TopicsTimeframe,
  TopicItem,
  ChannelActivityItem,
} from '@/types/about';

// Topic colors for consistent styling
const TOPIC_COLORS: Record<string, string> = {
  news: 'bg-red-500',
  announcement: 'bg-green-500',
  discussion: 'bg-cyan-500',
  media: 'bg-blue-500',
  important: 'bg-purple-500',
  archive: 'bg-indigo-500',
  offtopic: 'bg-pink-500',
  other: 'bg-gray-500',
  unknown: 'bg-gray-400',
};

// Human-readable topic labels
const TOPIC_LABELS: Record<string, string> = {
  news: 'News',
  announcement: 'Announcement',
  discussion: 'Discussion',
  media: 'Media',
  important: 'Important',
  archive: 'Archive',
  offtopic: 'Off-Topic',
  other: 'Other',
  unknown: 'Unclassified',
};

function TimeframeToggle<T extends string>({
  options,
  value,
  onChange,
  labels,
}: {
  options: T[];
  value: T;
  onChange: (v: T) => void;
  labels: Record<T, string>;
}) {
  return (
    <div className="flex rounded-lg bg-gray-100 dark:bg-gray-800 p-1">
      {options.map((opt) => (
        <button
          key={opt}
          onClick={() => onChange(opt)}
          className={`px-3 py-1 text-sm rounded-md transition-colors ${
            value === opt
              ? 'bg-white dark:bg-gray-700 text-gray-900 dark:text-gray-100 shadow-sm'
              : 'text-gray-600 dark:text-gray-400 hover:text-gray-900 dark:hover:text-gray-200'
          }`}
        >
          {labels[opt]}
        </button>
      ))}
    </div>
  );
}

function TopicBar({ item, maxCount }: { item: TopicItem; maxCount: number }) {
  const width = maxCount > 0 ? (item.count / maxCount) * 100 : 0;
  const color = TOPIC_COLORS[item.topic] || 'bg-gray-500';
  const label = TOPIC_LABELS[item.topic] || item.topic;

  return (
    <Link
      href={`/search?topic=${encodeURIComponent(item.topic)}`}
      className="group flex items-center gap-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg px-2 -mx-2 transition-colors"
    >
      <div className="w-28 flex-shrink-0 text-sm text-gray-700 dark:text-gray-300 truncate">
        {label}
      </div>
      <div className="flex-1 h-6 bg-gray-100 dark:bg-gray-800 rounded-full overflow-hidden">
        <div
          className={`h-full ${color} rounded-full transition-all duration-500`}
          style={{ width: `${width}%` }}
        />
      </div>
      <div className="w-20 text-right text-sm">
        <span className="text-gray-900 dark:text-gray-100 font-medium">
          {item.count.toLocaleString()}
        </span>
        <span className="text-gray-500 dark:text-gray-500 ml-1">
          ({item.percent}%)
        </span>
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

function ChannelRow({ item, rank }: { item: ChannelActivityItem; rank: number }) {
  return (
    <Link
      href={`/search?channel_id=${item.id}`}
      className="group flex items-center gap-3 py-2 hover:bg-gray-50 dark:hover:bg-gray-800/50 rounded-lg px-2 -mx-2 transition-colors"
    >
      <div className="w-6 text-center text-sm font-medium text-gray-500 dark:text-gray-500">
        {rank}
      </div>
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium text-gray-900 dark:text-gray-100 truncate">
          {item.name}
        </div>
        {item.username && (
          <div className="text-xs text-gray-500 dark:text-gray-500 truncate">
            @{item.username}
          </div>
        )}
      </div>
      <div className="text-sm text-gray-600 dark:text-gray-400">
        {item.count.toLocaleString()} messages
      </div>
      <ChevronRight className="w-4 h-4 text-gray-400 opacity-0 group-hover:opacity-100 transition-opacity" />
    </Link>
  );
}

export default function ActivityTab() {
  const [volumeTimeframe, setVolumeTimeframe] = useState<VolumeTimeframe>('24h');
  const [topicsTimeframe, setTopicsTimeframe] = useState<TopicsTimeframe>('24h');

  const { pulse, volume, topics, channels, isLoading, isFetching } = useActivityData({
    volumeTimeframe,
    topicsTimeframe,
  });

  // Format X-axis labels based on granularity
  const formatXAxis = (timestamp: string) => {
    const date = new Date(timestamp);
    if (volume.granularity === 'hour') {
      return date.toLocaleTimeString('en-US', { hour: 'numeric', hour12: true });
    }
    return date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
  };

  // Format tooltip
  const formatTooltip = (value: number, _name: string, props: { payload?: { timestamp?: string } }) => {
    const timestamp = props.payload?.timestamp;
    if (!timestamp) return [value.toLocaleString(), 'Messages'];

    const date = new Date(timestamp);
    const dateStr = volume.granularity === 'hour'
      ? date.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
      : date.toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric' });

    return [`${value.toLocaleString()} messages`, dateStr];
  };

  // Calculate max topic count for bar scaling
  const maxTopicCount = Math.max(...topics.items.map((t) => t.count), 1);

  if (isLoading) {
    return (
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-16">
        <div className="flex flex-col items-center justify-center">
          <Loader2 className="w-8 h-8 animate-spin text-gray-400" />
          <p className="mt-4 text-gray-600 dark:text-gray-400">Loading activity data...</p>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-8">
      {/* Header with live indicator */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <Activity className="w-6 h-6" />
            Platform Activity
          </h1>
          <p className="text-gray-600 dark:text-gray-400 mt-1">
            Real-time monitoring and analytics
          </p>
        </div>
        <div className="flex items-center gap-2 text-sm">
          {isFetching && (
            <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
          )}
          <div className={`flex items-center gap-1.5 px-3 py-1.5 rounded-full ${
            pulse.status === 'active'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : pulse.status === 'slow'
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
          }`}>
            <span className={`w-2 h-2 rounded-full ${
              pulse.status === 'active' ? 'bg-green-500 animate-pulse' :
              pulse.status === 'slow' ? 'bg-yellow-500' : 'bg-gray-400'
            }`} />
            {pulse.status === 'active' ? 'Live' : pulse.status === 'slow' ? 'Slow' : 'Idle'}
          </div>
        </div>
      </div>

      {/* Quick Stats */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm mb-1">
            <Zap className="w-4 h-4" />
            Messages This Hour
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {pulse.messages_last_hour.toLocaleString()}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm mb-1">
            <TrendingUp className="w-4 h-4" />
            Messages Today
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {pulse.messages_today.toLocaleString()}
          </div>
        </div>
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <div className="flex items-center gap-2 text-gray-600 dark:text-gray-400 text-sm mb-1">
            <Radio className="w-4 h-4" />
            Active Channels (24h)
          </div>
          <div className="text-3xl font-bold text-gray-900 dark:text-gray-100">
            {pulse.channels_active_24h.toLocaleString()}
          </div>
        </div>
      </div>

      {/* Volume Chart */}
      <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
        <div className="flex items-center justify-between mb-6">
          <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
            <TrendingUp className="w-5 h-5" />
            Message Volume
          </h2>
          <TimeframeToggle
            options={['24h', '7d', '30d'] as VolumeTimeframe[]}
            value={volumeTimeframe}
            onChange={setVolumeTimeframe}
            labels={{ '24h': '24h', '7d': '7 days', '30d': '30 days' }}
          />
        </div>

        {volume.buckets.length > 0 ? (
          <>
            <ResponsiveContainer width="100%" height={300}>
              <BarChart
                data={volume.buckets}
                margin={{ top: 5, right: 20, left: 10, bottom: 5 }}
              >
                <CartesianGrid strokeDasharray="3 3" className="stroke-gray-200 dark:stroke-gray-700" />
                <XAxis
                  dataKey="timestamp"
                  tickFormatter={formatXAxis}
                  tick={{ fontSize: 12 }}
                  className="text-gray-600 dark:text-gray-400"
                />
                <YAxis
                  tick={{ fontSize: 12 }}
                  className="text-gray-600 dark:text-gray-400"
                />
                <Tooltip
                  formatter={formatTooltip}
                  contentStyle={{
                    backgroundColor: 'hsl(var(--background))',
                    border: '1px solid hsl(var(--border))',
                    borderRadius: '0.5rem',
                  }}
                  cursor={{ fill: 'hsl(var(--muted))' }}
                />
                <Bar
                  dataKey="count"
                  fill="hsl(var(--primary))"
                  radius={[4, 4, 0, 0]}
                />
              </BarChart>
            </ResponsiveContainer>

            {/* Volume Stats */}
            <div className="flex items-center justify-center gap-6 mt-4 text-sm text-gray-600 dark:text-gray-400">
              {volume.peak && (
                <span>
                  <span className="font-medium text-gray-900 dark:text-gray-100">Peak:</span>{' '}
                  {volume.peak.count.toLocaleString()}/{volume.granularity}
                </span>
              )}
              <span>
                <span className="font-medium text-gray-900 dark:text-gray-100">Avg:</span>{' '}
                {Math.round(volume.average).toLocaleString()}/{volume.granularity}
              </span>
              <span>
                <span className="font-medium text-gray-900 dark:text-gray-100">Total:</span>{' '}
                {volume.total.toLocaleString()}
              </span>
            </div>
          </>
        ) : (
          <div className="flex flex-col items-center justify-center py-16 text-gray-500 dark:text-gray-500">
            <TrendingUp className="w-12 h-12 mb-4 opacity-30" />
            <p>No volume data available for this timeframe</p>
          </div>
        )}
      </div>

      {/* Topics and Channels Row */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
        {/* Topic Distribution */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Hash className="w-5 h-5" />
              Topics
            </h2>
            <TimeframeToggle
              options={['24h', '7d'] as TopicsTimeframe[]}
              value={topicsTimeframe}
              onChange={setTopicsTimeframe}
              labels={{ '24h': '24h', '7d': '7 days' }}
            />
          </div>

          {topics.items.length > 0 ? (
            <div className="space-y-1">
              {topics.items.map((item) => (
                <TopicBar key={item.topic} item={item} maxCount={maxTopicCount} />
              ))}
              <p className="text-xs text-gray-500 dark:text-gray-500 text-center mt-4">
                Click a topic to search messages
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-500">
              <Hash className="w-10 h-10 mb-3 opacity-30" />
              <p>No topic data available</p>
            </div>
          )}
        </div>

        {/* Most Active Channels */}
        <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-gray-900 dark:text-gray-100 flex items-center gap-2">
              <Radio className="w-5 h-5" />
              Most Active Channels
            </h2>
            <span className="text-sm text-gray-500 dark:text-gray-500">Last 24h</span>
          </div>

          {channels.items.length > 0 ? (
            <div className="space-y-1">
              {channels.items.map((item, index) => (
                <ChannelRow key={item.id} item={item} rank={index + 1} />
              ))}
              {channels.total_active > 5 && (
                <div className="text-center pt-4">
                  <span className="text-sm text-gray-500 dark:text-gray-500">
                    +{channels.total_active - 5} more channels active
                  </span>
                </div>
              )}
              <p className="text-xs text-gray-500 dark:text-gray-500 text-center mt-4">
                Click a channel to search messages
              </p>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center py-12 text-gray-500 dark:text-gray-500">
              <Radio className="w-10 h-10 mb-3 opacity-30" />
              <p>No channel activity data available</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
