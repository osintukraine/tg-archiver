import { describe, it, expect, beforeEach, vi } from 'vitest';
import { act } from 'react';
import { renderToString } from 'react-dom/server';
import { hydrateRoot } from 'react-dom/client';
import { ContentWarningProvider, useContentWarning } from '../ContentWarningContext';
import { CONSENT_STORAGE_KEY } from '@/lib/content-warning-config';

vi.mock('next/navigation', () => ({ usePathname: () => '/' }));

const DAY_MS = 24 * 60 * 60 * 1000;

function Probe() {
  const { shouldShowModal, hasConsent } = useContentWarning();
  return <span data-modal={String(shouldShowModal)} data-consent={String(hasConsent)} />;
}

function app() {
  return (
    <ContentWarningProvider>
      <Probe />
    </ContentWarningProvider>
  );
}

/** Server-render, then hydrate in the browser like Next.js does. */
async function hydrate(): Promise<HTMLElement> {
  const container = document.createElement('div');
  container.innerHTML = renderToString(app());
  document.body.appendChild(container);
  await act(async () => {
    hydrateRoot(container, app());
  });
  return container.querySelector('span') as HTMLElement;
}

describe('ContentWarningProvider consent persistence', () => {
  beforeEach(() => {
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('keeps valid consent across a hydrated page load and hides the modal', async () => {
    const consent = { accepted: true, timestamp: Date.now(), expiresAt: Date.now() + 30 * DAY_MS };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(consent));

    const probe = await hydrate();

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).not.toBeNull();
    expect(probe.dataset.consent).toBe('true');
    expect(probe.dataset.modal).toBe('false');
  });

  it('clears expired consent and shows the modal', async () => {
    const expired = { accepted: true, timestamp: Date.now() - 40 * DAY_MS, expiresAt: Date.now() - DAY_MS };
    localStorage.setItem(CONSENT_STORAGE_KEY, JSON.stringify(expired));

    const probe = await hydrate();

    expect(localStorage.getItem(CONSENT_STORAGE_KEY)).toBeNull();
    expect(probe.dataset.modal).toBe('true');
  });
});
