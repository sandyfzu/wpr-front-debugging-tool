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
  const released = vi.fn<ScriptInjector['release']>(() => Promise.resolve(true));
  const api: ScriptInjector = {
    injectFiles: injected,
    claim: claimed,
    release: released,
    newToken: () => 'token-1'
  };
  return { api, injected, claimed, released };
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
      claimTtlMs: OVERLAY_CLAIM_TTL_MS,
      token: 'token-1'
    } satisfies OverlaySlotRequest);
    expect(injected).toHaveBeenCalledWith(7, [EXCLUSION_OVERLAY_SCRIPT]);
  });

  it('never replaces an overlay: shown only when a live one revealed itself', async () => {
    const live = injector(() => Promise.resolve('revealed'));
    expect(await openExclusionOverlay(7, live.api)).toBe('revealed');
    expect(live.injected).not.toHaveBeenCalled();
    // An injection already on its way (now starting open) is not "shown" yet.
    const pending = injector(() => Promise.resolve('pending'));
    expect(await openExclusionOverlay(7, pending.api)).toBe('injected');
    expect(pending.injected).not.toHaveBeenCalled();
  });

  it('distrusts answers an explicit open never gets', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    try {
      for (const verdict of ['live', 'other-origin']) {
        const { api, injected } = injector(() => Promise.resolve(verdict));
        expect(await openExclusionOverlay(7, api)).toBe('failed');
        expect(injected).not.toHaveBeenCalled();
      }
    } finally {
      warn.mockRestore();
    }
  });

  it('answers not-html for a document that is not an HTML page', async () => {
    const { api, injected } = injector(() => Promise.resolve('not-html'));
    expect(await openExclusionOverlay(7, api)).toBe('not-html');
    expect(injected).not.toHaveBeenCalled();
  });

  it('releases its own claim when the injection fails (the next open is not held up)', async () => {
    const refused = injector(undefined, () => Promise.reject(new Error('Cannot access contents')));
    expect(await openExclusionOverlay(7, refused.api)).toBe('unsupported-page');
    expect(refused.released).toHaveBeenCalledWith(7, 'token-1');
    const gone = injector(undefined, () => Promise.reject(new Error('No tab with id: 7.')));
    gone.released.mockRejectedValueOnce(new Error('No tab with id: 7.'));
    expect(await openExclusionOverlay(7, gone.api)).toBe('tab-gone');
    // A refused claim never injected: nothing to release.
    const noClaim = injector(() => Promise.reject(new Error('No tab with id: 7.')));
    await openExclusionOverlay(7, noClaim.api);
    expect(noClaim.released).not.toHaveBeenCalled();
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
      claimTtlMs: OVERLAY_CLAIM_TTL_MS,
      token: 'token-1'
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
    expect(refusedFiles.released).toHaveBeenCalledWith(3, 'token-1');
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

describe('the on-page UI gate', () => {
  it('an explicit open while the gate is off injects nothing and answers page-ui-off', async () => {
    const info = vi.spyOn(console, 'info').mockImplementation(() => undefined);
    try {
      const { api, injected, claimed } = injector();
      expect(await openExclusionOverlay(7, api, () => Promise.resolve(false))).toBe('page-ui-off');
      expect(claimed).not.toHaveBeenCalled();
      expect(injected).not.toHaveBeenCalled();
    } finally {
      info.mockRestore();
    }
  });

  it('a session re-open while the gate is off injects nothing', async () => {
    const { api, injected, claimed } = injector();
    expect(await reopenExclusionOverlay(3, 'open', ORIGIN, api, () => Promise.resolve(false))).toBe(
      'page-ui-off'
    );
    expect(claimed).not.toHaveBeenCalled();
    expect(injected).not.toHaveBeenCalled();
  });

  it('opens as usual while the gate is on', async () => {
    const { api, injected } = injector();
    expect(await openExclusionOverlay(7, api, () => Promise.resolve(true))).toBe('injected');
    expect(await reopenExclusionOverlay(3, 'open', ORIGIN, api, () => Promise.resolve(true))).toBe(
      'reopened'
    );
    expect(injected).toHaveBeenCalledTimes(2);
  });

  it('a failed gate read fails the open (logged), injecting nothing', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { api, injected } = injector();
      expect(
        await openExclusionOverlay(7, api, () => Promise.reject(new Error('storage down')))
      ).toBe('failed');
      expect(injected).not.toHaveBeenCalled();
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});
