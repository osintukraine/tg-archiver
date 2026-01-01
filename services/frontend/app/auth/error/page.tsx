'use client';

import { useEffect, useState, Suspense } from 'react';
import { useSearchParams } from 'next/navigation';
import { Configuration, FrontendApi, FlowError } from '@ory/client';
import Link from 'next/link';

// Use /kratos path when in browser (proxied by Caddy to kratos:4433)
const kratosBasePath = typeof window !== 'undefined'
  ? '/kratos'
  : (process.env.NEXT_PUBLIC_ORY_URL || 'http://kratos:4433');

const ory = new FrontendApi(
  new Configuration({
    basePath: kratosBasePath,
    baseOptions: { withCredentials: true },
  })
);

function ErrorContent() {
  const searchParams = useSearchParams();
  const errorId = searchParams.get('id');

  const [error, setError] = useState<FlowError | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (errorId) {
      ory.getFlowError({ id: errorId })
        .then(({ data }) => {
          setError(data);
        })
        .catch((err) => {
          console.error('Failed to fetch error:', err);
        })
        .finally(() => {
          setLoading(false);
        });
    } else {
      setLoading(false);
    }
  }, [errorId]);

  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  const errorObj = error?.error as { message?: string; reason?: string; status?: string; debug?: string } | undefined;
  const errorMessage = errorObj?.message || 'An unexpected error occurred';
  const errorReason = errorObj?.reason || '';
  const errorStatus = errorObj?.status || '';

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 bg-gray-800 p-8 rounded-lg shadow-xl text-center">
        <div>
          <div className="mx-auto w-16 h-16 bg-red-900/50 rounded-full flex items-center justify-center mb-4">
            <svg className="w-8 h-8 text-red-400" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
          </div>
          <h2 className="text-2xl font-bold text-white">
            {errorStatus ? `Error ${errorStatus}` : 'Authentication Error'}
          </h2>
        </div>

        <div className="bg-red-900/30 border border-red-500/50 rounded-lg p-4">
          <p className="text-red-200 font-medium">{errorMessage}</p>
          {errorReason && (
            <p className="text-red-300/70 text-sm mt-2">{errorReason}</p>
          )}
        </div>

        {errorObj?.debug && process.env.NODE_ENV === 'development' && (
          <div className="bg-gray-700/50 rounded-lg p-4 text-left">
            <p className="text-xs text-gray-400 font-mono break-all">
              {errorObj.debug}
            </p>
          </div>
        )}

        <div className="space-y-3">
          <Link
            href="/auth/login"
            className="block w-full py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500"
          >
            Go to login
          </Link>
          <Link
            href="/"
            className="block w-full py-2 px-4 border border-gray-600 rounded-md text-sm font-medium text-gray-300 hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-gray-500"
          >
            Back to home
          </Link>
        </div>

        {errorId && (
          <p className="text-xs text-gray-500">
            Error ID: {errorId}
          </p>
        )}
      </div>
    </div>
  );
}

export default function ErrorPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <ErrorContent />
    </Suspense>
  );
}
