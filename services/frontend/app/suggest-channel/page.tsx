'use client';

import { useState, useEffect, useMemo } from 'react';
import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';

// Use relative URLs when behind proxy, or NEXT_PUBLIC_API_URL for direct access
const API_URL = process.env.NEXT_PUBLIC_API_URL || '';

// Cloudflare Turnstile site key
const TURNSTILE_SITE_KEY = process.env.NEXT_PUBLIC_TURNSTILE_SITE_KEY || '1x00000000000000000000AA';

// Channel link validation patterns
const CHANNEL_LINK_PATTERNS = {
  username: /^@[a-zA-Z0-9_]{5,32}$/,
  tmeUrl: /^(?:https?:\/\/)?t\.me\/[a-zA-Z0-9_]{5,32}(?:\?.*)?$/,
  telegramUrl: /^(?:https?:\/\/)?telegram\.me\/[a-zA-Z0-9_]{5,32}(?:\?.*)?$/,
  rawUsername: /^[a-zA-Z0-9_]{5,32}$/,
  privateChannel: /^\+[a-zA-Z0-9_]+$/,
};

function validateChannelLink(link: string): { valid: boolean; error?: string } {
  const trimmed = link.trim();
  if (!trimmed) return { valid: false, error: 'Channel link is required' };

  // Check all valid patterns
  if (CHANNEL_LINK_PATTERNS.username.test(trimmed)) return { valid: true };
  if (CHANNEL_LINK_PATTERNS.tmeUrl.test(trimmed)) return { valid: true };
  if (CHANNEL_LINK_PATTERNS.telegramUrl.test(trimmed)) return { valid: true };
  if (CHANNEL_LINK_PATTERNS.rawUsername.test(trimmed)) return { valid: true };
  if (CHANNEL_LINK_PATTERNS.privateChannel.test(trimmed)) return { valid: true };

  // Check if it looks like a username but wrong length
  if (/^@?[a-zA-Z0-9_]+$/.test(trimmed.replace(/^@/, ''))) {
    const username = trimmed.replace(/^@/, '');
    if (username.length < 5) return { valid: false, error: 'Username must be at least 5 characters' };
    if (username.length > 32) return { valid: false, error: 'Username cannot exceed 32 characters' };
  }

  return { valid: false, error: 'Invalid format. Use @username, t.me/username, or +invite_code' };
}

