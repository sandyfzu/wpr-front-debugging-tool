/**
 * The What's new decision matrix: every `onInstalled` reason, equal / lower /
 * higher versions, multi-version jumps, missing and corrupt markers, the
 * opt-out, the start check (catch-up), repeated events and a
 * `previousVersion` naming a build that never ran — once per announced
 * version, never on install or a restart, never throwing; the page is told
 * the floor it presents from.
 */
import { describe, expect, it } from 'vitest';
import { parseExtensionVersion } from '../../utils/extension-version';
import { decideWhatsNew, newestAnnouncedBetween, type WhatsNewInput } from './decision';
import type { ReleaseEntry } from './releases';

/** One index row. */
function note(version: string, announce: boolean): ReleaseEntry {
  return { version, announce };
}

/** 3.0.0 and 3.2.0 announce; 3.0.1 and 3.1.0 are routine. */
const NOTES: readonly ReleaseEntry[] = [
  note('3.2.0', true),
  note('3.1.0', false),
  note('3.0.1', false),
  note('3.0.0', true)
];

/** Inputs with overrides (default: an update 2.2.5 → 3.0.0, no marker, enabled). */
function input(overrides: Partial<WhatsNewInput>): WhatsNewInput {
  return {
    trigger: { kind: 'installed', reason: 'update', previousVersion: '2.2.5' },
    current: '3.0.0',
    marker: undefined,
    enabled: true,
    releases: NOTES,
    ...overrides
  };
}

/** Parse a version that must be valid. */
function v(text: string): readonly number[] {
  const parsed = parseExtensionVersion(text);
  if (parsed === null) throw new Error(`invalid test version ${text}`);
  return parsed;
}

describe('newestAnnouncedBetween', () => {
  it('picks the newest announced row in (lower, current]', () => {
    expect(newestAnnouncedBetween(NOTES, v('2.2.5'), v('3.0.0'))).toBe('3.0.0');
    expect(newestAnnouncedBetween(NOTES, v('2.2.5'), v('3.2.0'))).toBe('3.2.0');
    expect(newestAnnouncedBetween(NOTES, v('2.2.5'), v('3.1.5'))).toBe('3.0.0');
  });

  it('excludes the floor itself, rows above current and routine rows', () => {
    expect(newestAnnouncedBetween(NOTES, v('3.0.0'), v('3.1.0'))).toBeNull();
    expect(newestAnnouncedBetween(NOTES, v('3.0.0'), v('3.0.0'))).toBeNull();
    expect(newestAnnouncedBetween(NOTES, v('2.0'), v('2.9'))).toBeNull();
  });

  it('skips rows with an invalid version, in any table order', () => {
    const notes = [note('3.0.0', true), note('bad', true), note('3.2.0', true)];
    expect(newestAnnouncedBetween(notes, v('1'), v('4'))).toBe('3.2.0');
  });
});

describe('decideWhatsNew — install', () => {
  it('never opens and seeds the marker at the running version', () => {
    expect(decideWhatsNew(input({ trigger: { kind: 'installed', reason: 'install' } }))).toEqual({
      open: null,
      writeMarker: '3.0.0',
      warning: null
    });
  });

  it('leaves a marker already at or past the running version', () => {
    for (const marker of ['3.0.0', '3.5.0']) {
      expect(
        decideWhatsNew(input({ trigger: { kind: 'installed', reason: 'install' }, marker }))
      ).toEqual({ open: null, writeMarker: null, warning: null });
    }
  });

  it('moves an older marker up (a reinstall over kept local data)', () => {
    expect(
      decideWhatsNew(input({ trigger: { kind: 'installed', reason: 'install' }, marker: '2.9' }))
        .writeMarker
    ).toBe('3.0.0');
  });
});

