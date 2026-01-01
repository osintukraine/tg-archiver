import * as React from 'react';

interface ButtonProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'outline' | 'ghost' | 'destructive';
  size?: 'default' | 'sm' | 'lg' | 'icon';
}

export function Button({ className, variant = 'default', size = 'default', ...props }: ButtonProps) {
  const variantStyles = {
    default: 'bg-accent-primary text-white hover:bg-accent-primary/90',
    outline: 'border border-border-subtle bg-transparent hover:bg-bg-secondary',
    ghost: 'hover:bg-bg-secondary',
    destructive: 'bg-accent-danger text-white hover:bg-accent-danger/90',
  };

  const sizeStyles = {
    default: 'h-10 px-4 py-2',
    sm: 'h-8 px-3 text-sm',
    lg: 'h-12 px-8',
    icon: 'h-10 w-10',
  };

  return (
    <button
      className={`inline-flex items-center justify-center rounded-md text-sm font-medium transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:pointer-events-none disabled:opacity-50 ${variantStyles[variant]} ${sizeStyles[size]} ${className || ''}`}
      {...props}
    />
  );
}
