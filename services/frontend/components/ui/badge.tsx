import * as React from 'react';

interface BadgeProps extends React.HTMLAttributes<HTMLSpanElement> {
  variant?: 'default' | 'secondary' | 'outline' | 'destructive';
}

export function Badge({ className, variant = 'default', ...props }: BadgeProps) {
  const variantStyles = {
    default: 'bg-accent-primary text-white border-transparent',
    secondary: 'bg-bg-tertiary text-text-primary border-transparent',
    outline: 'border-border-subtle text-text-primary bg-transparent',
    destructive: 'bg-accent-danger text-white border-transparent',
  };

  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-semibold transition-colors ${variantStyles[variant]} ${className || ''}`}
      {...props}
    />
  );
}
