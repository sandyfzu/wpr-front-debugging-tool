/**
 * The hash router's tests, over a location stub: parse rules (prefix, unknown
 * and empty hash), boot parsing from an existing hash (deep links survive the
 * panel iframe's reloads), navigate writing the hash, and `hashchange`
 * driving the route signal (including back-navigation, which is just another
 * hash change).
 */
import { describe, expect, it } from 'vitest';
import { createHashRoute, parseHashRoute } from './router';
import type { HashRouterHost } from './router';

/**
 * A pure in-memory host: hash string + a discreet set of hashchange
 * listeners. Tests fire the event exactly like the platform does.
 */
function fakeHost(initialHash = ''): HashRouterHost & { hashChange(): void } {
  const listeners = new Set<() => void>();
  const host = {
    location: { hash: initialHash },
    addEventListener: (type: 'hashchange', listener: () => void): void => {
      listeners.add(listener);
    },
    removeEventListener: (type: 'hashchange', listener: () => void): void => {
      listeners.delete(listener);
    },
    hashChange: () => {
      for (const listener of [...listeners]) listener();
    }
  };
  return host;
}

describe('parseHashRoute', () => {
  it('reads the seeded hash form', () => {
    expect(parseHashRoute('#/javascript')).toBe('javascript');
    expect(parseHashRoute('#/detections')).toBe('detections');
  });

  it('resolves empty and foreign hashes to null (caller decides the default)', () => {
    expect(parseHashRoute('')).toBeNull();
    expect(parseHashRoute('#')).toBeNull();
    expect(parseHashRoute('#/unknown')).toBeNull();
    expect(parseHashRoute('javascript')).toBeNull();
  });
});

describe('createHashRoute', () => {
  it('defaults to detections on an empty hash', () => {
    const { route } = createHashRoute(fakeHost());
    expect(route()).toBe('detections');
  });

  it('reads an existing hash at creation — deep links survive reloads', () => {
    const { route } = createHashRoute(fakeHost('#/lazyload'));
    expect(route()).toBe('lazyload');
  });

  it('follows hashchange events (simulated back-navigation included)', () => {
    const host = fakeHost('#/javascript');
    const { route } = createHashRoute(host);
    expect(route()).toBe('javascript');
    host.location.hash = '#/detections'; // what browser-back leaves in place
    host.hashChange();
    expect(route()).toBe('detections');
  });

  it('degrades an unknown hash event to the default without rewriting it', () => {
    const host = fakeHost();
    const { route } = createHashRoute(host);
    host.location.hash = '#/nonsense';
    host.hashChange();
    expect(route()).toBe('detections');
    expect(host.location.hash).toBe('#/nonsense');
  });

  it('navigate writes the hash and the route follows the event', () => {
    const host = fakeHost();
    const { route, navigate } = createHashRoute(host);
    navigate('lazyload');
    expect(host.location.hash).toBe('#/lazyload');
    host.hashChange();
    expect(route()).toBe('lazyload');
  });

  it('stop() disconnects the hashchange follow', () => {
    const host = fakeHost();
    const { route, stop } = createHashRoute(host);
    stop();
    host.location.hash = '#/javascript';
    host.hashChange();
    expect(route()).toBe('detections');
  });
});
