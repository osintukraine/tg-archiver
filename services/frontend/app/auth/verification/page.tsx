'use client';

import { useEffect, useState, useCallback, Suspense } from 'react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Configuration, FrontendApi, VerificationFlow, UiNode, UiNodeInputAttributes } from '@ory/client';
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

function VerificationForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const flowId = searchParams.get('flow');

  const [flow, setFlow] = useState<VerificationFlow | null>(null);
  const [email, setEmail] = useState('');
  const [code, setCode] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [success, setSuccess] = useState('');
  const [stage, setStage] = useState<'email' | 'code'>('email');

  const initFlow = useCallback(async () => {
    if (flowId) {
      try {
        const { data } = await ory.getVerificationFlow({ id: flowId });
        setFlow(data);
        // Check if verification is already complete
        if (data.state === 'passed_challenge') {
          setSuccess('Email verified successfully!');
        }
        // Check if we're in the code stage
        const hasCodeInput = data.ui.nodes.some(
          (node: UiNode) => (node.attributes as UiNodeInputAttributes).name === 'code'
        );
        if (hasCodeInput) {
          setStage('code');
        }
      } catch {
        // Flow expired or invalid, create new one
        const { data } = await ory.createBrowserVerificationFlow();
        router.replace(`?flow=${data.id}`);
      }
    } else {
      try {
        const { data } = await ory.createBrowserVerificationFlow();
        router.replace(`?flow=${data.id}`);
      } catch (err) {
        console.error('Failed to create verification flow:', err);
        setError('Failed to initialize verification. Please refresh the page.');
      }
    }
  }, [flowId, router]);

  useEffect(() => {
    initFlow();
  }, [initFlow]);

  const handleSubmitEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flow) return;

    setLoading(true);
    setError('');

    try {
      const { data } = await ory.updateVerificationFlow({
        flow: flow.id,
        updateVerificationFlowBody: {
          method: 'code',
          email: email,
          csrf_token: getCsrfToken(flow),
        },
      });

      setFlow(data);
      setSuccess('Verification code sent! Check your email.');
      setStage('code');
    } catch (err: unknown) {
      const response = (err as { response?: { data?: VerificationFlow } })?.response?.data;
      if (response) {
        setFlow(response);
        const messages = response.ui?.messages || [];
        const errorMsg = messages.find(m => m.type === 'error')?.text;
        setError(errorMsg || 'Failed to send verification email.');
      } else {
        setError('Failed to send verification email. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  const handleSubmitCode = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!flow) return;

    setLoading(true);
    setError('');

    try {
      const { data } = await ory.updateVerificationFlow({
        flow: flow.id,
        updateVerificationFlowBody: {
          method: 'code',
          code: code,
          csrf_token: getCsrfToken(flow),
        },
      });

      setFlow(data);
      if (data.state === 'passed_challenge') {
        setSuccess('Email verified successfully! Redirecting...');
        setTimeout(() => router.push('/'), 2000);
      }
    } catch (err: unknown) {
      const response = (err as { response?: { data?: VerificationFlow } })?.response?.data;
      if (response) {
        setFlow(response);
        const messages = response.ui?.messages || [];
        const errorMsg = messages.find(m => m.type === 'error')?.text;
        setError(errorMsg || 'Invalid or expired code.');
      } else {
        setError('Failed to verify code. Please try again.');
      }
    } finally {
      setLoading(false);
    }
  };

  function getCsrfToken(flow: VerificationFlow): string {
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
            Verify your email
          </h2>
          <p className="mt-2 text-center text-sm text-gray-400">
            {stage === 'email'
              ? "Enter your email to receive a verification code"
              : "Enter the code sent to your email"
            }
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

        {stage === 'email' ? (
          <form onSubmit={handleSubmitEmail} className="mt-8 space-y-6">
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

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {loading ? 'Sending...' : 'Send verification code'}
            </button>
          </form>
        ) : (
          <form onSubmit={handleSubmitCode} className="mt-8 space-y-6">
            <div>
              <label htmlFor="code" className="block text-sm font-medium text-gray-300">
                Verification code
              </label>
              <input
                id="code"
                name="code"
                type="text"
                autoComplete="one-time-code"
                required
                value={code}
                onChange={(e) => setCode(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-gray-700 border border-gray-600 rounded-md text-white placeholder-gray-400 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent text-center text-2xl tracking-widest"
                placeholder="000000"
                maxLength={6}
              />
            </div>

            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-2 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-gray-600 disabled:cursor-not-allowed"
            >
              {loading ? 'Verifying...' : 'Verify email'}
            </button>

            <button
              type="button"
              onClick={() => { setStage('email'); setSuccess(''); }}
              className="w-full text-sm text-gray-400 hover:text-gray-300"
            >
              Use a different email
            </button>
          </form>
        )}

        <div className="text-center">
          <Link href="/" className="text-sm text-blue-400 hover:text-blue-300">
            Back to home
          </Link>
        </div>
      </div>
    </div>
  );
}

export default function VerificationPage() {
  return (
    <Suspense fallback={
      <div className="min-h-screen flex items-center justify-center bg-gray-900">
        <div className="text-white">Loading...</div>
      </div>
    }>
      <VerificationForm />
    </Suspense>
  );
}
