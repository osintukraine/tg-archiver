// services/frontend-nextjs/components/Footer.tsx

import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';
import {
  Globe,
  Shield,
  Search,
  Map,
  Users,
  Radio,
  Database,
  FileText,
  Rss,
  Code,
  MessageSquarePlus,
} from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 mt-12 bg-white dark:bg-gray-900">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-8">
          {/* About Section */}
          <div className="lg:col-span-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {SITE_NAME}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Production-grade platform for archiving and analyzing Telegram intelligence
              with AI-powered enrichment. Self-hosted, no external dependencies.
            </p>
            <p className="text-xs text-gray-500 dark:text-gray-500 italic">
              Archiving Telegram since Feb 24, 2022
            </p>
          </div>

          {/* Explore Section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 uppercase tracking-wider mb-4">
              Explore
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/search"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  Search Messages
                </Link>
              </li>
              <li>
                <Link
                  href="/map"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Map className="w-4 h-4" />
                  Geolocation Map
                </Link>
              </li>
              <li>
                <Link
                  href="/channels"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Channels
                </Link>
              </li>
              <li>
                <Link
                  href="/events"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                >
                  <Radio className="w-4 h-4" />
                  Events
                </Link>
              </li>
            </ul>
          </div>

          {/* Demo Messages Section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 uppercase tracking-wider mb-4">
              Demo Content
            </h4>
            <ul className="space-y-2">
              <li>
                <Link
                  href="/messages/579"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                >
                  <Shield className="w-4 h-4" />
                  Full Intelligence Stack
                </Link>
              </li>
              <li>
                <Link
                  href="/messages/580"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <Radio className="w-4 h-4" />
                  Forward Chain Demo
                </Link>
              </li>
              <li>
                <Link
                  href="/messages/581"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Entity Relations
                </Link>
              </li>
              <li>
                <Link
                  href="/messages/582"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  EW Analysis
                </Link>
              </li>
              <li>
                <Link
                  href="/messages/583"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <Globe className="w-4 h-4" />
                  Media Archival
                </Link>
              </li>
              <li>
                <Link
                  href="/messages/585"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 transition-colors"
                >
                  <Search className="w-4 h-4" />
                  Low Importance Test
                </Link>
              </li>
            </ul>
          </div>

          {/* Resources Section */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 uppercase tracking-wider mb-4">
              Resources
            </h4>
            <ul className="space-y-3">
              <li>
                <Link
                  href="/about"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  About Platform
                </Link>
              </li>
              <li>
                <Link
                  href="/about?tab=architecture"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-cyan-600 dark:hover:text-cyan-400 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  Architecture
                </Link>
              </li>
              <li>
                <Link
                  href="/unified"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-orange-600 dark:hover:text-orange-400 transition-colors"
                >
                  <Rss className="w-4 h-4" />
                  Unified Stream
                </Link>
              </li>
              <li>
                <a
                  href="/docs"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                >
                  <Code className="w-4 h-4" />
                  API Docs (Swagger)
                </a>
              </li>
              <li>
                <a
                  href="/redoc"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-purple-600 dark:hover:text-purple-400 transition-colors"
                >
                  <Code className="w-4 h-4" />
                  API Docs (ReDoc)
                </a>
              </li>
              <li>
                <a
                  href="/platform-docs/"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  Platform Docs
                </a>
              </li>
              <li>
                <Link
                  href="/auth/login"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Login
                </Link>
              </li>
              <li>
                <Link
                  href="/suggest-channel"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
                >
                  <MessageSquarePlus className="w-4 h-4" />
                  Suggest a Channel
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      {/* Bottom Bar */}
      <div className="border-t border-gray-200 dark:border-gray-800 bg-gray-50 dark:bg-gray-950">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-4">
          <div className="flex flex-col sm:flex-row justify-between items-center gap-2">
            <p className="text-xs text-gray-500 dark:text-gray-500">
              Supporting Ukraine through open-source intelligence. 🇺🇦
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
              <span>PostgreSQL + pgvector</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span>Self-hosted LLM</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span>DeepL Translation</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