describe('decideWhatsNew — update', () => {
  it('announces 3.0.0 to a build that kept no marker (2.x)', () => {
    expect(decideWhatsNew(input({}))).toEqual({
      open: { version: '3.0.0', since: '2.2.5' },
      writeMarker: '3.0.0',
      warning: null
    });
  });

  it('announces the newest announced version on a multi-version jump, from the floor', () => {
    expect(decideWhatsNew(input({ current: '3.2.0' })).open).toEqual({
      version: '3.2.0',
      since: '2.2.5'
    });
    expect(decideWhatsNew(input({ current: '3.2.0' })).writeMarker).toBe('3.2.0');
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '2.1' },
          current: '3.0.1'
        })
      ).open
    ).toEqual({ version: '3.0.0', since: '2.1' });
  });

  it('never trusts a previousVersion that never ran: no marker announces from 2.2.5', () => {
    // 2.2.5 → 3.0.0 kept disabled (new permission), then 3.0.1 installed:
    // Chromium reports the disabled 3.0.0 as the previous version.
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.0' },
          current: '3.0.1'
        })
      )
    ).toEqual({ open: { version: '3.0.0', since: '2.2.5' }, writeMarker: '3.0.1', warning: null });
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '3.1.0' },
          current: '3.2.0'
        })
      ).open
    ).toEqual({ version: '3.2.0', since: '2.2.5' });
  });

  it('trusts previousVersion when a marker exists (the user ran a marker-writing build)', () => {
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.0' },
          current: '3.2.0',
          marker: '3.0.0'
        })
      ).open
    ).toEqual({ version: '3.2.0', since: '3.0.0' });
  });

  it('announces nothing for a routine patch, yet moves the marker', () => {
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.0' },
          current: '3.0.1',
          marker: '3.0.0'
        })
      )
    ).toEqual({ open: null, writeMarker: '3.0.1', warning: null });
  });

  it('never re-announces what the marker already covers (a double event)', () => {
    const decision = decideWhatsNew(input({ marker: '3.0.0' }));
    expect(decision).toEqual({ open: null, writeMarker: null, warning: null });
  });

  it('takes the newer of previousVersion and marker as the floor', () => {
    // Marker ahead of previousVersion: 3.0.0 was already shown.
    expect(decideWhatsNew(input({ current: '3.1.0', marker: '3.0.0' })).open).toBeNull();
    // previousVersion ahead of a stale marker: nothing announced since 3.0.1.
    expect(
      decideWhatsNew(
        input({
          trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.1' },
          current: '3.1.0',
          marker: '2.0'
        })
      )
    ).toEqual({ open: null, writeMarker: '3.1.0', warning: null });
  });

  it('no marker: announces from 2.2.5 even when previousVersion is at or above the running one', () => {
    // A same-version repair, or a stored version already holding the new one.
    for (const previousVersion of ['3.0.0', '3.2.0']) {
      expect(
        decideWhatsNew(input({ trigger: { kind: 'installed', reason: 'update', previousVersion } }))
      ).toEqual({
        open: { version: '3.0.0', since: '2.2.5' },
        writeMarker: '3.0.0',
        warning: null
      });
    }
  });

  it('with a marker, opens nothing for an equal or lower version (reload, downgrade)', () => {
    const reload = decideWhatsNew(
      input({
        trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.0' },
        marker: '3.0.0'
      })
    );
    expect(reload).toEqual({ open: null, writeMarker: null, warning: null });
    const downgrade = decideWhatsNew(
      input({
        trigger: { kind: 'installed', reason: 'update', previousVersion: '3.2.0' },
        marker: '3.2.0'
      })
    );
    expect(downgrade).toEqual({ open: null, writeMarker: null, warning: null });
  });

  it('honors the opt-out: no page, the marker still moves', () => {
    expect(decideWhatsNew(input({ enabled: false }))).toEqual({
      open: null,
      writeMarker: '3.0.0',
      warning: null
    });
  });

  it('warns and opens nothing for a missing or malformed previousVersion', () => {
    for (const previousVersion of [undefined, '', 'x.y', '2.2.5-beta']) {
      const decision = decideWhatsNew(
        input({
          trigger:
            previousVersion === undefined
              ? { kind: 'installed', reason: 'update' }
              : { kind: 'installed', reason: 'update', previousVersion }
        })
      );
      expect(decision.open).toBeNull();
      expect(decision.writeMarker).toBe('3.0.0');
      expect(decision.warning).toContain('previous version');
    }
  });
});

