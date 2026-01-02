import type { Config } from 'tailwindcss'

const config: Config = {
  content: [
    './pages/**/*.{js,ts,jsx,tsx,mdx}',
    './components/**/*.{js,ts,jsx,tsx,mdx}',
    './app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  safelist: [
    // Topic classes (dynamically generated, need to be preserved)
    'topic-news',
    'topic-announcement',
    'topic-discussion',
    'topic-media',
    'topic-important',
    'topic-archive',
    'topic-offtopic',
    'topic-other',
    'topic-rule_based',
  ],
  darkMode: 'class', // Enable dark mode via class strategy
  theme: {
    extend: {
      colors: {
        // Background colors (CSS variables for theme switching)
        'bg-base': 'var(--bg-base)',
        'bg-elevated': 'var(--bg-elevated)',
        'bg-secondary': 'var(--bg-secondary)',
        'bg-tertiary': 'var(--bg-tertiary)',

        // Text colors
        'text-primary': 'var(--text-primary)',
        'text-secondary': 'var(--text-secondary)',
        'text-tertiary': 'var(--text-tertiary)',

        // Border colors
        'border': 'var(--border)',
        'border-subtle': 'var(--border-subtle)',

        // Primary brand color
        'primary': 'var(--primary)',

        // Accent colors (same in both themes)
        'accent-primary': '#4a9eff',
        'accent-secondary': '#ff6b35',
        'accent-success': '#4ade80',
        'accent-warning': '#fbbf24',
        'accent-danger': '#ef4444',
      },
    },
  },
  plugins: [],
}
export default config
