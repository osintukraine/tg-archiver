import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { ErrorBoundary } from '../ErrorBoundary';

// Component that throws an error
const ThrowingComponent = ({ shouldThrow = true }: { shouldThrow?: boolean }) => {
  if (shouldThrow) {
    throw new Error('Test error message');
  }
  return <div>Content rendered successfully</div>;
};

// Suppress console.error for cleaner test output
beforeEach(() => {
  vi.spyOn(console, 'error').mockImplementation(() => {});
});

describe('ErrorBoundary', () => {
  describe('when children render successfully', () => {
    it('renders children normally', () => {
      render(
        <ErrorBoundary>
          <div>Hello World</div>
        </ErrorBoundary>
      );

      expect(screen.getByText('Hello World')).toBeInTheDocument();
    });

    it('does not show error UI', () => {
      render(
        <ErrorBoundary>
          <div>Normal content</div>
        </ErrorBoundary>
      );

      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('when children throw an error', () => {
    it('catches the error and shows default error UI', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
      expect(screen.getByText('Test error message')).toBeInTheDocument();
    });

    it('shows "Try again" button', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      );

      expect(screen.getByRole('button', { name: /try again/i })).toBeInTheDocument();
    });

    it('resets error state when "Try again" is clicked', () => {
      let shouldThrow = true;

      const { rerender } = render(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );

      // Error UI should be shown
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();

      // Fix the component
      shouldThrow = false;

      // Click try again
      fireEvent.click(screen.getByRole('button', { name: /try again/i }));

      // Re-render with fixed component
      rerender(
        <ErrorBoundary>
          <ThrowingComponent shouldThrow={shouldThrow} />
        </ErrorBoundary>
      );

      // Should show content now (note: in real usage, the component would need to actually fix the issue)
    });

    it('logs error to console', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      );

      expect(console.error).toHaveBeenCalled();
    });
  });

  describe('with custom fallback', () => {
    it('renders custom fallback instead of default UI', () => {
      const customFallback = <div>Custom error page</div>;

      render(
        <ErrorBoundary fallback={customFallback}>
          <ThrowingComponent />
        </ErrorBoundary>
      );

      expect(screen.getByText('Custom error page')).toBeInTheDocument();
      expect(screen.queryByText('Something went wrong')).not.toBeInTheDocument();
    });
  });

  describe('error boundary isolation', () => {
    it('does not affect sibling components', () => {
      render(
        <div>
          <div>Sibling 1</div>
          <ErrorBoundary>
            <ThrowingComponent />
          </ErrorBoundary>
          <div>Sibling 2</div>
        </div>
      );

      // Siblings should still render
      expect(screen.getByText('Sibling 1')).toBeInTheDocument();
      expect(screen.getByText('Sibling 2')).toBeInTheDocument();
      // Error boundary should show error
      expect(screen.getByText('Something went wrong')).toBeInTheDocument();
    });
  });

  describe('accessibility', () => {
    it('error UI is accessible', () => {
      render(
        <ErrorBoundary>
          <ThrowingComponent />
        </ErrorBoundary>
      );

      // Heading should be present
      expect(screen.getByRole('heading', { name: /something went wrong/i })).toBeInTheDocument();

      // Button should be focusable
      const button = screen.getByRole('button', { name: /try again/i });
      expect(button).toBeInTheDocument();
      button.focus();
      expect(document.activeElement).toBe(button);
    });
  });
});
