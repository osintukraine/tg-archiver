'use client';

import { useState, useEffect } from 'react';
import { useTopics, Topic } from '@/lib/hooks/useTopics';

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
  const { topics, loading: topicsLoading } = useTopics();
  const [selectedTopic, setSelectedTopic] = useState(currentTopic || '');
  const [reason, setReason] = useState('');

  // Reset selected topic when modal opens with new currentTopic
  useEffect(() => {
    if (isOpen) {
      setSelectedTopic(currentTopic || '');
      setReason('');
    }
  }, [isOpen, currentTopic]);

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
              Categorize this message with a topic
            </p>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-4">
            {topicsLoading ? (
              <div className="text-center text-text-secondary py-4">Loading topics...</div>
            ) : topics.length === 0 ? (
              <div className="text-center text-text-secondary py-4">
                No topics configured. Create topics in Admin &gt; Topics.
              </div>
            ) : (
              <div className="grid grid-cols-2 gap-2">
                {topics.map((topic) => (
                  <button
                    key={topic.name}
                    type="button"
                    onClick={() => setSelectedTopic(topic.name)}
                    className={`p-3 rounded-lg border text-left transition-colors ${
                      selectedTopic === topic.name
                        ? 'bg-blue-500/20 border-blue-500/50 text-blue-400'
                        : 'bg-bg-secondary border-border hover:bg-bg-tertiary text-text-secondary'
                    }`}
                  >
                    <div className="font-medium text-sm">{topic.label}</div>
                    {topic.description && (
                      <div className="text-xs opacity-70">{topic.description}</div>
                    )}
                  </button>
                ))}
              </div>
            )}

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
              disabled={loading || !selectedTopic || topicsLoading}
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
