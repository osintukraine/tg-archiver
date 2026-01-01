'use client';

import { createContext, useContext, useState, useEffect, ReactNode, useCallback } from 'react';
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

export function ContentWarningProvider({ children }: { children: ReactNode }) {
  const pathname = usePathname();
  const [hasConsent, setHasConsent] = useState(false);
  const [isChecking, setIsChecking] = useState(true);

  // Get config (this runs on every render but is cheap)
  const config = getContentWarningConfig();

  // Check localStorage for existing consent on mount
  useEffect(() => {
    if (!config.enabled) {
      setIsChecking(false);
      setHasConsent(true); // Feature disabled = implicit consent
      return;
    }

    try {
      const stored = localStorage.getItem(CONSENT_STORAGE_KEY);
      if (stored) {
        const consent: ConsentData = JSON.parse(stored);
        const now = Date.now();

        if (consent.accepted && consent.expiresAt > now) {
          setHasConsent(true);
        } else {
          // Expired or invalid - clear it
          localStorage.removeItem(CONSENT_STORAGE_KEY);
          setHasConsent(false);
        }
      }
    } catch (err) {
      // localStorage might be disabled or data corrupted
      console.warn('[ContentWarning] Failed to read consent from localStorage:', err);
      setHasConsent(false);
    }

    setIsChecking(false);
  }, [config.enabled]);

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

    setHasConsent(true);
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
