// services/frontend/app/about/AboutPageContent.tsx

'use client';

import Script from 'next/script';
import ActivityTab from '@/components/about/tabs/ActivityTab';
import { ErrorBoundary } from '@/components/ErrorBoundary';
import { SITE_NAME } from '@/lib/constants';

// Ko-fi widget configuration
// Set NEXT_PUBLIC_KOFI_USERNAME in .env to enable the donation widget
const KOFI_USERNAME = process.env.NEXT_PUBLIC_KOFI_USERNAME;
const KOFI_WIDGET_CONFIG = {
  'type': 'floating-chat',
  'floating-chat.donateButton.text': 'Support me',
  'floating-chat.donateButton.background-color': '#00b9fe',
  'floating-chat.donateButton.text-color': '#fff'
};

export default function AboutPageContent() {
  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            About {SITE_NAME}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-3xl">
            Telegram channel archiving platform - real-time monitoring and activity tracking.
          </p>
        </div>
      </div>

      {/* Activity Content */}
      <ErrorBoundary>
        <ActivityTab />
      </ErrorBoundary>

      {/* Ko-fi Floating Widget - only rendered when NEXT_PUBLIC_KOFI_USERNAME is set */}
      {KOFI_USERNAME && (
        <Script
          src="https://storage.ko-fi.com/cdn/scripts/overlay-widget.js"
          strategy="lazyOnload"
          onLoad={() => {
            // @ts-expect-error - kofiWidgetOverlay is injected by the external script
            if (typeof window !== 'undefined' && window.kofiWidgetOverlay) {
              // @ts-expect-error - kofiWidgetOverlay is injected by the external script
              window.kofiWidgetOverlay.draw(KOFI_USERNAME, KOFI_WIDGET_CONFIG);
            }
          }}
        />
      )}
    </div>
  );
}