describe('decideWhatsNew — browser and shared-module updates', () => {
  it.each(['browser_update', 'chrome_update', 'shared_module_update'])(
    '%s acts like the start check',
    (reason) => {
      const trigger = { kind: 'installed', reason } as const;
      expect(decideWhatsNew(input({ trigger }))).toEqual({
        open: null,
        writeMarker: null,
        warning: null
      });
      expect(decideWhatsNew(input({ trigger, marker: '3.0.0' }))).toEqual({
        open: null,
        writeMarker: null,
        warning: null
      });
      expect(decideWhatsNew(input({ trigger, marker: '2.9', current: '3.0.0' })).open).toEqual({
        version: '3.0.0',
        since: '2.9'
      });
    }
  );
});

describe('decideWhatsNew — start check (catch-up)', () => {
  const startup = { kind: 'startup' } as const;

  it('waits for onInstalled when no marker exists (never seeds)', () => {
    expect(decideWhatsNew(input({ trigger: startup }))).toEqual({
      open: null,
      writeMarker: null,
      warning: null
    });
  });

  it('catches an update whose event was missed', () => {
    expect(decideWhatsNew(input({ trigger: startup, marker: '3.0.0', current: '3.2.0' }))).toEqual({
      open: { version: '3.2.0', since: '3.0.0' },
      writeMarker: '3.2.0',
      warning: null
    });
  });

  it('does nothing on a plain restart or wake', () => {
    expect(decideWhatsNew(input({ trigger: startup, marker: '3.0.0' }))).toEqual({
      open: null,
      writeMarker: null,
      warning: null
    });
  });

  it('moves the marker without a page when nothing new is announced', () => {
    expect(decideWhatsNew(input({ trigger: startup, marker: '3.0.0', current: '3.1.0' }))).toEqual({
      open: null,
      writeMarker: '3.1.0',
      warning: null
    });
  });

  it('the catch-up then the late event open exactly once', () => {
    const first = decideWhatsNew(input({ trigger: startup, marker: '3.0.0', current: '3.2.0' }));
    const second = decideWhatsNew(
      input({
        trigger: { kind: 'installed', reason: 'update', previousVersion: '3.0.0' },
        current: '3.2.0',
        marker: first.writeMarker
      })
    );
    expect([first.open?.version, second.open]).toEqual(['3.2.0', null]);
  });
});

describe('decideWhatsNew — malformed input', () => {
  it('repairs a corrupt marker without a page', () => {
    for (const marker of ['', 'garbage', 3, { version: '3.0.0' }, ['3.0.0'], true]) {
      const decision = decideWhatsNew(input({ marker }));
      expect(decision.open).toBeNull();
      expect(decision.writeMarker).toBe('3.0.0');
      expect(decision.warning).toContain('marker');
    }
  });

  it('treats a null marker as absent', () => {
    expect(decideWhatsNew(input({ marker: null })).open?.version).toBe('3.0.0');
  });

  it('does nothing and warns for an invalid running version', () => {
    const decision = decideWhatsNew(input({ current: 'dev' }));
    expect(decision.open).toBeNull();
    expect(decision.writeMarker).toBeNull();
    expect(decision.warning).toContain('"dev"');
  });

  it('never throws on any trigger × marker combination', () => {
    const triggers = [
      { kind: 'startup' },
      { kind: 'installed', reason: 'install' },
      { kind: 'installed', reason: 'update' },
      { kind: 'installed', reason: 'update', previousVersion: '9.9.9' },
      { kind: 'installed', reason: 'something-new' }
    ] as const;
    for (const trigger of triggers) {
      for (const marker of [undefined, null, '3.0.0', 'bad', 42]) {
        expect(() => decideWhatsNew(input({ trigger, marker }))).not.toThrow();
      }
    }
  });
});
