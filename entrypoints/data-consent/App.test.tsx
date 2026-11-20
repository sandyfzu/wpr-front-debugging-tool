import { render, screen } from '@solidjs/testing-library';
import { createRoot } from 'solid-js';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Logger } from '../../lib/logger';
import type { DataConsentPageQuery } from '../../lib/data-consent/consent-page-url';
import App, { CONSENT_WORDS, declinedMessage } from './App';
import { createConsentFlow, type ConsentFlowDeps } from './consent-flow';

const RUCSS: DataConsentPageQuery = { feature: 'rucss', next: null };

/** A flow over doubles (grant missing; the prompt answers `answer`). */
function flowFor(answer: Promise<boolean>, overrides: Partial<ConsentFlowDeps> = {}) {
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } satisfies Logger;
  const d: ConsentFlowDeps = {
    query: RUCSS,
    hasConsent: () => Promise.resolve(false),
    request: vi.fn(() => answer),
    watchRemoved: () => () => undefined,
    watchAdded: () => () => undefined,
    sendAnswer: () => Promise.resolve(),
    closeTab: () => Promise.resolve(),
    navigate: vi.fn(),
    log,
    ...overrides
  };
  return { flow: createRoot(() => createConsentFlow(d)), d };
}

/** One action button by its marker. */
function action(name: string): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>(`[data-fdt-consent-action="${name}"]`);
  if (button === null) throw new Error(`no ${name} button`);
  return button;
}

afterEach(() => {
  document.body.replaceChildren();
});

describe('the consent page', () => {
  it('without a known tool, says there is nothing to allow', () => {
    render(() => <App query={null} flow={null} name="WPR Front Debugging Tool" />);
    expect(screen.getByRole('heading', { name: CONSENT_WORDS.noToolTitle })).toBeTruthy();
    expect(document.querySelector('[data-fdt-consent-action]')).toBeNull();
  });

  it('asks with what is sent and why, then shows the prompt wait', async () => {
    let resolve: (granted: boolean) => void = () => undefined;
    const { flow, d } = flowFor(
      new Promise<boolean>((done) => {
        resolve = done;
      })
    );
    render(() => <App query={RUCSS} flow={flow} name="WPR FDT" />);
    await screen.findByRole('heading', { name: CONSENT_WORDS.askTitle });
    expect(document.querySelector('[data-fdt-consent-text="sends"]')?.textContent).toContain(
      'mega.wp-rocket.me'
    );
    action('allow').click();
    // The click handler itself made the request.
    expect(d.request).toHaveBeenCalledOnce();
    await screen.findByText(CONSENT_WORDS.requesting);
    expect(action('not-now').disabled).toBe(true);
    resolve(true);
    await screen.findByRole('heading', { name: CONSENT_WORDS.grantedTitle });
    expect(screen.getByText(CONSENT_WORDS.grantedRucss)).toBeTruthy();
  });

  it('a decline shows the reason and Ask again, which requests anew', async () => {
    const { flow, d } = flowFor(Promise.resolve(false));
    render(() => <App query={RUCSS} flow={flow} name="WPR FDT" />);
    await screen.findByRole('heading', { name: CONSENT_WORDS.askTitle });
    action('not-now').click();
    await screen.findByRole('heading', { name: CONSENT_WORDS.declinedTitle });
    expect(screen.getByText(declinedMessage('RUCSS Tester'))).toBeTruthy();
    expect(action('close')).toBeTruthy();
    action('ask-again').click();
    expect(d.request).toHaveBeenCalledOnce();
    // The prompt declined again: back on the decline, Close tab still there.
    await vi.waitFor(() => {
      expect(action('close')).toBeTruthy();
    });
  });

  it('a failed request names the cause, with Ask again and Close tab', async () => {
    const { flow } = flowFor(Promise.reject(new Error('blocked by policy')));
    render(() => <App query={RUCSS} flow={flow} name="WPR FDT" />);
    await screen.findByRole('heading', { name: CONSENT_WORDS.askTitle });
    action('allow').click();
    await screen.findByRole('heading', { name: CONSENT_WORDS.failedTitle });
    expect(document.querySelector('[data-fdt-consent-text="failure"]')?.textContent).toBe(
      'blocked by policy'
    );
    expect(action('ask-again')).toBeTruthy();
    expect(action('close')).toBeTruthy();
  });
});
