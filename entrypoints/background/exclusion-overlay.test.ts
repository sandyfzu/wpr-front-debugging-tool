import { describe, expect, it, vi } from 'vitest';
import {
  OVERLAY_CLAIM_TTL_MS,
  type OverlaySlotRequest
} from '../../lib/exclusion-session/overlay-slot';
import {
  EXCLUSION_OVERLAY_SCRIPT,
  classifyInjectionFailure,
  openExclusionOverlay,
  reopenExclusionOverlay,
  type ScriptInjector
} from './exclusion-overlay';

/** An injector whose slot probe answers `probe` and whose file injection settles with `files`. */
function injector(
  probe: () => Promise<unknown> = () => Promise.resolve('inject'),
  files: () => Promise<void> = () => Promise.resolve()
) {
  const injected = vi.fn<ScriptInjector['injectFiles']>(() => files());
  const claimed = vi.fn<ScriptInjector['claim']>(() => probe());
  const api: ScriptInjector = { injectFiles: injected, claim: claimed };
  return { api, injected, claimed };
}

const ORIGIN = 'http://127.0.0.1:8493';

describe('openExclusionOverlay (explicit)', () => {
  it('claims the slot as an explicit open, then injects the overlay script', async () => {
    const { api, injected, claimed } = injector();
    expect(await openExclusionOverlay(7, api)).toBe('injected');
    expect(claimed).toHaveBeenCalledWith(7, {
      mode: 'open',
      presentation: null,
      origin: null,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS
    } satisfies OverlaySlotRequest);
    expect(injected).toHaveBeenCalledWith(7, [EXCLUSION_OVERLAY_SCRIPT]);
  });

  it('never replaces a live or pending overlay: it was revealed', async () => {
    for (const verdict of ['revealed', 'pending']) {
      const { api, injected } = injector(() => Promise.resolve(verdict));
      expect(await openExclusionOverlay(7, api)).toBe('revealed');
      expect(injected).not.toHaveBeenCalled();
    }
  });

  it('answers unsupported-page for a document that is not HTML', async () => {
    const { api, injected } = injector(() => Promise.resolve('not-html'));
    expect(await openExclusionOverlay(7, api)).toBe('unsupported-page');
    expect(injected).not.toHaveBeenCalled();
  });

  it('fails, logged, on a probe answer that is no verdict (thrown probe, engine error object)', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const answer of [undefined, { error: 'boom' }, true]) {
        const { api, injected } = injector(() => Promise.resolve(answer));
        expect(await openExclusionOverlay(7, api)).toBe('failed');
        expect(injected).not.toHaveBeenCalled();
      }
      expect(warn).toHaveBeenCalledTimes(3);
    } finally {
      warn.mockRestore();
    }
  });

  it('never rejects: a refusal is an outcome', async () => {
    const { api } = injector(() => Promise.reject(new Error('Cannot access a chrome:// URL')));
    expect(await openExclusionOverlay(7, api)).toBe('unsupported-page');
  });

  it('logs an unexpected failure as an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { api } = injector(undefined, () => Promise.reject(new Error('boom')));
      expect(await openExclusionOverlay(7, api)).toBe('failed');
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('reopenExclusionOverlay', () => {
  it('claims with the presentation and the session origin, then injects', async () => {
    const { api, injected, claimed } = injector();
    expect(await reopenExclusionOverlay(3, 'folded', ORIGIN, api)).toBe('reopened');
    expect(claimed).toHaveBeenCalledWith(3, {
      mode: 'reopen',
      presentation: 'folded',
      origin: ORIGIN,
      claimTtlMs: OVERLAY_CLAIM_TTL_MS
    } satisfies OverlaySlotRequest);
    expect(injected).toHaveBeenCalledWith(3, [EXCLUSION_OVERLAY_SCRIPT]);
  });

  it('injects nothing into a document that has (or is getting) its overlay', async () => {
    for (const verdict of ['live', 'pending']) {
      const { api, injected } = injector(() => Promise.resolve(verdict));
      expect(await reopenExclusionOverlay(3, 'open', ORIGIN, api)).toBe('already-open');
      expect(injected).not.toHaveBeenCalled();
    }
  });

  it('skips a page that moved to another origin or is not HTML', async () => {
    for (const verdict of ['other-origin', 'not-html']) {
      const { api, injected } = injector(() => Promise.resolve(verdict));
      expect(await reopenExclusionOverlay(3, 'open', ORIGIN, api)).toBe('skipped');
      expect(injected).not.toHaveBeenCalled();
    }
  });

  it('fails on an unusable probe answer and classifies refusals, never rejecting', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      expect(
        await reopenExclusionOverlay(3, 'open', ORIGIN, injector(() => Promise.resolve()).api)
      ).toBe('failed');
    } finally {
      warn.mockRestore();
    }
    const refusedProbe = injector(() => Promise.reject(new Error('No tab with id: 3.')));
    expect(await reopenExclusionOverlay(3, 'open', ORIGIN, refusedProbe.api)).toBe('tab-gone');
    expect(refusedProbe.injected).not.toHaveBeenCalled();
    const refusedFiles = injector(undefined, () =>
      Promise.reject(new Error('Cannot access contents of the page.'))
    );
    expect(await reopenExclusionOverlay(3, 'open', ORIGIN, refusedFiles.api)).toBe(
      'unsupported-page'
    );
  });
});

describe('classifyInjectionFailure', () => {
  it('tells a closed tab, an unscriptable page and a real failure apart', () => {
    expect(classifyInjectionFailure(new Error('No tab with id: 5.'))).toBe('tab-gone');
    expect(classifyInjectionFailure(new Error('Invalid tab ID: 5'))).toBe('tab-gone');
    expect(
      classifyInjectionFailure(
        new Error(
          'Cannot access contents of the page. Extension manifest must request permission to access the respective host.'
        )
      )
    ).toBe('unsupported-page');
    expect(classifyInjectionFailure(new Error('Missing host permission for the tab'))).toBe(
      'unsupported-page'
    );
    expect(classifyInjectionFailure(new Error('The extensions gallery cannot be scripted.'))).toBe(
      'unsupported-page'
    );
    // Case-insensitive (engines word these differently).
    expect(classifyInjectionFailure(new Error('MISSING HOST PERMISSION for the tab'))).toBe(
      'unsupported-page'
    );
    expect(classifyInjectionFailure(new Error('no tab with id: 9'))).toBe('tab-gone');
    expect(classifyInjectionFailure('boom')).toBe('failed');
  });
});
