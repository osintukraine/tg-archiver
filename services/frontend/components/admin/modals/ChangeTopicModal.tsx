'use client';

import { useState } from 'react';

const TOPICS = [
  { value: 'combat', label: 'Combat', description: 'Active fighting, battles, strikes' },
  { value: 'equipment', label: 'Equipment', description: 'Weapons, vehicles, gear' },
  { value: 'casualties', label: 'Casualties', description: 'Losses, injuries, deaths' },
  { value: 'movements', label: 'Movements', description: 'Troop movements, logistics' },
  { value: 'infrastructure', label: 'Infrastructure', description: 'Buildings, bridges, utilities' },
  { value: 'humanitarian', label: 'Humanitarian', description: 'Aid, civilians, refugees' },
  { value: 'diplomatic', label: 'Diplomatic', description: 'Politics, negotiations, sanctions' },
  { value: 'intelligence', label: 'Intelligence', description: 'Intel reports, analysis' },
  { value: 'propaganda', label: 'Propaganda', description: 'Information warfare, narratives' },
  { value: 'units', label: 'Units', description: 'Military units, organizations' },
  { value: 'locations', label: 'Locations', description: 'Places, geography' },
  { value: 'general', label: 'General', description: 'Other relevant content' },
];

interface ChangeTopicModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (topic: string, reason?: string) => void;
  currentTopic: string | null | undefined;
  loading?: boolean;
}

export function ChangeTopicModal({
  isOpen,
  onClose,
  onSubmit,
  currentTopic,
  loading = false,
}: ChangeTopicModalProps) {
  const [selectedTopic, setSelectedTopic] = useState(currentTopic || '');
  const [reason, setReason] = useState('');

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    if (selectedTopic) {
      onSubmit(selectedTopic, reason || undefined);
    }
  };

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-lg max-h-[80vh] overflow-hidden flex flex-col">
        <form onSubmit={handleSubmit} className="flex flex-col h-full">
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary">Change Topic</h3>
            <p className="text-sm text-text-secondary mt-1">
              Override the AI-assigned topic for this message
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            <div className="grid grid-cols-2 gap-2">
              {TOPICS.map((topic) => (
                <button
                  key={topic.value}
                  type="button"
                  onClick={() => setSelectedTopic(topic.value)}
                  className={`p-3 rounded-lg border text-left transition-colors ${
                    selectedTopic === topic.value
                      ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                      : 'bg-bg-secondary border-border hover:bg-bg-tertiary text-text-secondary'
                  }`}
                >
                  <div className="font-medium text-sm">{topic.label}</div>
                  <div className="text-xs opacity-70">{topic.description}</div>
                </button>
              ))}
            </div>

            <div>
              <label htmlFor="topic-reason" className="block text-sm font-medium text-text-primary mb-1">
                Reason (optional)
              </label>
              <textarea
                id="topic-reason"
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                placeholder="Why is this topic more accurate?"
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
              disabled={loading || !selectedTopic}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Saving...' : 'Save Topic'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
