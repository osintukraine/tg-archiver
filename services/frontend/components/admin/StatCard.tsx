'use client';

import Link from 'next/link';

/**
 * StatCard Component
 *
 * Displays a metric with optional trend indicator, icon, and link.
 * Uses glass styling for consistent admin panel appearance.
 */

export interface StatCardProps {
  title: string;
  value: string | number;
  trend?: number; // Percentage change (e.g., +12, -5)
  icon?: React.ReactNode;
  subtitle?: string;
  loading?: boolean;
  href?: string; // Optional link
}

export function StatCard({
  title,
  value,
  trend,
  icon,
  subtitle,
  loading,
  href,
}: StatCardProps) {
  const content = (
    <>
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <p className="text-sm text-text-secondary mb-1">{title}</p>
          {loading ? (
            <div className="h-8 w-24 bg-bg-secondary animate-pulse rounded" />
          ) : (
            <p className="text-3xl font-semibold text-text-primary">{value}</p>
          )}
          {subtitle && (
            <p className="text-xs text-text-tertiary mt-1">{subtitle}</p>
          )}
        </div>
        {icon && (
          <div className="text-text-tertiary opacity-50">
            {icon}
          </div>
        )}
      </div>
      {trend !== undefined && !loading && (
        <div className="mt-4 flex items-center gap-1">
          <span className={trend >= 0 ? 'text-green-500' : 'text-red-500'}>
            {trend >= 0 ? '↑' : '↓'} {Math.abs(trend)}%
          </span>
          <span className="text-xs text-text-tertiary">vs last period</span>
        </div>
      )}
    </>
  );

  const baseClasses = 'glass p-6';
  const interactiveClasses = href ? 'hover:bg-bg-secondary/50 transition-colors cursor-pointer' : '';

  if (href) {
    return (
      <Link href={href} className={`${baseClasses} ${interactiveClasses} block`}>
        {content}
      </Link>
    );
  }

  return (
    <div className={baseClasses}>
      {content}
    </div>
  );
}
