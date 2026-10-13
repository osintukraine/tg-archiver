/**
 * Content Warning Configuration
 *
 * Provides preset themes and env-based configuration for the content warning modal.
 * Themes can be overridden via NEXT_PUBLIC_CONTENT_WARNING_* environment variables.
 */

export interface ContentWarningTheme {
  title: string;
  intro: string;
  bulletPoints: string[];
  outro: string;
  checkboxLabel: string;
  buttonText: string;
}

/**
 * Preset themes for different content types
 */
export const CONTENT_WARNING_THEMES: Record<string, ContentWarningTheme> = {
  war: {
    title: 'Content Warning',
    intro: 'This archive documents the Russian war against Ukraine and contains:',
    bulletPoints: [
      'Graphic imagery of violence, casualties, and warfare',
      'Disturbing content including civilian harm',
      'Propaganda and disinformation from conflict parties',
      'Unverified claims requiring critical evaluation',
    ],
    outro: 'This material is preserved for research, journalism, and historical documentation purposes.',
    checkboxLabel: 'I am 18 years or older and understand this site contains disturbing war-related content',
    buttonText: 'Enter Site',
  },
  graphic: {
    title: 'Graphic Content Warning',
    intro: 'This site contains graphic imagery that may be disturbing to some viewers, including:',
    bulletPoints: [
      'Violent or disturbing images',
      'Content depicting injury or death',
      'Material that may cause emotional distress',
    ],
    outro: 'Viewer discretion is strongly advised.',
    checkboxLabel: 'I am 18 years or older and wish to view graphic content',
    buttonText: 'Continue',
  },
  sensitive: {
    title: 'Sensitive Content',
    intro: 'This site contains sensitive material that may not be suitable for all audiences.',
    bulletPoints: [],
    outro: 'The content includes topics and imagery that some viewers may find disturbing or uncomfortable.',
    checkboxLabel: 'I am 18 years or older and understand this site contains sensitive content',
    buttonText: 'Continue',
  },
  nsfw: {
    title: 'Adult Content',
    intro: 'This site contains adult content intended for viewers 18 years of age or older.',
    bulletPoints: [],
    outro: 'By entering, you confirm that you are of legal age to view such content in your jurisdiction.',
    checkboxLabel: 'I am 18 years or older',
    buttonText: 'Enter',
  },
  generic: {
    title: 'Age Verification',
    intro: 'This site contains content intended for adult audiences.',
    bulletPoints: [],
    outro: 'Please confirm your age to continue.',
    checkboxLabel: 'I confirm I am 18 years or older',
    buttonText: 'Continue',
  },
};

/**
 * Routes that are exempt from the content warning
 * Users can access these without acknowledging the warning
 */
export const EXEMPT_ROUTES = [
  '/about',
  '/admin',      // authenticated operators; the gate is for public visitors
  '/auth',
  '/api',
  '/suggest-channel',
  '/_next',      // Next.js internals
  '/favicon',    // Static assets
];

/**
 * Get the content warning configuration from environment variables
 */
export function getContentWarningConfig(): {
  enabled: boolean;
  theme: ContentWarningTheme;
  durationDays: number;
} {
  const enabled = process.env.NEXT_PUBLIC_CONTENT_WARNING_ENABLED !== 'false';
  const themeName = process.env.NEXT_PUBLIC_CONTENT_WARNING_THEME || 'war';
  const durationDays = parseInt(process.env.NEXT_PUBLIC_CONTENT_WARNING_DURATION_DAYS || '30', 10);

  // Get base theme (default to 'war' if invalid theme specified)
  const baseTheme = CONTENT_WARNING_THEMES[themeName] || CONTENT_WARNING_THEMES.war;

  // Apply any environment variable overrides
  const theme: ContentWarningTheme = {
    title: process.env.NEXT_PUBLIC_CONTENT_WARNING_TITLE || baseTheme.title,
    intro: baseTheme.intro,
    bulletPoints: baseTheme.bulletPoints,
    outro: baseTheme.outro,
    checkboxLabel: process.env.NEXT_PUBLIC_CONTENT_WARNING_CHECKBOX_LABEL || baseTheme.checkboxLabel,
    buttonText: process.env.NEXT_PUBLIC_CONTENT_WARNING_BUTTON_TEXT || baseTheme.buttonText,
  };

  return {
    enabled,
    theme,
    durationDays,
  };
}

/**
 * Check if a route is exempt from the content warning
 */
export function isRouteExempt(pathname: string): boolean {
  return EXEMPT_ROUTES.some(route => pathname.startsWith(route));
}

/**
 * localStorage key for storing consent
 */
export const CONSENT_STORAGE_KEY = 'tg-archiver-content-warning-consent';

/**
 * Consent data structure stored in localStorage
 */
export interface ConsentData {
  accepted: boolean;
  timestamp: number;
  expiresAt: number;
}
