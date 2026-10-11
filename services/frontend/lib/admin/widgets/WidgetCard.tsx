// services/frontend-nextjs/lib/admin/widgets/WidgetCard.tsx
'use client';

import React from 'react';

/**
 * WidgetCard Component
 *
 * Wrapper component for dashboard widgets providing consistent styling.
 */

interface WidgetCardProps {
  title?: string;
  subtitle?: string;
  action?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
  noPadding?: boolean;
}

export function WidgetCard({
  title,
  subtitle,
  action,
  children,
  className = '',
  noPadding = false,
}: WidgetCardProps) {
  return (
    <div className={`glass ${className}`}>
      {(title || action) && (
        <div className={`flex items-center justify-between ${noPadding ? 'p-4 pb-0' : 'p-4 border-b border-border-subtle'}`}>
          <div>
            {title && (
              <h3 className="font-semibold text-text-primary">{title}</h3>
            )}
            {subtitle && (
              <p className="text-sm text-text-tertiary">{subtitle}</p>
            )}
          </div>
          {action && (
            <div>{action}</div>
          )}
        </div>
      )}
      <div className={noPadding ? '' : 'p-4'}>
        {children}
      </div>
    </div>
  );
}
