'use client';

import { useState, useEffect } from 'react';

interface AdminNoteModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSubmit: (note: string) => void;
  currentNote?: string | null;
  loading?: boolean;
}

export function AdminNoteModal({
  isOpen,
  onClose,
  onSubmit,
  currentNote,
  loading = false,
}: AdminNoteModalProps) {
  const [note, setNote] = useState(currentNote || '');

  // Reset form when modal opens with new data
  useEffect(() => {
    if (isOpen) {
      setNote(currentNote || '');
    }
  }, [isOpen, currentNote]);

  if (!isOpen) return null;

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    onSubmit(note);
  };

  const hasChanges = note !== (currentNote || '');

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/60" onClick={onClose} />

      {/* Modal */}
      <div className="relative bg-bg-base border border-border rounded-xl shadow-2xl w-full max-w-lg">
        <form onSubmit={handleSubmit}>
          {/* Header */}
          <div className="p-4 border-b border-border">
            <h3 className="text-lg font-semibold text-text-primary">
              {currentNote ? 'Edit Admin Note' : 'Add Admin Note'}
            </h3>
            <p className="text-sm text-text-secondary mt-1">
              Add internal notes about this message (only visible to admins)
            </p>
          </div>

          {/* Content */}
          <div className="p-4 space-y-4">
            <div>
              <label htmlFor="admin-note" className="block text-sm font-medium text-text-primary mb-1">
                Note
              </label>
              <textarea
                id="admin-note"
                value={note}
                onChange={(e) => setNote(e.target.value)}
                placeholder="Enter your admin notes here...&#10;&#10;Examples:&#10;- Verified location via external source&#10;- Contains sensitive information&#10;- Follow up with analyst team"
                className="w-full px-3 py-2 bg-bg-secondary border border-border rounded-lg text-text-primary placeholder-text-tertiary focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono text-sm"
                rows={8}
              />
              <div className="flex justify-between mt-1 text-xs text-text-tertiary">
                <span>Markdown supported</span>
                <span>{note.length} characters</span>
              </div>
            </div>

            {/* Quick Templates */}
            <div>
              <div className="text-sm font-medium text-text-secondary mb-2">Quick Templates</div>
              <div className="flex flex-wrap gap-2">
                {[
                  { label: '✓ Verified', text: '✓ Verified via external source: ' },
                  { label: '⚠️ Sensitive', text: '⚠️ Contains sensitive information - ' },
                  { label: '🔍 Review', text: '🔍 Needs review: ' },
                  { label: '📍 Location', text: '📍 Location confirmed: ' },
                  { label: '🔗 Source', text: '🔗 Original source: ' },
                ].map((template) => (
                  <button
                    key={template.label}
                    type="button"
                    onClick={() => setNote((prev) => prev + template.text)}
                    className="px-2 py-1 text-xs bg-bg-secondary border border-border rounded hover:bg-bg-tertiary text-text-secondary transition-colors"
                  >
                    {template.label}
                  </button>
                ))}
              </div>
            </div>
          </div>

          {/* Footer */}
          <div className="p-4 border-t border-border flex justify-between items-center">
            <div className="text-xs text-text-tertiary">
              {currentNote && (
                <button
                  type="button"
                  onClick={() => setNote('')}
                  className="text-red-400 hover:text-red-300"
                >
                  Clear note
                </button>
              )}
            </div>
            <div className="flex gap-3">
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
                disabled={loading || !hasChanges}
                className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg transition-colors disabled:opacity-50"
              >
                {loading ? 'Saving...' : 'Save Note'}
              </button>
            </div>
          </div>
        </form>
      </div>
    </div>
  );
}
