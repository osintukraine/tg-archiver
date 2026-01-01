'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Configuration, FrontendApi, SettingsFlow, UiNode, UiNodeInputAttributes } from '@ory/client';
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

function SettingsForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flowId = searchParams.get('flow');

  const [flow, setFlow] = useState<SettingsFlow | null>(null);
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');

  const initFlow = useCallback(async () => {
    if (flowId) {
      try {
        const { data } = await ory.getSettingsFlow({ id: flowId });
        setFlow(data);
      } catch {
        // Flow expired or invalid, create new one
        try {
          const { data } = await ory.createBrowserSettingsFlow();
          router.replace(`?flow=${data.id}`);
        } catch {
          // User not authenticated, redirect to login
          router.push('/auth/login?returnTo=/auth/settings');
        }
      }
    } else {
      try {
        const { data } = await ory.createBrowserSettingsFlow();
        router.replace(`?flow=${data.id}`);
      } catch {
        // User not authenticated, redirect to login
        router.push('/auth/login?returnTo=/auth/settings');
      }
    }
  }, [flowId, router]);

  useEffect(() => {
    initFlow();
  }, [initFlow]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flow) return;

    if (password !== confirmPassword) {
      setError('Passwords do not match');
      return;
    }

    if (password.length < 8) {
      setError('Password must be at least 8 characters');
      return;
    }

    setLoading(true);
    setError('');

    try {
      const { data } = await ory.updateSettingsFlow({
        flow: flow.id,
        updateSettingsFlowBody: {
          method: 'password',
          password: password,
          csrf_token: getCsrfToken(flow),
        },
      });

      setFlow(data);
      setSuccess('Password updated successfully!');
      setPassword('');
      setConfirmPassword('');

      // Redirect to profile or home after success
      setTimeout(() => {
        router.push('/profile');
      }, 2000);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: SettingsFlow } })?.response?.data;
      if (response) {
        setFlow(response);
        const messages = response.ui?.messages || [];
        const errorMsg = messages.find(m => m.type === 'error')?.text;
        setError(errorMsg || 'Failed to update password.');
      } else {
        setError('Failed to update password. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  function getCsrfToken(flow: SettingsFlow): string {
    const csrfNode = flow.ui.nodes.find(
      (node: UiNode) =>
        (node.attributes as UiNodeInputAttributes).name === 'csrf_token'
    );
    return (csrfNode?.attributes as UiNodeInputAttributes)?.value || '';
  }

  if (!flow) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    );
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4">
      <div className="max-w-md w-full space-y-8 bg-gray-800 p-8 rounded-lg shadow-xl">
        <div>
          <h2 className="text-center text-3xl font-bold text-white">
            Update your password
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Enter your new password below
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded">
            {error}
          </div>
        )}

        {success && (
          <div className="bg-green-900/50 border border-green-500 text-green-200 px-4 py-3 rounded">
            {success}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                New password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                minLength={8}
              />
            </div>

            <div>
              <label htmlFor="confirmPassword" className="block text-sm font-medium text-gray-300">
                Confirm new password
              </label>
              <input
                id="confirmPassword"
                name="confirmPassword"
                type="password"
                autoComplete="new-password"
                required
                value={confirmPassword}
                onChange={(e) => setConfirmPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
                minLength={8}
              />
            </div>
          </div>

          <button
            type="submit"
            disabled={loading}
            className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
          >
            {loading ? 'Updating...' : 'Update password'}
          </button>
        </form>

        <div className="flex items-center justify-between text-sm">
          <Link href="/profile" className="text-blue-400 hover:text-blue-300">
            Go to profile
          </Link>
          <Link href="/" className="text-gray-400 hover:text-gray-300">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <SettingsForm />
    </Suspense>
  );
}