export default function SuggestChannelPage() {
  const [channelLink, setChannelLink] = useState('');
  const [channelName, setChannelName] = useState('');
  const [sourceOrigin, setSourceOrigin] = useState<'ua' | 'ru' | 'unknown'>('unknown');
  const [reason, setReason] = useState('');
  const [valueDescription, setValueDescription] = useState('');

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [submissionId, setSubmissionId] = useState<number | null>(null);
  const [turnstileLoaded, setTurnstileLoaded] = useState(false);

  // Validate channel link in real-time
  const channelLinkValidation = useMemo(() => validateChannelLink(channelLink), [channelLink]);

  // Load Cloudflare Turnstile script
  useEffect(() => {
    // Check if already loaded
    if ((window as any).turnstile) {
      setTurnstileLoaded(true);
      return;
    }

    const script = document.createElement('script');
    script.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js';
    script.async = true;
    script.defer = true;
    script.onload = () => setTurnstileLoaded(true);
    document.head.appendChild(script);

    return () => {
      // Cleanup if component unmounts
      if (script.parentNode) {
        script.parentNode.removeChild(script);
      }
    };
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();

    // Validate channel link before submit
    if (!channelLinkValidation.valid) {
      setError(channelLinkValidation.error || 'Invalid channel link format');
      return;
    }

    setLoading(true);
    setError('');

    try {
      // Get Turnstile token (empty string for dev mode, actual token for production)
      const turnstileToken = turnstileLoaded
        ? ((window as any).turnstile?.getResponse() || '')
        : '';

      const response = await fetch(`${API_URL}/api/channel-submissions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          channel_link: channelLink,
          channel_name: channelName,
          source_origin: sourceOrigin,
          reason: reason,
          value_description: valueDescription || undefined,
          turnstile_token: turnstileToken,
        }),
      });

      if (!response.ok) {
        const errorData = await response.json().catch(() => ({ detail: 'Submission failed' }));
        // Handle Pydantic validation errors (array) and simple errors (string)
        let errorMessage = 'Submission failed';
        if (typeof errorData.detail === 'string') {
          errorMessage = errorData.detail;
        } else if (Array.isArray(errorData.detail)) {
          // Pydantic validation errors: [{loc: [...], msg: "...", type: "..."}]
          errorMessage = errorData.detail.map((e: any) => e.msg).join(', ');
        }
        throw new Error(errorMessage || `Error: ${response.status}`);
      }

      const data = await response.json();
      setSubmissionId(data.id);
    } catch (err) {
      console.error('Submission error:', err);
      setError(err instanceof Error ? err.message : 'Failed to submit. Please try again.');
    } finally {
      setLoading(false);
    }
  };

  // Success state
  if (submissionId !== null) {
    return (
      <div className="min-h-[60vh] flex items-center justify-center px-4">
        <div className="max-w-md w-full space-y-6 bg-bg-elevated p-8 rounded-lg shadow-xl text-center">
          {/* Success icon */}
          <div className="flex justify-center">
            <div className="rounded-full bg-green-900/30 p-3">
              <svg
                className="w-12 h-12 text-green-400"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M5 13l4 4L19 7"
                />
              </svg>
            </div>
          </div>

          <div>
            <h2 className="text-3xl font-bold text-text-primary">Thank You!</h2>
            <p className="mt-3 text-text-secondary">
              Your channel suggestion has been submitted successfully.
            </p>
            <p className="mt-2 text-sm text-text-tertiary">
              Submission ID: <span className="font-mono text-blue-400">#{submissionId}</span>
            </p>
            <p className="mt-4 text-sm text-text-tertiary">
              Want to track your submission?{' '}
              <Link href="/auth/login" className="text-blue-400 hover:text-blue-300 underline">
                Log in
              </Link>{' '}
              to see status updates.
            </p>
          </div>

          <div className="pt-4">
            <Link
              href="/"
              className="inline-flex items-center justify-center px-6 py-3 border border-transparent rounded-md shadow-sm text-base font-medium text-text-primary bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
            >
              Back to Home
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Form state
  return (
    <div className="min-h-[60vh] flex items-center justify-center px-4 py-8">
      <div className="max-w-2xl w-full space-y-8 bg-bg-elevated p-8 rounded-lg shadow-xl">
        <div>
          <h1 className="text-center text-3xl font-bold text-text-primary">
            Suggest a Channel
          </h1>
          <p className="mt-2 text-center text-sm text-text-tertiary">
            Help us expand our coverage by suggesting channels worth monitoring
          </p>
        </div>

        {error && (
          <div className="bg-red-900/50 border border-red-500 text-red-200 px-4 py-3 rounded">
            {error}
          </div>
        )}

        <form onSubmit={handleSubmit} className="mt-8 space-y-6">
          <div className="space-y-4">
            {/* Channel Link */}
            <div>
              <label htmlFor="channelLink" className="block text-sm font-medium text-text-secondary">
                Channel Link <span className="text-red-400">*</span>
              </label>
              <p className="mt-1 text-xs text-text-tertiary">@username, t.me/username, or +invite_code</p>
              <input
                id="channelLink"
                name="channelLink"
                type="text"
                required
                value={channelLink}
                onChange={(e) => setChannelLink(e.target.value)}
                className={`mt-1 block w-full px-3 py-2 bg-bg-secondary border rounded-md text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  channelLink && !channelLinkValidation.valid ? 'border-red-500' : channelLink && channelLinkValidation.valid ? 'border-green-500' : 'border-border-subtle'
                }`}
                placeholder="t.me/channel or @channel"
              />
              {channelLink && !channelLinkValidation.valid && (
                <p className="mt-1 text-xs text-red-400">{channelLinkValidation.error}</p>
              )}
              {channelLink && channelLinkValidation.valid && (
                <p className="mt-1 text-xs text-green-400">✓ Valid format</p>
              )}
            </div>

            {/* Channel Name */}
            <div>
              <label htmlFor="channelName" className="block text-sm font-medium text-text-secondary">
                Channel Name <span className="text-red-400">*</span>
              </label>
              <input
                id="channelName"
                name="channelName"
                type="text"
                required
                value={channelName}
                onChange={(e) => setChannelName(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-bg-secondary border border-border-subtle rounded-md text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="Full channel name"
              />
            </div>

            {/* Source Origin */}
            <div>
              <label htmlFor="sourceOrigin" className="block text-sm font-medium text-text-secondary">
                Source Origin <span className="text-red-400">*</span>
              </label>
              <select
                id="sourceOrigin"
                name="sourceOrigin"
                required
                value={sourceOrigin}
                onChange={(e) => setSourceOrigin(e.target.value as 'ua' | 'ru' | 'unknown')}
                className="mt-1 block w-full px-3 py-2 bg-bg-secondary border border-border-subtle rounded-md text-text-primary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              >
                <option value="unknown">Unknown</option>
                <option value="ua">Ukrainian</option>
                <option value="ru">Russian</option>
              </select>
            </div>

            {/* Reason */}
            <div>
              <label htmlFor="reason" className="block text-sm font-medium text-text-secondary">
                Reason <span className="text-red-400">*</span>
              </label>
              <p className="mt-1 text-xs text-text-tertiary">Minimum 10 characters</p>
              <textarea
                id="reason"
                name="reason"
                required
                minLength={10}
                rows={3}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={`mt-1 block w-full px-3 py-2 bg-bg-secondary border rounded-md text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent ${
                  reason.length > 0 && reason.length < 10 ? 'border-yellow-500' : 'border-border-subtle'
                }`}
                placeholder="Why should we archive this channel?"
              />
              {reason.length > 0 && reason.length < 10 && (
                <p className="mt-1 text-xs text-yellow-400">{10 - reason.length} more characters needed</p>
              )}
            </div>

            {/* Value Description (optional) */}
            <div>
              <label htmlFor="valueDescription" className="block text-sm font-medium text-text-secondary">
                Value Description (Optional)
              </label>
              <textarea
                id="valueDescription"
                name="valueDescription"
                rows={3}
                value={valueDescription}
                onChange={(e) => setValueDescription(e.target.value)}
                className="mt-1 block w-full px-3 py-2 bg-bg-secondary border border-border-subtle rounded-md text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                placeholder="What intelligence value does it provide?"
              />
            </div>

            {/* Cloudflare Turnstile Widget */}
            <div className="flex justify-center py-4">
              <div
                className="cf-turnstile"
                data-sitekey={TURNSTILE_SITE_KEY}
                data-theme="dark"
              />
            </div>
          </div>

          <div>
            <button
              type="submit"
              disabled={loading}
              className="w-full flex justify-center py-3 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-text-primary bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-bg-tertiary disabled:cursor-not-allowed transition-colors"
            >
              {loading ? 'Submitting...' : 'Submit Suggestion'}
            </button>
          </div>

          <div className="text-center text-sm text-text-tertiary">
            All submissions are reviewed by our team before being added to the monitoring list.
          </div>
        </form>
      </div>
    </div>
  );
}
