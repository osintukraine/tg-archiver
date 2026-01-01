'use client';

import { useState, useEffect, useRef } from 'react';
import { useContentWarning } from '@/contexts/ContentWarningContext';

/**
 * Content Warning Modal
 *
 * Full-screen modal that blocks access to content until user acknowledges
 * the age verification and content warning. Cannot be dismissed via
 * backdrop click or Escape key - only by checking the box and clicking Enter.
 */
export function ContentWarningModal() {
  const { shouldShowModal, theme, acceptWarning } = useContentWarning();
  const [isChecked, setIsChecked] = useState(false);
  const checkboxRef = useRef<HTMLInputElement>(null);
  const buttonRef = useRef<HTMLButtonElement>(null);

  // Focus management - focus checkbox when modal opens
  useEffect(() => {
    if (shouldShowModal && checkboxRef.current) {
      // Small delay to ensure modal is rendered
      const timer = setTimeout(() => {
        checkboxRef.current?.focus();
      }, 100);
      return () => clearTimeout(timer);
    }
  }, [shouldShowModal]);

  // Prevent body scroll when modal is open
  useEffect(() => {
    if (shouldShowModal) {
      document.body.style.overflow = 'hidden';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [shouldShowModal]);

  // Handle keyboard navigation
  const handleKeyDown = (e: React.KeyboardEvent) => {
    // Tab trap - keep focus within modal
    if (e.key === 'Tab') {
      const focusableElements = [checkboxRef.current, buttonRef.current].filter(Boolean);
      const firstElement = focusableElements[0];
      const lastElement = focusableElements[focusableElements.length - 1];

      if (e.shiftKey && document.activeElement === firstElement) {
        e.preventDefault();
        lastElement?.focus();
      } else if (!e.shiftKey && document.activeElement === lastElement) {
        e.preventDefault();
        firstElement?.focus();
      }
    }

    // Enter key on checkbox toggles it
    if (e.key === 'Enter' && document.activeElement === checkboxRef.current) {
      e.preventDefault();
      setIsChecked(!isChecked);
    }
  };

  const handleSubmit = () => {
    if (isChecked) {
      acceptWarning();
    }
  };

  if (!shouldShowModal) {
    return null;
  }

  return (
    <div
      className="fixed inset-0 z-[100] overflow-y-auto"
      role="dialog"
      aria-modal="true"
      aria-labelledby="content-warning-title"
      aria-describedby="content-warning-description"
      onKeyDown={handleKeyDown}
    >
      {/* Backdrop - no click handler (cannot dismiss) */}
      <div
        className="fixed inset-0 bg-black/70 backdrop-blur-md"
        aria-hidden="true"
      />

      {/* Modal container */}
      <div className="flex min-h-full items-center justify-center p-4">
        <div
          className="relative glass w-full max-w-lg p-8 space-y-6"
          onClick={(e) => e.stopPropagation()}
        >
          {/* Warning icon and title */}
          <div className="text-center space-y-3">
            <div className="inline-flex items-center justify-center w-16 h-16 rounded-full bg-amber-500/20 text-amber-400">
              <svg
                className="w-8 h-8"
                fill="none"
                viewBox="0 0 24 24"
                stroke="currentColor"
                strokeWidth={2}
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"
                />
              </svg>
            </div>
            <h1
              id="content-warning-title"
              className="text-2xl font-bold text-text-primary"
            >
              {theme.title}
            </h1>
          </div>

          {/* Divider */}
          <div className="border-t border-border-subtle" />

          {/* Description */}
          <div
            id="content-warning-description"
            className="text-text-secondary text-sm leading-relaxed space-y-4"
          >
            <p>{theme.intro}</p>

            {theme.bulletPoints.length > 0 && (
              <ul className="space-y-2 pl-1">
                {theme.bulletPoints.map((point, index) => (
                  <li key={index} className="flex items-start gap-2">
                    <span className="text-amber-400 mt-0.5">•</span>
                    <span>{point}</span>
                  </li>
                ))}
              </ul>
            )}

            <p>{theme.outro}</p>
          </div>

          {/* Divider */}
          <div className="border-t border-border-subtle" />

          {/* Checkbox */}
          <label className="flex items-start gap-3 cursor-pointer group">
            <input
              ref={checkboxRef}
              type="checkbox"
              checked={isChecked}
              onChange={(e) => setIsChecked(e.target.checked)}
              className="mt-1 w-5 h-5 rounded border-border bg-bg-secondary text-accent-primary focus:ring-accent-primary focus:ring-offset-0 cursor-pointer"
            />
            <span className="text-sm text-text-secondary group-hover:text-text-primary transition-colors">
              {theme.checkboxLabel}
            </span>
          </label>

          {/* Submit button */}
          <button
            ref={buttonRef}
            onClick={handleSubmit}
            disabled={!isChecked}
            className={`
              w-full py-3 px-6 rounded-lg font-semibold text-base transition-all duration-200
              ${isChecked
                ? 'bg-accent-primary text-white hover:bg-accent-primary/90 cursor-pointer'
                : 'bg-bg-tertiary text-text-tertiary cursor-not-allowed'
              }
            `}
          >
            {theme.buttonText}
          </button>
        </div>
      </div>
    </div>
  );
}
