// services/frontend/components/Footer.tsx

import Link from 'next/link';
import { SITE_NAME } from '@/lib/constants';
import {
  Search,
  Users,
  Database,
  FileText,
  Code,
} from 'lucide-react';

export function Footer() {
  return (
    <footer className="border-t border-gray-200 dark:border-gray-800 mt-12 bg-white dark:bg-gray-900">
      {/* Main Footer Content */}
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-12">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-8">
          {/* About Section */}
          <div className="lg:col-span-1">
            <h3 className="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">
              {SITE_NAME}
            </h3>
            <p className="text-sm text-gray-600 dark:text-gray-400 mb-4">
              Self-hosted Telegram channel archiver. Simple, reliable, and privacy-focused.
            </p>
          </div>

          {/* Navigation */}
          <div>
            <h4 className="text-sm font-semibold text-gray-900 dark:text-gray-200 uppercase tracking-wider mb-4">
              Navigation
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
                  href="/channels"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-pink-600 dark:hover:text-pink-400 transition-colors"
                >
                  <Users className="w-4 h-4" />
                  Channels
                </Link>
              </li>
              <li>
                <Link
                  href="/about"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <FileText className="w-4 h-4" />
                  About
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
                <a
                  href="/docs"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-green-600 dark:hover:text-green-400 transition-colors"
                >
                  <Code className="w-4 h-4" />
                  API Documentation
                </a>
              </li>
              <li>
                <Link
                  href="/admin"
                  className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                >
                  <Database className="w-4 h-4" />
                  Admin Panel
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
              Powered by tg-archiver
            </p>
            <div className="flex items-center gap-4 text-xs text-gray-500 dark:text-gray-500">
              <span>PostgreSQL</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span>MinIO</span>
              <span className="text-gray-300 dark:text-gray-700">|</span>
              <span>Next.js</span>
            </div>
          </div>
        </div>
      </div>
    </footer>
  );
}
