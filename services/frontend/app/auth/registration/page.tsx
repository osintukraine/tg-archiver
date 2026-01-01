'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Configuration, FrontendApi, RegistrationFlow, UiNode, UiNodeInputAttributes } from '@ory/client';
import Link from 'next/link';
import { useAuth } from '@/contexts/AuthContext';

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

function RegistrationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const { refreshSession } = useAuth();
  const flowId = searchParams.get('flow');
  const returnTo = searchParams.get('returnTo') || '/';

  const [flow, setFlow] = useState<RegistrationFlow | null>(null);
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [organization, setOrganization] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');

  const initFlow = useCallback(async () => {
    if (flowId) {
      try {
        const { data } = await ory.getRegistrationFlow({ id: flowId });
        setFlow(data);
      } catch {
        // Flow expired or invalid, create new one
        const { data } = await ory.createBrowserRegistrationFlow({ returnTo });
        router.replace(`?flow=${data.id}&returnTo=${encodeURIComponent(returnTo)}`);
      }
    } else {
      try {
        const { data } = await ory.createBrowserRegistrationFlow({ returnTo });
        router.replace(`?flow=${data.id}&returnTo=${encodeURIComponent(returnTo)}`);
      } catch (err) {
        console.error('Failed to create registration flow:', err);
        setError('Failed to initialize registration. Please refresh the page.');
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
      await ory.updateRegistrationFlow({
        flow: flow.id,
        updateRegistrationFlowBody: {
          method: 'password',
          password: password,
          traits: {
            email: email,
            name: {
              first: firstName,
              last: lastName,
            },
            organization: organization,
          },
          csrf_token: getCsrfToken(flow),
        },
      });

      // Registration successful - refresh auth context to update header nav
      // (if auto-login is enabled in Kratos, user will be logged in)
      await refreshSession();

      // Then redirect to the return URL
      router.push(returnTo);
    } catch (err: unknown) {
      const response = (err as { response?: { data?: RegistrationFlow } })?.response?.data;
      if (response) {
        // Update flow with new CSRF token and show errors
        setFlow(response);
        const messages = response.ui?.messages || [];
        const errorMsg = messages.find(m => m.type === 'error')?.text;
        setError(errorMsg || 'Registration failed. Please check your input.');
      } else {
        setError('Registration failed. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  function getCsrfToken(flow: RegistrationFlow): string {
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
    <div className="min-h-screen flex items-center justify-center bg-gray-900 px-4 py-8">
      <div className="max-w-md w-full space-y-8 bg-gray-800 p-8 rounded-lg shadow-xl">
        <div>
          <h2 className="text-center text-3xl font-bold text-white">
            Create your account
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            Join the OSINT Platform
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
                Email address <span className="text-red-400">*</span>
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
                Password <span className="text-red-400">*</span>
              </label>
              <input
                id="password"
                name="password"
                type="password"
                autoComplete="new-password"
                required
                minLength={8}
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="••••••••"
              />
              <p className="mt-1 text-xs text-gray-400">
                Minimum 8 characters
              </p>
            </div>

            <div className="grid grid-cols-2 gap-4">
              <div>
                <label htmlFor="firstName" className="block text-sm font-medium text-gray-300">
                  First Name
                </label>
                <input
                  id="firstName"
                  name="firstName"
                  type="text"
                  autoComplete="given-name"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="John"
                />
              </div>

              <div>
                <label htmlFor="lastName" className="block text-sm font-medium text-gray-300">
                  Last Name
                </label>
                <input
                  id="lastName"
                  name="lastName"
                  type="text"
                  autoComplete="family-name"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  placeholder="Doe"
                />
              </div>
            </div>

            <div>
              <label htmlFor="organization" className="block text-sm font-medium text-gray-300">
                Organization
              </label>
              <input
                id="organization"
                name="organization"
                type="text"
                autoComplete="organization"
                value={organization}
                onChange={(e) => setOrganization(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Your organization (optional)"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {loading ? 'Creating account...' : 'Create account'}
            </button>
          </div>

          <div className="text-center text-sm">
            <span className="text-gray-400">Already have an account? </span>
            <Link href="/auth/login" className="text-blue-400 hover:text-blue-300">
              Sign in
            </Link>
          </div>
        </form>

        <div className="mt-4 text-xs text-gray-500 text-center">
          By creating an account, you agree to the platform&apos;s terms of service.
          New accounts are created with &quot;viewer&quot; role by default.
        </div>
      </div>
    </div>
  );
}

export default function RegistrationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <RegistrationForm />
    </Suspense>
  );
}
