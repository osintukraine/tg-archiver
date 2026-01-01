// components/about/ServiceDetailPanel.tsx

import React from 'react';
import { X } from 'lucide-react';

interface ServiceDetail {
  [key: string]: string;
}

interface ServiceDetailPanelProps {
  serviceName: string;
  description: string;
  details: ServiceDetail;
  onClose: () => void;
}

/**
 * ServiceDetailPanel - Expandable detail panel for services
 *
 * Shows comprehensive service information when user clicks expandable node.
 * Used for services with osint.graph.expandable=true (Processor, Enricher, API, etc.)
 */
export default function ServiceDetailPanel({
  serviceName,
  description,
  details,
  onClose,
}: ServiceDetailPanelProps) {
  // Parse special detail formats
  const parseDetailValue = (key: string, value: string) => {
    // Stage format: "Stage Name|Detail|Description"
    if (key.startsWith('stage')) {
      const parts = value.split('|');
      return (
        <div className="flex items-start gap-2 p-2 bg-gray-50 dark:bg-gray-800 rounded">
          <div className="flex-shrink-0 w-6 h-6 rounded-full bg-indigo-100 dark:bg-indigo-900 text-indigo-600 dark:text-indigo-300 flex items-center justify-center text-xs font-semibold">
            {key.replace('stage', '')}
          </div>
          <div className="flex-1">
            <div className="font-medium text-sm text-gray-900 dark:text-gray-100">
              {parts[0]}
            </div>
            {parts[1] && (
              <div className="text-xs text-gray-600 dark:text-gray-400">
                {parts[1]}
              </div>
            )}
            {parts[2] && (
              <div className="text-xs text-gray-500 dark:text-gray-500">
                {parts[2]}
              </div>
            )}
          </div>
        </div>
      );
    }

    // Default: key-value display
    return (
      <div className="flex justify-between items-start gap-4">
        <span className="text-sm font-medium text-gray-600 dark:text-gray-400 capitalize">
          {key.replace(/_/g, ' ')}:
        </span>
        <span className="text-sm text-gray-900 dark:text-gray-100 text-right">
          {value}
        </span>
      </div>
    );
  };

  // Group details by category
  const stages = Object.entries(details).filter(([key]) => key.startsWith('stage'));
  const otherDetails = Object.entries(details).filter(([key]) => !key.startsWith('stage'));

  return (
    <div className="fixed inset-0 bg-black/50 dark:bg-black/70 flex items-center justify-center z-50 p-4">
      <div className="bg-white dark:bg-gray-900 rounded-lg shadow-2xl max-w-2xl w-full max-h-[80vh] overflow-hidden flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between p-6 border-b border-gray-200 dark:border-gray-700">
          <h2 className="text-2xl font-bold text-gray-900 dark:text-gray-100">
            {serviceName}
          </h2>
          <button
            onClick={onClose}
            className="p-2 hover:bg-gray-100 dark:hover:bg-gray-800 rounded-lg transition-colors"
            aria-label="Close"
          >
            <X className="w-5 h-5 text-gray-500 dark:text-gray-400" />
          </button>
        </div>

        {/* Content */}
        <div className="flex-1 overflow-y-auto p-6 space-y-6">
          {/* Description */}
          <div>
            <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-2">
              Description
            </h3>
            <p className="text-gray-700 dark:text-gray-300 leading-relaxed">
              {description}
            </p>
          </div>

          {/* Stages (if any) */}
          {stages.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Pipeline Stages
              </h3>
              <div className="space-y-2">
                {stages.map(([key, value]) => (
                  <div key={key}>{parseDetailValue(key, value)}</div>
                ))}
              </div>
            </div>
          )}

          {/* Other Details */}
          {otherDetails.length > 0 && (
            <div>
              <h3 className="text-sm font-semibold text-gray-500 dark:text-gray-400 uppercase tracking-wide mb-3">
                Technical Details
              </h3>
              <div className="space-y-3 bg-gray-50 dark:bg-gray-800 rounded-lg p-4">
                {otherDetails.map(([key, value]) => (
                  <div key={key}>{parseDetailValue(key, value)}</div>
                ))}
              </div>
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="border-t border-gray-200 dark:border-gray-700 p-4 bg-gray-50 dark:bg-gray-800">
          <p className="text-xs text-gray-500 dark:text-gray-400 text-center">
            Click outside or press ESC to close
          </p>
        </div>
      </div>
    </div>
  );
}
