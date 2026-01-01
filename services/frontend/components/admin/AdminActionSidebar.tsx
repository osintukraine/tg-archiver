'use client';

import { useState, useEffect, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import { useAuth } from '@/contexts/AuthContext';
import { adminApi } from '@/lib/admin-api';
import { ConfirmActionModal } from './modals/ConfirmActionModal';
import { ChangeTopicModal } from './modals/ChangeTopicModal';
import { ChangeImportanceModal } from './modals/ChangeImportanceModal';
import { GeolocationModal } from './modals/GeolocationModal';
import { LinkEventModal } from './modals/LinkEventModal';
import { AdminNoteModal } from './modals/AdminNoteModal';

/**
 * AdminActionSidebar
 *
 * Floating sidebar panel for admin moderation actions on message pages.
 * Only visible to admin users on /messages/[id] pages.
 */

interface MessageActionInfo {
  message_id: number;
  is_hidden: boolean;
  is_deleted: boolean;
  is_spam: boolean;
  topic_override: string | null;
  importance_override: string | null;
  admin_notes: string | null;
  has_location: boolean;
  primary_event_id: number | null;
  history: Array<{
    action: string;
    performed_by: string | null;
    performed_at: string;
    details: Record<string, unknown>;
  }>;
}

interface ActionResult {
  success: boolean;
  message_id: number;
  action: string;
  previous_value: string | null;
  new_value: string | null;
  audit_id: number;
}

type ModalType = 'confirm' | 'topic' | 'importance' | 'geolocation' | 'event' | 'note' | null;

interface ConfirmModalConfig {
  title: string;
  message: string;
  action: string;
  requireReason: boolean;
  variant: 'danger' | 'warning' | 'info';
}

export function AdminActionSidebar() {
  const pathname = usePathname();
  const { isAdmin, isLoading: authLoading } = useAuth();

  // Panel state
  const [isExpanded, setIsExpanded] = useState(false);
  const [messageId, setMessageId] = useState<number | null>(null);
  const [info, setInfo] = useState<MessageActionInfo | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  // Modal state
  const [activeModal, setActiveModal] = useState<ModalType>(null);
  const [confirmConfig, setConfirmConfig] = useState<ConfirmModalConfig | null>(null);
  const [pendingAction, setPendingAction] = useState<string | null>(null);

  // Extract message ID from pathname
  useEffect(() => {
    const match = pathname?.match(/^\/messages\/(\d+)/);
    if (match) {
      setMessageId(parseInt(match[1], 10));
    } else {
      setMessageId(null);
      setInfo(null);
      setIsExpanded(false);
    }
  }, [pathname]);

  // Fetch message action info when expanded
  const fetchInfo = useCallback(async () => {
    if (!messageId) return;

    setLoading(true);
    setError(null);
    try {
      const data = await adminApi.get(`/api/admin/messages/${messageId}/actions`);
      setInfo(data);
    } catch (err) {
      setError('Failed to load message info');
      console.error(err);
    } finally {
      setLoading(false);
    }
  }, [messageId]);

  useEffect(() => {
    if (isExpanded && messageId) {
      fetchInfo();
    }
  }, [isExpanded, messageId, fetchInfo]);

  // Clear success message after 3 seconds
  useEffect(() => {
    if (successMessage) {
      const timer = setTimeout(() => setSuccessMessage(null), 3000);
      return () => clearTimeout(timer);
    }
  }, [successMessage]);

  // Don't render if not admin or not on message page
  if (authLoading || !isAdmin() || !messageId) {
    return null;
  }

  // Execute action
  const executeAction = async (endpoint: string, body?: Record<string, unknown>) => {
    setLoading(true);
    setError(null);
    try {
      const result: ActionResult = await adminApi.post(
        `/api/admin/messages/${messageId}/${endpoint}`,
        body || {}
      );
      setSuccessMessage(`Action completed: ${result.action}`);
      await fetchInfo(); // Refresh state
      setActiveModal(null);
      setConfirmConfig(null);
      setPendingAction(null);
    } catch (err: unknown) {
      const message = (err as { message?: string })?.message || 'Action failed';
      setError(message);
    } finally {
      setLoading(false);
    }
  };

  // Quick action handlers (show confirmation)
  const showConfirmModal = (config: ConfirmModalConfig, action: string) => {
    setConfirmConfig(config);
    setPendingAction(action);
    setActiveModal('confirm');
  };

  const handleHide = () => {
    if (info?.is_hidden) {
      executeAction('unhide');
    } else {
      showConfirmModal({
        title: 'Hide Message',
        message: 'This message will be hidden from public view but remain in the database. You can unhide it later.',
        action: 'hide',
        requireReason: true,
        variant: 'warning',
      }, 'hide');
    }
  };

  const handleDelete = () => {
    showConfirmModal({
      title: 'Delete Message',
      message: 'This message will be soft-deleted. It can be recovered by a database admin if needed.',
      action: 'delete',
      requireReason: true,
      variant: 'danger',
    }, 'delete');
  };

  const handleSpam = () => {
    if (info?.is_spam) {
      executeAction('unspam');
    } else {
      showConfirmModal({
        title: 'Mark as Spam',
        message: 'This will override the AI spam classification and mark the message as spam.',
        action: 'spam',
        requireReason: true,
        variant: 'warning',
      }, 'spam');
    }
  };

  const handleQuarantine = () => {
    showConfirmModal({
      title: 'Quarantine Message',
      message: 'This message will be moved to the quarantine queue for off-topic review and removed from the main archive.',
      action: 'quarantine',
      requireReason: true,
      variant: 'danger',
    }, 'quarantine');
  };

  const handleReprocess = () => {
    showConfirmModal({
      title: 'Reprocess Message',
      message: 'This message will be queued for AI reprocessing with the current classification model.',
      action: 'reprocess',
      requireReason: false,
      variant: 'info',
    }, 'reprocess');
  };

  const handleConfirmAction = (reason?: string) => {
    if (!pendingAction) return;
    executeAction(pendingAction, reason ? { reason } : undefined);
  };

  // Format relative time
  const formatRelativeTime = (dateStr: string) => {
    const date = new Date(dateStr);
    const now = new Date();
    const diffMs = now.getTime() - date.getTime();
    const diffMins = Math.floor(diffMs / 60000);

    if (diffMins < 1) return 'just now';
    if (diffMins < 60) return `${diffMins}m ago`;
    const diffHours = Math.floor(diffMins / 60);
    if (diffHours < 24) return `${diffHours}h ago`;
    const diffDays = Math.floor(diffHours / 24);
    return `${diffDays}d ago`;
  };

  // Format action name for display
  const formatActionName = (action: string) => {
    return action
      .replace('message.', '')
      .replace(/_/g, ' ')
      .replace(/\b\w/g, l => l.toUpperCase());
  };

  return (
    <>
      {/* Collapsed Tab */}
      {!isExpanded && (
        <button
          onClick={() => setIsExpanded(true)}
          className="fixed right-0 top-1/2 -translate-y-1/2 z-50 bg-red-600 hover:bg-red-700 text-white px-2 py-4 rounded-l-lg shadow-lg transition-colors"
          title="Open Admin Actions"
        >
          <div className="flex flex-col items-center gap-1">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
            </svg>
            <span className="text-xs font-medium writing-mode-vertical" style={{ writingMode: 'vertical-rl' }}>
              Admin
            </span>
          </div>
        </button>
      )}

      {/* Expanded Panel */}
      {isExpanded && (
        <div className="fixed right-0 top-0 h-full w-80 bg-bg-base border-l border-border shadow-2xl z-50 flex flex-col">
          {/* Header */}
          <div className="flex items-center justify-between p-4 border-b border-border bg-red-600 text-white">
            <div>
              <h2 className="font-semibold">Admin Actions</h2>
              <p className="text-sm opacity-90">Message #{messageId}</p>
            </div>
            <button
              onClick={() => setIsExpanded(false)}
              className="p-1 hover:bg-red-700 rounded transition-colors"
              title="Close panel"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Content */}
          <div className="flex-1 overflow-y-auto p-4 space-y-6">
            {/* Status Messages */}
            {error && (
              <div className="bg-red-500/20 border border-red-500/30 text-red-400 px-3 py-2 rounded text-sm">
                {error}
              </div>
            )}
            {successMessage && (
              <div className="bg-green-500/20 border border-green-500/30 text-green-400 px-3 py-2 rounded text-sm">
                {successMessage}
              </div>
            )}

            {loading && !info ? (
              <div className="text-center text-text-secondary py-8">Loading...</div>
            ) : (
              <>
                {/* Current State Badges */}
                {info && (
                  <div className="flex flex-wrap gap-2">
                    {info.is_hidden && (
                      <span className="px-2 py-1 bg-yellow-500/20 text-yellow-400 text-xs rounded">Hidden</span>
                    )}
                    {info.is_deleted && (
                      <span className="px-2 py-1 bg-red-500/20 text-red-400 text-xs rounded">Deleted</span>
                    )}
                    {info.is_spam && (
                      <span className="px-2 py-1 bg-orange-500/20 text-orange-400 text-xs rounded">Spam</span>
                    )}
                    {info.topic_override && (
                      <span className="px-2 py-1 bg-blue-500/20 text-blue-400 text-xs rounded">
                        Topic: {info.topic_override}
                      </span>
                    )}
                    {info.importance_override && (
                      <span className="px-2 py-1 bg-purple-500/20 text-purple-400 text-xs rounded">
                        Importance: {info.importance_override}
                      </span>
                    )}
                  </div>
                )}

                {/* Moderation Section */}
                <section>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3">
                    Moderation
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      icon="👁"
                      label={info?.is_hidden ? 'Unhide' : 'Hide'}
                      onClick={handleHide}
                      active={info?.is_hidden}
                      disabled={loading || info?.is_deleted}
                    />
                    <ActionButton
                      icon="🗑"
                      label="Delete"
                      onClick={handleDelete}
                      variant="danger"
                      disabled={loading || info?.is_deleted}
                    />
                    <ActionButton
                      icon="🚫"
                      label={info?.is_spam ? 'Unspam' : 'Spam'}
                      onClick={handleSpam}
                      active={info?.is_spam}
                      disabled={loading}
                    />
                    <ActionButton
                      icon="⚠️"
                      label="Quarantine"
                      onClick={handleQuarantine}
                      variant="warning"
                      disabled={loading || info?.is_deleted}
                    />
                    <ActionButton
                      icon="📝"
                      label="Note"
                      onClick={() => setActiveModal('note')}
                      active={!!info?.admin_notes}
                      disabled={loading}
                      className="col-span-2"
                    />
                  </div>
                </section>

                {/* Classification Section */}
                <section>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3">
                    Classification
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      icon="🏷"
                      label="Topic"
                      onClick={() => setActiveModal('topic')}
                      active={!!info?.topic_override}
                      disabled={loading}
                    />
                    <ActionButton
                      icon="⭐"
                      label="Importance"
                      onClick={() => setActiveModal('importance')}
                      active={!!info?.importance_override}
                      disabled={loading}
                    />
                    <ActionButton
                      icon="🔄"
                      label="Reprocess"
                      onClick={handleReprocess}
                      disabled={loading}
                      className="col-span-2"
                    />
                  </div>
                </section>

                {/* Geolocation Section */}
                <section>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3">
                    Geolocation
                  </h3>
                  <div className="grid grid-cols-2 gap-2">
                    <ActionButton
                      icon="📍"
                      label={info?.has_location ? 'Edit Location' : 'Add Location'}
                      onClick={() => setActiveModal('geolocation')}
                      active={info?.has_location}
                      disabled={loading}
                      className="col-span-2"
                    />
                  </div>
                </section>

                {/* Events Section */}
                <section>
                  <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3">
                    Events
                  </h3>
                  <div className="grid grid-cols-1 gap-2">
                    <ActionButton
                      icon="🔗"
                      label={info?.primary_event_id ? `Linked: Event #${info.primary_event_id}` : 'Link to Event'}
                      onClick={() => setActiveModal('event')}
                      active={!!info?.primary_event_id}
                      disabled={loading}
                    />
                  </div>
                </section>

                {/* Action History */}
                {info?.history && info.history.length > 0 && (
                  <section>
                    <h3 className="text-xs font-medium text-text-tertiary uppercase tracking-wide mb-3">
                      Recent Actions
                    </h3>
                    <div className="space-y-2">
                      {info.history.slice(0, 5).map((item, idx) => (
                        <div key={idx} className="text-xs text-text-secondary border-l-2 border-border pl-2">
                          <div className="font-medium text-text-primary">
                            {formatActionName(item.action)}
                          </div>
                          <div className="text-text-tertiary">
                            {formatRelativeTime(item.performed_at)}
                          </div>
                        </div>
                      ))}
                    </div>
                  </section>
                )}
              </>
            )}
          </div>
        </div>
      )}

      {/* Modals */}
      {activeModal === 'confirm' && confirmConfig && (
        <ConfirmActionModal
          isOpen={true}
          onClose={() => {
            setActiveModal(null);
            setConfirmConfig(null);
            setPendingAction(null);
          }}
          onConfirm={handleConfirmAction}
          title={confirmConfig.title}
          message={confirmConfig.message}
          requireReason={confirmConfig.requireReason}
          variant={confirmConfig.variant}
          loading={loading}
        />
      )}

      {activeModal === 'topic' && (
        <ChangeTopicModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSubmit={(topic, reason) => executeAction('topic', { topic, reason })}
          currentTopic={info?.topic_override}
          loading={loading}
        />
      )}

      {activeModal === 'importance' && (
        <ChangeImportanceModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSubmit={(importance, reason) => executeAction('importance', { importance, reason })}
          currentImportance={info?.importance_override}
          loading={loading}
        />
      )}

      {activeModal === 'geolocation' && messageId && (
        <GeolocationModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSubmit={(lat, lng, name, reason) =>
            executeAction('geolocation', { latitude: lat, longitude: lng, location_name: name, reason })
          }
          onRemove={() => adminApi.delete(`/api/admin/messages/${messageId}/geolocation`).then(() => {
            setSuccessMessage('Location removed');
            fetchInfo();
            setActiveModal(null);
          })}
          hasExisting={info?.has_location || false}
          loading={loading}
        />
      )}

      {activeModal === 'event' && messageId && (
        <LinkEventModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSubmit={(eventId, reason) => executeAction('link-event', { event_id: eventId, reason })}
          onUnlink={() => adminApi.delete(`/api/admin/messages/${messageId}/link-event`).then(() => {
            setSuccessMessage('Event unlinked');
            fetchInfo();
            setActiveModal(null);
          })}
          currentEventId={info?.primary_event_id}
          loading={loading}
        />
      )}

      {activeModal === 'note' && (
        <AdminNoteModal
          isOpen={true}
          onClose={() => setActiveModal(null)}
          onSubmit={(note) => executeAction('note', { note })}
          currentNote={info?.admin_notes}
          loading={loading}
        />
      )}
    </>
  );
}

// Action Button Component
interface ActionButtonProps {
  icon: string;
  label: string;
  onClick: () => void;
  variant?: 'default' | 'danger' | 'warning';
  active?: boolean;
  disabled?: boolean;
  className?: string;
}

function ActionButton({
  icon,
  label,
  onClick,
  variant = 'default',
  active = false,
  disabled = false,
  className = '',
}: ActionButtonProps) {
  const baseClasses = 'flex items-center gap-2 px-3 py-2 rounded-lg text-sm font-medium transition-colors';

  const variantClasses = {
    default: active
      ? 'bg-blue-500/20 text-blue-400 border border-blue-500/30'
      : 'bg-bg-secondary hover:bg-bg-tertiary text-text-secondary border border-border',
    danger: 'bg-red-500/20 text-red-400 hover:bg-red-500/30 border border-red-500/30',
    warning: 'bg-yellow-500/20 text-yellow-400 hover:bg-yellow-500/30 border border-yellow-500/30',
  };

  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className={`${baseClasses} ${variantClasses[variant]} ${className} ${disabled ? 'opacity-50 cursor-not-allowed' : ''}`}
    >
      <span>{icon}</span>
      <span>{label}</span>
    </button>
  );
}
