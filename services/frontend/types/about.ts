// services/frontend/types/about.ts

// Activity Data Types (for /api/about/activity)

export type ActivityStatus = 'active' | 'slow' | 'idle';
export type VolumeTimeframe = '24h' | '7d' | '30d';
export type TopicsTimeframe = '24h' | '7d';
export type VolumeGranularity = 'hour' | 'day';

export interface PulseData {
  messages_last_hour: number;
  messages_today: number;
  channels_active_24h: number;
  status: ActivityStatus;
}

export interface VolumeBucket {
  timestamp: string;
  count: number;
}

export interface VolumeData {
  granularity: VolumeGranularity;
  timeframe: VolumeTimeframe;
  buckets: VolumeBucket[];
  peak: VolumeBucket | null;
  average: number;
  total: number;
}

export interface TopicItem {
  topic: string;
  count: number;
  percent: number;
}

export interface TopicsData {
  timeframe: TopicsTimeframe;
  items: TopicItem[];
  total: number;
}

export interface ChannelActivityItem {
  id: number;
  name: string;
  username: string | null;
  count: number;
}

export interface ChannelsActivityData {
  timeframe: '24h';
  items: ChannelActivityItem[];
  total_active: number;
}

export interface ActivityData {
  pulse: PulseData;
  volume: VolumeData;
  topics: TopicsData;
  channels: ChannelsActivityData;
  timestamp: string;
}
