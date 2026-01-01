'use client';

import React from 'react';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { TrendingUp, Loader2, AlertCircle } from 'lucide-react';
import { useEngagementTimeline } from '@/hooks/useSocialGraph';
import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
  ResponsiveContainer,
} from 'recharts';

interface EngagementChartProps {
  messageId: number;
}

export function EngagementChart({ messageId }: EngagementChartProps) {
  const { data, isLoading, error } = useEngagementTimeline(messageId, {
    granularity: 'hour',
    time_range_hours: 168, // 7 days
  });

  if (isLoading) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Engagement Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="flex items-center justify-center py-12">
            <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            <span className="ml-2 text-sm text-muted-foreground">Loading engagement data...</span>
          </div>
        </CardContent>
      </Card>
    );
  }

  if (error) {
    return (
      <Card className="dark:border-gray-700">
        <CardHeader className="pb-3 dark:border-gray-700">
          <CardTitle className="text-sm font-medium flex items-center gap-2">
            <TrendingUp className="h-4 w-4" />
            Engagement Timeline
          </CardTitle>
        </CardHeader>
        <CardContent>
          <div className="text-center py-12">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive mb-2" />
            <p className="text-sm text-muted-foreground">Failed to load engagement timeline</p>
          </div>
        </CardContent>
      </Card>
    );
  }

  const dataPoints = data?.data_points || [];
  const hasData = dataPoints.length > 0;
  const currentSnapshot = data?.current_snapshot;

  return (
    <Card className="dark:border-gray-700">
      <CardHeader className="pb-3 dark:border-gray-700">
        <CardTitle className="text-sm font-medium flex items-center gap-2">
          <TrendingUp className="h-4 w-4" />
          Engagement Timeline
        </CardTitle>
      </CardHeader>
      <CardContent>
        {!hasData ? (
          <div className="space-y-4">
            {/* Current snapshot (always available) */}
            {currentSnapshot && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Views</p>
                  <p className="text-2xl font-bold">{currentSnapshot.views?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Forwards</p>
                  <p className="text-2xl font-bold">{currentSnapshot.forwards?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-2xl font-bold">{currentSnapshot.comments_count?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Status</p>
                  <p className="text-sm font-medium text-muted-foreground">Current</p>
                </div>
              </div>
            )}

            <div className="text-center py-8 space-y-4">
              <AlertCircle className="h-12 w-12 mx-auto text-muted-foreground/20 mb-3" />
              <div>
                <p className="text-sm font-medium text-muted-foreground mb-2">
                  No Timeline Data Yet
                </p>
                <p className="text-xs text-muted-foreground max-w-md mx-auto">
                  Engagement tracking starts when the message is first archived. Historical snapshots will appear here as they are collected.
                </p>
              </div>
              <div className="bg-muted/50 dark:bg-muted/20 rounded-lg p-4 max-w-md mx-auto text-left">
                <p className="text-xs font-medium mb-2">About Engagement Tracking:</p>
                <ul className="text-xs text-muted-foreground space-y-1 list-disc list-inside">
                  <li>Views and forwards are tracked hourly</li>
                  <li>Charts show virality and decay patterns</li>
                  <li>Data is retained for analysis</li>
                </ul>
              </div>
            </div>
          </div>
        ) : (
          <div className="space-y-4">
            {/* Current snapshot */}
            {currentSnapshot && (
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4 p-4 bg-muted/50 dark:bg-muted/20 rounded-lg">
                <div>
                  <p className="text-xs text-muted-foreground">Views</p>
                  <p className="text-2xl font-bold">{currentSnapshot.views?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Forwards</p>
                  <p className="text-2xl font-bold">{currentSnapshot.forwards?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Comments</p>
                  <p className="text-2xl font-bold">{currentSnapshot.comments_count?.toLocaleString() || 0}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Data Points</p>
                  <p className="text-2xl font-bold">{dataPoints.length}</p>
                </div>
              </div>
            )}

            {/* Timeline chart with Recharts */}
            <div className="space-y-4">
              <div>
                <h4 className="text-sm font-medium mb-3">Views & Forwards Over Time</h4>
                <ResponsiveContainer width="100%" height={300}>
                  <LineChart
                    data={dataPoints}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        });
                      }}
                      className="text-xs"
                    />
                    <YAxis className="text-xs" />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.5rem',
                      }}
                      labelFormatter={(value) => new Date(value).toLocaleString()}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="views"
                      stroke="hsl(var(--primary))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Views"
                    />
                    <Line
                      type="monotone"
                      dataKey="forwards"
                      stroke="hsl(var(--chart-2))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Forwards"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>

              <div>
                <h4 className="text-sm font-medium mb-3">Engagement Rate</h4>
                <ResponsiveContainer width="100%" height={200}>
                  <LineChart
                    data={dataPoints}
                    margin={{ top: 5, right: 30, left: 20, bottom: 5 }}
                  >
                    <CartesianGrid strokeDasharray="3 3" className="stroke-muted" />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => {
                        const date = new Date(value);
                        return date.toLocaleDateString('en-US', {
                          month: 'short',
                          day: 'numeric',
                        });
                      }}
                      className="text-xs"
                    />
                    <YAxis className="text-xs" tickFormatter={(value) => `${value}%`} />
                    <Tooltip
                      contentStyle={{
                        backgroundColor: 'hsl(var(--background))',
                        border: '1px solid hsl(var(--border))',
                        borderRadius: '0.5rem',
                      }}
                      labelFormatter={(value) => new Date(value).toLocaleString()}
                      formatter={(value: any) => `${value}%`}
                    />
                    <Legend />
                    <Line
                      type="monotone"
                      dataKey="engagement_rate"
                      stroke="hsl(var(--chart-3))"
                      strokeWidth={2}
                      dot={{ r: 3 }}
                      name="Engagement %"
                    />
                  </LineChart>
                </ResponsiveContainer>
              </div>
            </div>
          </div>
        )}
      </CardContent>
    </Card>
  );
}
