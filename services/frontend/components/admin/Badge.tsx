'use client';

/**
 * Badge Component
 *
 * Status indicator badges with semantic variants.
 * Uses platform theme CSS variables for consistent styling.
 */

export interface BadgeProps {
  children: React.ReactNode;
  variant?: 'default' | 'success' | 'warning' | 'danger' | 'error' | 'info';
  size?: 'sm' | 'md';
  className?: string;
}

export function Badge({ children, variant = 'default', size = 'md', className = '' }: BadgeProps) {
  // Map 'error' to 'danger' for convenience
  const normalizedVariant = variant === 'error' ? 'danger' : variant;

  const variantClasses = {
    default: 'bg-bg-tertiary text-text-primary border-border-subtle',
    success: 'bg-green-500/10 text-green-600 dark:text-green-400 border-green-500/20',
    warning: 'bg-yellow-500/10 text-yellow-600 dark:text-yellow-400 border-yellow-500/20',
    danger: 'bg-red-500/10 text-red-600 dark:text-red-400 border-red-500/20',
    info: 'bg-blue-500/10 text-blue-600 dark:text-blue-400 border-blue-500/20',
  };

  const sizeClasses = {
    sm: 'text-xs px-2 py-0.5',
    md: 'text-sm px-2.5 py-1',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border font-medium ${variantClasses[normalizedVariant]} ${sizeClasses[size]} ${className}`}
    >
      {children}
    </span>
  );
}
