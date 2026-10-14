/**
 * The build-stamp machinery's contract over a fixture root: the fingerprint
 * reflects source content, the stamp round-trips exactly, malformed or
 * absent stamps read as null (the gate re-derives rather than failing), and
 * a content change moves the fingerprint — the provenance property the
 * e2e staleness gate leans on (verified live for the stale-output repro;
 * this pin keeps the machinery itself honest).
 */
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { computeSourceState, readStamp, writeStamp } from './build-stamp.ts';

/** A fixture root shaped like the repo's fingerprinted subset. */
function fixtureRoot(): { root: string; sources: string; cleanup(): void } {
  const root = mkdtempSync(join(tmpdir(), 'build-stamp-fixture-'));
  mkdirSync(join(root, 'entrypoints'), { recursive: true });
  writeFileSync(join(root, 'entrypoints', 'index.ts'), 'export const one = 1;\n');
  writeFileSync(join(root, 'package.json'), '{}\n');
  return {
    root,
    sources: join(root, 'entrypoints', 'index.ts'),
    cleanup: () => {
      rmSync(root, { recursive: true, force: true });
    }
  };
}

describe('build-stamp', () => {
  it('fingerprints source content, so an edit moves the whole-fingerprint', () => {
    const fixture = fixtureRoot();
    try {
      const before = computeSourceState(fixture.root);
      expect(before.fingerprint).toMatch(/^[0-9a-f]{64}$/);
      expect(before.perFile['entrypoints/index.ts']).toMatch(/^[0-9a-f]{64}$/);
      writeFileSync(fixture.sources, 'export const one = 2;\n');
      const after = computeSourceState(fixture.root);
      expect(after.fingerprint).not.toBe(before.fingerprint);
      expect(after.perFile['entrypoints/index.ts']).not.toBe(
        before.perFile['entrypoints/index.ts']
      );
    } finally {
      fixture.cleanup();
    }
  });

  it('round-trips a written stamp through readStamp', () => {
    const fixture = fixtureRoot();
    try {
      expect(readStamp(fixture.root)).toBeNull();
      const state = computeSourceState(fixture.root);
      writeStamp(state, fixture.root);
      expect(readStamp(fixture.root)).toEqual(state);
      // The write is a REPLACE, not an append: a second write replaces.
      writeFileSync(fixture.sources, 'export const two = 2;\n');
      writeStamp(computeSourceState(fixture.root), fixture.root);
      expect(readStamp(fixture.root)?.fingerprint).not.toBe(state.fingerprint);
    } finally {
      fixture.cleanup();
    }
  });

  it('malformed stamps read as null (the gate re-derives, never fails on derivations)', () => {
    const fixture = fixtureRoot();
    try {
      mkdirSync(join(fixture.root, 'tests', 'e2e'), { recursive: true });
      const stampPath = join(fixture.root, 'tests', 'e2e', '.build-stamp.json');
      for (const broken of ['not json', '{}', '{"fingerprint": 1}', JSON.stringify([])]) {
        writeFileSync(stampPath, broken);
        expect(readStamp(fixture.root)).toBeNull();
      }
    } finally {
      fixture.cleanup();
    }
  });
});
