'use client';

import { createContext, useContext, useEffect, useSyncExternalStore, ReactNode, useCallback } from 'react';
import { usePathname } from 'next/navigation';
import {
  getContentWarningConfig,
  isRouteExempt,
  CONSENT_STORAGE_KEY,
  ConsentData,
  ContentWarningTheme,
} from '@/lib/content-warning-config';

export interface ContentWarningContextType {
  /** Whether the content warning feature is enabled */
  isEnabled: boolean;
  /** Whether the user has given valid (non-expired) consent */
  hasConsent: boolean;
  /** Whether we're still checking consent status */
  isChecking: boolean;
  /** Whether the modal should be shown */
  shouldShowModal: boolean;
  /** The theme configuration for the modal */
  theme: ContentWarningTheme;
  /** Accept the content warning and store consent */
  acceptWarning: () => void;
}

const ContentWarningContext = createContext<ContentWarningContextType | undefined>(undefined);

// Consent lives in localStorage (external to React), so read it via useSyncExternalStore.
const consentListeners = new Set<() => void>();
let hasSessionConsent = false; // fallback when localStorage is unavailable

const subscribeConsent = (listener: () => void) => {
  consentListeners.add(listener);
  return () => {
    consentListeners.delete(listener);
  };
};
const subscribeNoop = () => () => {};

function readStoredConsent(): boolean {
  if (hasSessionConsent) return true;
  try {
    const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
    if (!stored) return false;
    const consent: ConsentData = JSON.parse(stored);
    return Boolean(consent.accepted) && consent.expiresAt > Date.now();
  } catch (err) {
    // localStorage might be disabled or data corrupted
    console.warn('[ContentWarning] Failed to read consent from localStorage:', err);
    return false;
  }
}

export function ContentWarningProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();

  // Get config (this runs on every render but is cheap)
  const config = getContentWarningConfig();

  // false on the server and during hydration, true afterwards
  const isChecking = useSyncExternalStore(subscribeNoop, () => false, () => true);
  const storedConsent = useSyncExternalStore(subscribeConsent, readStoredConsent, () => false);
  // Feature disabled = implicit consent
  const hasConsent = !config.enabled || storedConsent;

  // Clear expired or invalid consent from localStorage
  useEffect(() => {
    if (!config.enabled || storedConsent) return;
    try {
      localStorage.removeItem(CONSENT_STORAGE_KEY);
    } catch {
      // ignore
    }
  }, [config.enabled, storedConsent]);

  const acceptWarning = useCallback(() => {
    const now = Date.now();
    const expiresAt = now + config.durationDays * 24 * 60 * 60 * 1000;

    const consent: ConsentData = {
      accepted: true,
      timestamp: now,
      expiresAt,
    };

    try {
      localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));
    } catch (err) {
      // localStorage might be full or disabled - still allow access for this session
      console.warn('[ContentWarning] Failed to store consent in localStorage:', err);
    }

    hasSessionConsent = true;
    consentListeners.forEach((listener) => listener());
  }, [config.durationDays]);

  // Determine if modal should show
  const isExempt = isRouteExempt(pathname);
  const shouldShowModal = config.enabled && !hasConsent && !isChecking && !isExempt;

  const value: ContentWarningContextType = {
    isEnabled: config.enabled,
    hasConsent,
    isChecking,
    shouldShowModal,
    theme: config.theme,
    acceptWarning,
  };

  return (
    <ContentWarningContext.Provider value={value}>
      {children}
    </ContentWarningContext.Provider>
  );
}

export function useContentWarning() {
  const context = useContext(ContentWarningContext);
  if (!context) {
    throw new Error('useContentWarning must be used within ContentWarningProvider');
  }
  return context;
}

export { ContentWarningContext };
