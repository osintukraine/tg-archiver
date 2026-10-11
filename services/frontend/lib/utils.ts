/**
 * Utility functions for Telegram Archiver
 */

/**
 * Format large numbers with K/M suffixes
 * @param num - Number to format
 * @returns Formatted string (e.g., "12.4K", "1.2M")
 */
export function formatNumber(num: number): string {
  if (num >= 1000000) {
    return `${(num / 1000000).toFixed(1)}M`;
  }
  if (num >= 1000) {
    return `${(num / 1000).toFixed(1)}K`;
  }
  return num.toString();
}

/**
 * Calculate virality ratio (forwards/views percentage)
 * @param forwards - Number of forwards
 * @param views - Number of views
 * @returns Virality percentage (0-100+)
 */
export function calculateViralityRatio(forwards: number, views: number): number {
  if (views === 0) return 0;
  return (forwards / views) * 100;
}

/**
 * Get color class for virality ratio
 * @param ratio - Virality ratio percentage
 * @returns Tailwind color class
 */
export function getViralityColor(ratio: number): string {
  if (ratio > 5) return 'text-red-400'; // Viral (top 1%)
  if (ratio > 1) return 'text-yellow-400'; // Elevated
  return 'text-text-tertiary'; // Normal
}

/**
 * Get color class for urgency level
 * @param urgency - Urgency level (0-100)
 * @returns Tailwind background color class
 */
export function getUrgencyColor(urgency: number): string {
  if (urgency >= 80) return 'bg-red-500';
  if (urgency >= 60) return 'bg-orange-500';
  if (urgency >= 40) return 'bg-yellow-500';
  return 'bg-green-500';
}

/**
 * Get text color class for urgency level
 * @param urgency - Urgency level (0-100)
 * @returns Tailwind text color class
 */
export function getUrgencyTextColor(urgency: number): string {
  if (urgency >= 80) return 'text-red-400';
  if (urgency >= 50) return 'text-yellow-400';
  return 'text-green-400';
}
