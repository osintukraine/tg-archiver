// services/frontend-nextjs/app/about/AboutPageContent.tsx

'use client';

import { useState, useEffect } from 'react';
import Script from 'next/script';
import { useAboutPageData } from '@/hooks/useAboutPageData';
import TabNavigation, { TabId } from '@/components/about/TabNavigation';
import OverviewTab from '@/components/about/tabs/OverviewTab';
import ActivityTab from '@/components/about/tabs/ActivityTab';
import ArchitectureTab from '@/components/about/tabs/ArchitectureTab';
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
  const [activeTab, setActiveTab] = useState<TabId>('overview');
  const { systemHealth, aboutStats, pipelineMetrics, servicesMetrics, qualityMetrics, isLoading, error } = useAboutPageData();

  // URL-based tab routing
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const tab = params.get('tab') as TabId;
    if (tab && ['overview', 'activity', 'architecture'].includes(tab)) {
      setActiveTab(tab);
    }
  }, []);

  // Update URL when tab changes
  const handleTabChange = (tab: TabId) => {
    setActiveTab(tab);
    const url = new URL(window.location.href);
    url.searchParams.set('tab', tab);
    window.history.pushState({}, '', url);
  };

  return (
    <div className="min-h-screen bg-gray-50 dark:bg-gray-950">
      {/* Header */}
      <div className="bg-white dark:bg-gray-900 border-b border-gray-200 dark:border-gray-800">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8">
          <h1 className="text-3xl font-bold text-gray-900 dark:text-gray-100 mb-2">
            About {SITE_NAME}
          </h1>
          <p className="text-gray-600 dark:text-gray-400 max-w-3xl">
            A production-ready platform for archiving, enriching, and analyzing Telegram
            channels with multi-model AI enrichment, semantic search, and configurable
            intelligence rules.
          </p>
        </div>
      </div>

      {/* Tab Navigation */}
      <TabNavigation activeTab={activeTab} onTabChange={handleTabChange} />

      {/* Tab Content */}
      <ErrorBoundary>
        {activeTab === 'overview' && <OverviewTab />}
        {activeTab === 'activity' && <ActivityTab />}
        {activeTab === 'architecture' && (
          <ArchitectureTab
            systemHealth={systemHealth}
            aboutStats={aboutStats}
            pipelineMetrics={pipelineMetrics}
            servicesMetrics={servicesMetrics}
            qualityMetrics={qualityMetrics}
            isLoading={isLoading}
            error={error}
          />
        )}
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
