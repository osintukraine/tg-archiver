'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Configuration, FrontendApi, LoginFlow, UiNode, UiNodeInputAttributes } from '@ory/client';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

// Use /kratos path when in browser (proxied by Caddy to kratos:4433)
// Fallback to env var for SSR or localhost development
const kratosBasePath = typeof window !== 'undefined'
  ? '/kratos'
  : (process.env.NEXT_PUBLIC_ORY_URL || 'http://kratos:4433');

const ory = new FrontendApi(
  new Configuration({
    basePath: kratosBasePath,
    baseOptions: { withCredentials: true },
  })
);

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession } = useAuth();
  const flowId = searchParams.get('flow');
  const returnTo = searchParams.get('returnTo') || '/';

  const [flow, setFlow] = useState<LoginFlow | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const initFlow = useCallback(async () => {
    if (flowId) {
      try {
        const { data } = await ory.getLoginFlow({ id: flowId });
        setFlow(data);
      } catch {
        // Flow expired or invalid, create new one
        const { data } = await ory.createBrowserLoginFlow({ returnTo });
        router.replace(`?flow=${data.id}&returnTo=${encodeURIComponent(returnTo)}`);
      }
    } else {
      try {
        const { data } = await ory.createBrowserLoginFlow({ returnTo });
        router.replace(`?flow=${data.id}&returnTo=${encodeURIComponent(returnTo)}`);
      } catch (err) {
        console.error('Failed to create login flow:', err);
        setError('Failed to initialize login. Please refresh the page.');
      }
    }
  }, [flowId, returnTo, router]);

  useEffect(() => {
    initFlow();
  }, [initFlow]);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flow) return;

    setLoading(true);
    setError('');

    try {
      await ory.updateLoginFlow({
        flow: flow.id,
        updateLoginFlowBody: {
          method: 'password',
          identifier: email,
          password: password,
          csrf_token: getCsrfToken(flow),
        },
      });

      // Login successful - refresh auth context to update header nav
      await refreshSession();

      // Then redirect to the return URL
      router.push(returnTo);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: LoginFlow } })?.response?.data;
      if (response) {
        // Update flow with new CSRF token and show errors
        setFlow(response);
        const messages = response.ui?.messages || [];
        const errorMsg = messages.find(m => m.type === 'error')?.text;
        setError(errorMsg || 'Login failed. Please check your credentials.');
      } else {
        setError('Login failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  function getCsrfToken(flow: LoginFlow): string {
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
            Sign in to OSINT Platform
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Enter your credentials to access the platform
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            <div>
              <label htmlFor="email" className="block text-sm font-medium text-gray-300">
                Email address
              </label>
              <input
                id="email"
                name="email"
                type="email"
                autoComplete="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="you@example.com"
              />
            </div>

            <div>
              <label htmlFor="password" className="block text-sm font-medium text-gray-300">
                Password
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="current-password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {loading ? 'Signing in...' : 'Sign in'}
            </button>
          </div>

          <div className="flex items-center justify-between text-sm">
            <Link href="/auth/recovery" className="text-blue-400 hover:text-blue-300">
              Forgot password?
            </Link>
            <Link href="/auth/registration" className="text-blue-400 hover:text-blue-300">
              Create account
            </Link>
          </div>
        </form>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <LoginForm />
    </Suspense>
  );
}
