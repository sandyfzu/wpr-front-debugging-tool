import { afterEach, describe, expect, it, vi } from 'vitest';
import { OVERLAY_HOST_NAME } from '../../components/injected-ui/key-guard';
import { OVERLAY_PRESENTATION_GLOBAL } from '../../lib/exclusion-session/overlay-reopen';
import {
  EXCLUSION_OVERLAY_SCRIPT,
  classifyInjectionFailure,
  openExclusionOverlay,
  prepareOverlayReopen,
  reopenExclusionOverlay,
  type ScriptInjector
} from './exclusion-overlay';

/** An injector whose file injection settles with `files` and whose probe answers `probe`. */
function injector(
  files: () => Promise<void>,
  probe: () => Promise<unknown> = () => Promise.resolve(true)
) {
  const injected = vi.fn<ScriptInjector['injectFiles']>(() => files());
  const ran = vi.fn<ScriptInjector['run']>(() => probe());
  const api: ScriptInjector = { injectFiles: injected, run: ran };
  return { api, injected, ran };
}

const scope = globalThis as unknown as Record<string, unknown>;

afterEach(() => {
  document.documentElement.querySelector(`:scope > ${OVERLAY_HOST_NAME}`)?.remove();
  Reflect.deleteProperty(scope, OVERLAY_PRESENTATION_GLOBAL);
});

describe('openExclusionOverlay', () => {
  it('injects the overlay script into the tab', async () => {
    const { api, injected, ran } = injector(() => Promise.resolve());
    expect(await openExclusionOverlay(7, api)).toBe('injected');
    expect(injected).toHaveBeenCalledWith(7, [EXCLUSION_OVERLAY_SCRIPT]);
    // An explicit open never probes: it replaces a running overlay.
    expect(ran).not.toHaveBeenCalled();
  });

  it('never rejects: a refusal is an outcome', async () => {
    const { api } = injector(() => Promise.reject(new Error('Cannot access a chrome:// URL')));
    expect(await openExclusionOverlay(7, api)).toBe('unsupported-page');
  });

  it('logs an unexpected failure as an error', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    try {
      const { api } = injector(() => Promise.reject(new Error('boom')));
      expect(await openExclusionOverlay(7, api)).toBe('failed');
      expect(error).toHaveBeenCalled();
    } finally {
      error.mockRestore();
    }
  });
});

describe('prepareOverlayReopen (the probe, run in the page’s isolated world)', () => {
  it('leaves the presentation and asks for the overlay when the document has none', () => {
    expect(prepareOverlayReopen(OVERLAY_HOST_NAME, OVERLAY_PRESENTATION_GLOBAL, 'folded')).toBe(
      true
    );
    expect(scope[OVERLAY_PRESENTATION_GLOBAL]).toBe('folded');
  });

  it('keeps a live overlay: no presentation left, nothing to inject', () => {
    document.documentElement.append(document.createElement(OVERLAY_HOST_NAME));
    expect(prepareOverlayReopen(OVERLAY_HOST_NAME, OVERLAY_PRESENTATION_GLOBAL, 'open')).toBe(
      false
    );
    expect(OVERLAY_PRESENTATION_GLOBAL in scope).toBe(false);
  });

  it('only counts the overlay’s own mount point (a direct child of <html>)', () => {
    // The same tag name deeper in the page is the page's, not a live overlay.
    document.body.append(document.createElement(OVERLAY_HOST_NAME));
    try {
      expect(prepareOverlayReopen(OVERLAY_HOST_NAME, OVERLAY_PRESENTATION_GLOBAL, 'open')).toBe(
        true
      );
    } finally {
      document.body.querySelector(OVERLAY_HOST_NAME)?.remove();
    }
  });

  it('is self-contained (the browser serializes it without its module)', () => {
    expect(prepareOverlayReopen.toString()).not.toMatch(/OVERLAY_|import|require\(/);
  });
});

describe('reopenExclusionOverlay', () => {
  it('probes with the host, the global and the presentation, then injects', async () => {
    const { api, injected, ran } = injector(() => Promise.resolve());
    expect(await reopenExclusionOverlay(3, 'folded', api)).toBe('reopened');
    expect(ran).toHaveBeenCalledWith(3, prepareOverlayReopen, [
      OVERLAY_HOST_NAME,
      OVERLAY_PRESENTATION_GLOBAL,
      'folded'
    ]);
    expect(injected).toHaveBeenCalledWith(3, [EXCLUSION_OVERLAY_SCRIPT]);
  });

  it('injects nothing unless the probe answers exactly true (idempotent)', async () => {
    for (const answer of [false, undefined, 'yes']) {
      const { api, injected } = injector(
        () => Promise.resolve(),
        () => Promise.resolve(answer)
      );
      expect(await reopenExclusionOverlay(3, 'open', api)).toBe('already-open');
      expect(injected).not.toHaveBeenCalled();
    }
  });

  it('classifies a refused probe or injection, never rejecting', async () => {
    const refusedProbe = injector(
      () => Promise.resolve(),
      () => Promise.reject(new Error('No tab with id: 3.'))
    );
    expect(await reopenExclusionOverlay(3, 'open', refusedProbe.api)).toBe('tab-gone');
    expect(refusedProbe.injected).not.toHaveBeenCalled();
    const refusedFiles = injector(() =>
      Promise.reject(new Error('Cannot access contents of the page.'))
    );
    expect(await reopenExclusionOverlay(3, 'open', refusedFiles.api)).toBe('unsupported-page');
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
