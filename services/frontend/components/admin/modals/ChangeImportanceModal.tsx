'use client';

import { useState } from 'react';

const IMPORTANCE_LEVELS = [
  {
    value: 'high',
    label: 'High Priority',
    icon: '🔴',
    description: 'Critical intel, breaking news, significant events',
    color: 'red',
  },
  {
    value: 'medium',
    label: 'Medium Priority',
    icon: '🟡',
    description: 'Notable updates, important context',
    color: 'yellow',
  },
  {
    value: 'low',
    label: 'Low Priority',
    icon: '⚪',
    description: 'Background info, minor updates',
    color: 'gray',
  },
];

interface ChangeImportanceModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (importance: string, reason?: string) => void;
  currentImportance: string | null | undefined;
  loading?: boolean;
}

export function ChangeImportanceModal({
  isOpen,
  onClose,
  onSubmit,
  currentImportance,
  loading = false,
}: ChangeImportanceModalProps) {
  const [selectedImportance, setSelectedImportance] = useState(currentImportance || '');
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedImportance) {
      onSubmit(selectedImportance, reason || undefined);
    }
  };

  const getColorClasses = (color: string, selected: boolean) => {
    if (!selected) return 'bg-bg-secondary border-border hover:bg-bg-tertiary text-text-secondary';

    const colors: Record<string, string> = {
      red: 'bg-red-500/20 border-red-500/50 text-red-400',
      yellow: 'bg-yellow-500/20 border-yellow-500/50 text-yellow-400',
      gray: 'bg-gray-500/20 border-gray-500/50 text-gray-400',
    };
    return colors[color] || colors.gray;
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-md">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary">Change Importance</h3>
            <p className="text-sm text-text-secondary mt-1">
              Override the AI-assigned importance level
            </p>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            <div className="space-y-2">
              {IMPORTANCE_LEVELS.map((level) => (
                <button
                  key={level.value}
                  type="button"
                  onClick={() => setSelectedImportance(level.value)}
                  className={`w-full p-4 rounded-lg border text-left transition-colors ${getColorClasses(
                    level.color,
                    selectedImportance === level.value
                  )}`}
                >
                  <div className="flex items-center gap-3">
                    <span className="text-2xl">{level.icon}</span>
                    <div>
                      <div className="font-medium">{level.label}</div>
                      <div className="text-xs opacity-70">{level.description}</div>
                    </div>
                  </div>
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="importance-reason" className="block text-sm font-medium text-text-primary mb-1">
                Reason (optional)
              </label>
              <textarea
                id="importance-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this importance level more accurate?"
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500"
                rows={2}
              />
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-end gap-3">
            <button
              type="button"
              onClick={onClose}
              disabled={loading}
              className="px-4 py-2 bg-bg-secondary hover:bg-bg-tertiary text-text-secondary rounded-lg transition-colors"
            >
              Cancel
            </button>
            <button
              type="submit"
              disabled={loading || !selectedImportance}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Importance'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
