/**
 * Backend selection: first supported row wins, throwing detections count
 * as unsupported, an empty registry selects nothing.
 */
import { describe, expect, it } from 'vitest';
import { selectInterceptionBackend, type InterceptionBackendRow } from './backend';

/** A row with the given detection. */
function row(id: string, isSupported: () => boolean): InterceptionBackendRow {
  return {
    id,
    isSupported,
    create: () => ({
      arm: () => Promise.resolve({ armed: true }),
      disarm: () => Promise.resolve(),
      resume: () => Promise.resolve(true),
      runner: () => Promise.reject(new Error('not run'))
    })
  };
}

describe('selectInterceptionBackend', () => {
  it('selects nothing from an empty registry', () => {
    expect(selectInterceptionBackend([])).toBeNull();
  });

  it('selects the first supported row, in preference order', () => {
    const rows = [row('a', () => false), row('b', () => true), row('c', () => true)];
    expect(selectInterceptionBackend(rows)?.id).toBe('b');
  });

  it('treats a throwing detection as unsupported', () => {
    const rows = [
      row('a', () => {
        throw new Error('no api');
      }),
      row('b', () => true)
    ];
    expect(selectInterceptionBackend(rows)?.id).toBe('b');
  });

  it('selects nothing when no row is supported', () => {
    expect(selectInterceptionBackend([row('a', () => false)])).toBeNull();
  });
});
