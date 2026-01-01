'use client';

export default function Error({
  error,
  reset,
}: {
  error: Error & { digest?: string };
  reset: () => void;
}) {
  return (
    <div className="max-w-4xl mx-auto">
      <div className="glass p-8 rounded-xl">
        <h2 className="text-2xl font-bold text-accent-danger mb-4">
          Error Loading Message
        </h2>
        <p className="text-text-secondary mb-4">
          {error.message || 'An unexpected error occurred'}
        </p>
        <button
          onClick={reset}
          className="px-4 py-2 bg-accent-primary text-white rounded-lg hover:bg-accent-primary/80 transition-colors"
        >
          Try Again
        </button>
      </div>
    </div>
  );
}
