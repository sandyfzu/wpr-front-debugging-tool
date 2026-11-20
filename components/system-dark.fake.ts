/**
 * A test double of the OS color-scheme query (unit tests of the signal and
 * of the controls that name the resolved palette).
 */
import type { ColorSchemeQuery } from './system-dark';

/** The fake's test controls beside the query slice. */
export interface FakeScheme extends ColorSchemeQuery {
  /** Change the preference and fire the change listeners, like the platform. */
  flip(next: boolean): void;
  /** How many change listeners are attached. */
  listeners(): number;
}

/**
 * Build a controllable query.
 *
 * @param matches Whether the OS prefers dark at the start.
 * @returns The fake.
 */
export function fakeScheme(matches: boolean): FakeScheme {
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  const query = {
    matches,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.add(listener);
    },
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => {
      listeners.delete(listener);
    },
    flip(next: boolean) {
      query.matches = next;
      for (const listener of [...listeners]) listener({ matches: next } as MediaQueryListEvent);
    },
    listeners: () => listeners.size
  };
  return query as unknown as FakeScheme;
}
