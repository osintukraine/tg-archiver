// services/frontend-nextjs/components/about/tabs/OverviewTab.tsx

'use client';

import {
  Radio,
  Database,
  Search,
  Shield,
  Archive,
  Globe,
  Users,
  Newspaper,
  Code,
  Building2,
  Eye,
  Loader2,
  Zap,
} from 'lucide-react';
import { useAboutPageData } from '@/hooks/useAboutPageData';
import { usePulseData } from '@/hooks/useActivityData';
import { AboutStats } from '@/types/about';
import { SITE_NAME } from '@/lib/constants';

interface StatCardProps {
  value: string | number;
  label: string;
  color: string;
  isLoading?: boolean;
}

function StatCard({ value, label, color, isLoading }: StatCardProps) {
  return (
    <div className="text-center p-4 bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 shadow-sm">
      {isLoading ? (
        <Loader2 className={`w-8 h-8 mx-auto animate-spin ${color}`} />
      ) : (
        <div className={`text-3xl font-bold ${color}`}>{value}</div>
      )}
      <div className="text-sm text-gray-600 dark:text-gray-400 mt-1">{label}</div>
    </div>
  );
}

export default function OverviewTab() {
  const { aboutStats, isLoading } = useAboutPageData();
  const { pulse, isLoading: isPulseLoading } = usePulseData(30000); // 30s refresh

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 space-y-16">
      {/* Section 1: Hero/Intro */}
      <section>
        <h1 className="text-4xl font-bold text-gray-900 dark:text-gray-100 mb-4">
          {SITE_NAME}
        </h1>
        <p className="text-xl text-gray-600 dark:text-gray-300 mb-8 max-w-4xl">
          A production-grade platform for monitoring, archiving, and analyzing Telegram channels
          with AI-powered enrichment.
        </p>

        <div className="prose prose-lg dark:prose-invert max-w-4xl mb-8">
          <p>
            Telegram has become a critical source of real-time intelligence during the Russia-Ukraine
            conflict—military movements, war documentation, propaganda narratives, and citizen journalism
            all flow through thousands of channels daily. This platform transforms that raw stream into
            searchable, enriched intelligence.
          </p>
          <p>
            Built for OSINT analysts, researchers, journalists, and developers who need reliable access
            to Telegram data without language barriers or platform lock-in. Self-hosted, transparent,
            and designed for serious intelligence work.
          </p>
        </div>

        {/* Key Differentiators */}
        <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
          <div className="flex items-start gap-3 p-4 bg-emerald-50 dark:bg-emerald-900/20 rounded-lg border border-emerald-200 dark:border-emerald-800">
            <Globe className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-emerald-900 dark:text-emerald-300">Real-time Archival</h4>
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                Automatic translation (RU/UK → EN) for all monitored content
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 bg-purple-50 dark:bg-purple-900/20 rounded-lg border border-purple-200 dark:border-purple-800">
            <Shield className="w-6 h-6 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-purple-900 dark:text-purple-300">AI-Powered Filtering</h4>
              <p className="text-sm text-purple-800 dark:text-purple-200">
                Spam filtering and semantic tagging with self-hosted LLM
              </p>
            </div>
          </div>
          <div className="flex items-start gap-3 p-4 bg-blue-50 dark:bg-blue-900/20 rounded-lg border border-blue-200 dark:border-blue-800">
            <Database className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-300">Full Data Sovereignty</h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                No external API dependencies—your data never leaves your infrastructure
              </p>
            </div>
          </div>
        </div>
      </section>

      {/* Section 2: Why Telegram Matters */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Why Telegram?
        </h2>

        <div className="prose prose-lg dark:prose-invert max-w-4xl mb-8">
          <p>
            Since February 24, 2022, Telegram has become the de facto communication platform for the
            Russia-Ukraine conflict. Unlike Twitter or Facebook, Telegram channels operate with minimal
            moderation—making it both a source of raw, unfiltered information and a vector for disinformation.
          </p>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-2 gap-8 mb-8">
          {/* The Challenge */}
          <div className="bg-red-50 dark:bg-red-900/20 rounded-lg border border-red-200 dark:border-red-800 p-6">
            <h3 className="text-lg font-semibold text-red-900 dark:text-red-300 mb-4">
              The Challenge
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-red-500 font-bold">•</span>
                <div>
                  <span className="font-medium text-red-900 dark:text-red-300">Language barrier:</span>
                  <span className="text-red-800 dark:text-red-200"> Most channels broadcast in Russian or Ukrainian</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-red-500 font-bold">•</span>
                <div>
                  <span className="font-medium text-red-900 dark:text-red-300">Volume:</span>
                  <span className="text-red-800 dark:text-red-200"> Thousands of messages daily across hundreds of channels</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-red-500 font-bold">•</span>
                <div>
                  <span className="font-medium text-red-900 dark:text-red-300">Ephemeral content:</span>
                  <span className="text-red-800 dark:text-red-200"> Media links expire, posts get deleted</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-red-500 font-bold">•</span>
                <div>
                  <span className="font-medium text-red-900 dark:text-red-300">Platform lock-in:</span>
                  <span className="text-red-800 dark:text-red-200"> Requires Telegram account, no web indexing</span>
                </div>
              </li>
            </ul>
          </div>

          {/* What This Platform Solves */}
          <div className="bg-green-50 dark:bg-green-900/20 rounded-lg border border-green-200 dark:border-green-800 p-6">
            <h3 className="text-lg font-semibold text-green-900 dark:text-green-300 mb-4">
              What This Platform Solves
            </h3>
            <ul className="space-y-3">
              <li className="flex items-start gap-3">
                <span className="text-green-500 font-bold">✓</span>
                <div>
                  <span className="font-medium text-green-900 dark:text-green-300">Automatic translation</span>
                  <span className="text-green-800 dark:text-green-200"> removes the language barrier</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-green-500 font-bold">✓</span>
                <div>
                  <span className="font-medium text-green-900 dark:text-green-300">Permanent archival</span>
                  <span className="text-green-800 dark:text-green-200"> preserves content before it disappears</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-green-500 font-bold">✓</span>
                <div>
                  <span className="font-medium text-green-900 dark:text-green-300">AI enrichment</span>
                  <span className="text-green-800 dark:text-green-200"> filters spam and surfaces signal</span>
                </div>
              </li>
              <li className="flex items-start gap-3">
                <span className="text-green-500 font-bold">✓</span>
                <div>
                  <span className="font-medium text-green-900 dark:text-green-300">Open access</span>
                  <span className="text-green-800 dark:text-green-200"> via REST APIs and RSS—no Telegram account needed</span>
                </div>
              </li>
            </ul>
          </div>
        </div>

        <div className="bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">
            <strong>Origin note:</strong> This project started on day one of the full-scale invasion,
            initially as a simple translation layer. It evolved into a production intelligence platform
            as the need for systematic archival and analysis became clear.
          </p>
        </div>
      </section>

      {/* Section 3: Platform Stats (Dynamic) */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Platform at a Glance
        </h2>

        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-4">
          <StatCard
            value={aboutStats?.channels ?? '—'}
            label="Channels"
            color="text-indigo-600 dark:text-indigo-400"
            isLoading={isLoading}
          />
          <StatCard
            value={aboutStats?.messages_formatted ?? '—'}
            label="Messages"
            color="text-purple-600 dark:text-purple-400"
            isLoading={isLoading}
          />
          <StatCard
            value={aboutStats?.media_size_formatted ?? '—'}
            label="Media Archived"
            color="text-green-600 dark:text-green-400"
            isLoading={isLoading}
          />
          <StatCard
            value={aboutStats?.entities ?? '—'}
            label="Entities Tracked"
            color="text-blue-600 dark:text-blue-400"
            isLoading={isLoading}
          />
          <StatCard
            value={aboutStats?.spam_blocked_formatted ?? '—'}
            label="Spam Blocked"
            color="text-red-600 dark:text-red-400"
            isLoading={isLoading}
          />
          <StatCard
            value={aboutStats?.sanctions_matches ?? '—'}
            label="Sanctions Flags"
            color="text-orange-600 dark:text-orange-400"
            isLoading={isLoading}
          />
        </div>

        {/* Live Pulse Row */}
        <div className="mt-6 flex items-center justify-center gap-2 sm:gap-4 flex-wrap text-sm">
          <div className="flex items-center gap-2 px-3 py-2 bg-gray-50 dark:bg-gray-800/50 rounded-lg">
            <Zap className="w-4 h-4 text-yellow-500" />
            {isPulseLoading ? (
              <Loader2 className="w-4 h-4 animate-spin text-gray-400" />
            ) : (
              <span className="text-gray-900 dark:text-gray-100 font-medium">
                {pulse.messages_last_hour.toLocaleString()}/hr
              </span>
            )}
          </div>
          <span className="text-gray-400">•</span>
          <span className="text-gray-700 dark:text-gray-300">
            {isPulseLoading ? '—' : pulse.messages_today.toLocaleString()} today
          </span>
          <span className="text-gray-400">•</span>
          <span className="text-gray-700 dark:text-gray-300">
            {isPulseLoading ? '—' : pulse.channels_active_24h} channels active
          </span>
          <div className={`flex items-center gap-1.5 px-2 py-1 rounded-full text-xs ${
            pulse.status === 'active'
              ? 'bg-green-100 dark:bg-green-900/30 text-green-700 dark:text-green-400'
              : pulse.status === 'slow'
              ? 'bg-yellow-100 dark:bg-yellow-900/30 text-yellow-700 dark:text-yellow-400'
              : 'bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400'
          }`}>
            <span className={`w-1.5 h-1.5 rounded-full ${
              pulse.status === 'active' ? 'bg-green-500 animate-pulse' :
              pulse.status === 'slow' ? 'bg-yellow-500' : 'bg-gray-400'
            }`} />
            {pulse.status === 'active' ? 'Live' : pulse.status === 'slow' ? 'Slow' : 'Idle'}
          </div>
        </div>

        {aboutStats?.timestamp && (
          <p className="text-xs text-gray-500 dark:text-gray-500 text-center mt-4">
            Last updated: {new Date(aboutStats.timestamp).toLocaleString()}
          </p>
        )}
      </section>

      {/* Section 4: Key Capabilities */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Key Capabilities
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* Real-Time Collection */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Radio className="w-8 h-8 text-cyan-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Real-Time Collection
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Monitor Telegram channels in real-time. New messages flow through the pipeline within
              seconds of posting. Folder-based channel management—add channels by dragging them
              into folders in your Telegram app.
            </p>
          </div>

          {/* AI-Powered Enrichment */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Shield className="w-8 h-8 text-purple-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                AI-Powered Enrichment
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Self-hosted LLM classifies content, filters spam, and generates semantic tags.
              No external API calls—your data never leaves your infrastructure.
            </p>
          </div>

          {/* Semantic Search */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Search className="w-8 h-8 text-blue-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Semantic Search
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Find intelligence by meaning, not just keywords. PostgreSQL with pgvector enables
              similarity search across your entire archive.
            </p>
          </div>

          {/* Permanent Archival */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Archive className="w-8 h-8 text-green-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Permanent Archival
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Media links expire on Telegram. This platform archives images, videos, and documents
              to local storage with SHA-256 deduplication.
            </p>
          </div>

          {/* Open Access */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Globe className="w-8 h-8 text-orange-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Open Access
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              REST API with 15+ filters, dynamic RSS feeds for any search query, and OpenAPI
              documentation. Build integrations without touching the database.
            </p>
          </div>

          {/* Entity Intelligence */}
          <div className="bg-white dark:bg-gray-800 rounded-lg border border-gray-200 dark:border-gray-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-8 h-8 text-indigo-500" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100">
                Entity Intelligence
              </h3>
            </div>
            <p className="text-gray-600 dark:text-gray-400">
              Cross-reference messages against curated entity lists and OpenSanctions data.
              Surface mentions of military units, political figures, and sanctioned individuals.
            </p>
          </div>
        </div>
      </section>

      {/* Section 5: Built For */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Built For
        </h2>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {/* OSINT Analysts */}
          <div className="bg-gradient-to-br from-indigo-50 to-purple-50 dark:from-indigo-900/30 dark:to-purple-900/30 rounded-lg border border-indigo-200 dark:border-indigo-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Eye className="w-8 h-8 text-indigo-600 dark:text-indigo-400" />
              <h3 className="text-lg font-semibold text-indigo-900 dark:text-indigo-300">
                OSINT Analysts
              </h3>
            </div>
            <p className="text-indigo-800 dark:text-indigo-200">
              Unified search across monitored Telegram channels with AI-powered classification.
              Find intelligence by meaning, not just keywords.
            </p>
          </div>

          {/* Journalists & Researchers */}
          <div className="bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-lg border border-emerald-200 dark:border-emerald-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Newspaper className="w-8 h-8 text-emerald-600 dark:text-emerald-400" />
              <h3 className="text-lg font-semibold text-emerald-900 dark:text-emerald-300">
                Journalists & Researchers
              </h3>
            </div>
            <p className="text-emerald-800 dark:text-emerald-200">
              Archived, translated content with permanent links. Cite sources without worrying
              about deleted posts or expired media.
            </p>
          </div>

          {/* Developers */}
          <div className="bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg border border-blue-200 dark:border-blue-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Code className="w-8 h-8 text-blue-600 dark:text-blue-400" />
              <h3 className="text-lg font-semibold text-blue-900 dark:text-blue-300">
                Developers
              </h3>
            </div>
            <p className="text-blue-800 dark:text-blue-200">
              REST APIs, RSS feeds, and OpenAPI docs. Integrate Telegram intelligence into your
              own tools and workflows.
            </p>
          </div>

          {/* Organizations */}
          <div className="bg-gradient-to-br from-orange-50 to-amber-50 dark:from-orange-900/30 dark:to-amber-900/30 rounded-lg border border-orange-200 dark:border-orange-700 p-6">
            <div className="flex items-center gap-3 mb-4">
              <Building2 className="w-8 h-8 text-orange-600 dark:text-orange-400" />
              <h3 className="text-lg font-semibold text-orange-900 dark:text-orange-300">
                Organizations
              </h3>
            </div>
            <p className="text-orange-800 dark:text-orange-200">
              Self-hosted infrastructure with full data sovereignty. No external dependencies,
              no third-party data processing.
            </p>
          </div>

          {/* General Public */}
          <div className="bg-gradient-to-br from-gray-50 to-slate-100 dark:from-gray-800/50 dark:to-slate-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-6 lg:col-span-2">
            <div className="flex items-center gap-3 mb-4">
              <Users className="w-8 h-8 text-gray-600 dark:text-gray-400" />
              <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-300">
                General Public
              </h3>
            </div>
            <p className="text-gray-700 dark:text-gray-300">
              Telegram can feel like an opaque, unsafe space—public channels are often just the surface
              of deeper networks where war content circulates unfiltered. This platform provides curated,
              translated access to verified intelligence sources without requiring you to navigate
              Telegram directly.
            </p>
          </div>
        </div>
      </section>

      {/* Section 6: Try Demo Content */}
      <section>
        <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100 mb-6">
          Try Demo Content
        </h2>

        <p className="text-gray-600 dark:text-gray-400 mb-6 max-w-3xl">
          Explore the platform&apos;s capabilities with sample data demonstrating all intelligence layers—
          entity matching, AI tagging, social graph analysis, and geolocation mapping.
        </p>

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {/* Full Intelligence Demo */}
          <a
            href="/messages/579"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-purple-50 to-indigo-50 dark:from-purple-900/30 dark:to-indigo-900/30 rounded-lg border border-purple-200 dark:border-purple-700 hover:border-purple-400 dark:hover:border-purple-500 transition-colors"
          >
            <Shield className="w-6 h-6 text-purple-600 dark:text-purple-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-purple-900 dark:text-purple-300 group-hover:text-purple-700 dark:group-hover:text-purple-200">
                Full Intelligence Stack
              </h4>
              <p className="text-sm text-purple-800 dark:text-purple-200">
                Message with curated entities, OpenSanctions matches, AI tags, and engagement metrics
              </p>
            </div>
          </a>

          {/* Map View Demo */}
          <a
            href="/map?lat=48.596&lng=38.003&zoom=8"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-emerald-50 to-teal-50 dark:from-emerald-900/30 dark:to-teal-900/30 rounded-lg border border-emerald-200 dark:border-emerald-700 hover:border-emerald-400 dark:hover:border-emerald-500 transition-colors"
          >
            <Globe className="w-6 h-6 text-emerald-600 dark:text-emerald-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-emerald-900 dark:text-emerald-300 group-hover:text-emerald-700 dark:group-hover:text-emerald-200">
                Geolocation Map
              </h4>
              <p className="text-sm text-emerald-800 dark:text-emerald-200">
                Interactive map centered on Bakhmut with geocoded message locations and event clusters
              </p>
            </div>
          </a>

          {/* Forward Chain Demo */}
          <a
            href="/messages/580"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-blue-50 to-cyan-50 dark:from-blue-900/30 dark:to-cyan-900/30 rounded-lg border border-blue-200 dark:border-blue-700 hover:border-blue-400 dark:hover:border-blue-500 transition-colors"
          >
            <Radio className="w-6 h-6 text-blue-600 dark:text-blue-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-blue-900 dark:text-blue-300 group-hover:text-blue-700 dark:group-hover:text-blue-200">
                Forward Chain Demo
              </h4>
              <p className="text-sm text-blue-800 dark:text-blue-200">
                Message demonstrating forward tracking from Ukrainian sources
              </p>
            </div>
          </a>

          {/* Entity Relations Demo */}
          <a
            href="/messages/581"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-red-50 to-orange-50 dark:from-red-900/30 dark:to-orange-900/30 rounded-lg border border-red-200 dark:border-red-700 hover:border-red-400 dark:hover:border-red-500 transition-colors"
          >
            <Users className="w-6 h-6 text-red-600 dark:text-red-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-red-900 dark:text-red-300 group-hover:text-red-700 dark:group-hover:text-red-200">
                Entity Relations
              </h4>
              <p className="text-sm text-red-800 dark:text-red-200">
                Sanctioned entities with relationship mapping (Putin, Abramovich, Rostec)
              </p>
            </div>
          </a>

          {/* EW Analysis Demo */}
          <a
            href="/messages/582"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-cyan-50 to-sky-50 dark:from-cyan-900/30 dark:to-sky-900/30 rounded-lg border border-cyan-200 dark:border-cyan-700 hover:border-cyan-400 dark:hover:border-cyan-500 transition-colors"
          >
            <Database className="w-6 h-6 text-cyan-600 dark:text-cyan-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-cyan-900 dark:text-cyan-300 group-hover:text-cyan-700 dark:group-hover:text-cyan-200">
                Electronic Warfare
              </h4>
              <p className="text-sm text-cyan-800 dark:text-cyan-200">
                Military equipment entity matching (EW systems, aircraft)
              </p>
            </div>
          </a>

          {/* Media Archival Demo */}
          <a
            href="/messages/583"
            className="group flex items-start gap-3 p-4 bg-gradient-to-br from-amber-50 to-yellow-50 dark:from-amber-900/30 dark:to-yellow-900/30 rounded-lg border border-amber-200 dark:border-amber-700 hover:border-amber-400 dark:hover:border-amber-500 transition-colors"
          >
            <Archive className="w-6 h-6 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-1" />
            <div>
              <h4 className="font-semibold text-amber-900 dark:text-amber-300 group-hover:text-amber-700 dark:group-hover:text-amber-200">
                Media Archival
              </h4>
              <p className="text-sm text-amber-800 dark:text-amber-200">
                Combat footage with archived photos and video content
              </p>
            </div>
          </a>
        </div>

        <div className="mt-6 bg-gray-50 dark:bg-gray-800/50 rounded-lg border border-gray-200 dark:border-gray-700 p-4">
          <p className="text-sm text-gray-600 dark:text-gray-400 italic">
            <strong>Note:</strong> Demo content is clearly labeled with &quot;DEMO&quot; and &quot;SIMULATION&quot;
            markers. It showcases the platform&apos;s full intelligence stack without affecting real operational data.
          </p>
        </div>
      </section>
    </div>
  );
}
