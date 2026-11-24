/**
 * Every content script that touches `browser.*` installs the dead-context
 * teardown guard on its own context as the very first step of `main` —
 * before any feature can register a cleanup — so an extension reload never
 * puts a teardown error on the host page. The guard is replaced by a spy
 * that stops `main` right there: reaching it first, with the script's own
 * context, is exactly what is pinned (the guard's behavior is
 * `lib/dead-context`'s own suite).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import type * as DeadContext from '../../lib/dead-context';

/** Thrown by the spy to end `main` at the guard. */
const STOP = new Error('stopped at the teardown guard');

const guard = vi.hoisted(() => vi.fn());
vi.mock('../../lib/dead-context', async (importOriginal) => ({
  ...(await importOriginal<typeof DeadContext>()),
  guardInvalidationTeardown: guard
}));

/** The content-script definitions whose teardown can meet a dead context. */
const SCRIPTS: readonly [string, () => Promise<{ default: { main: unknown } }>][] = [
  ['isolated', () => import('./index')],
  ['ua-relay', () => import('../ua-relay.content')],
  ['command-palette', () => import('../command-palette.content/index')],
  ['exclusion-overlay', () => import('../exclusion-overlay.content/index')]
];

describe('content scripts install the teardown guard first', () => {
  beforeEach(() => {
    guard.mockReset();
    guard.mockImplementation(() => {
      throw STOP;
    });
  });

  it.each(SCRIPTS)('%s: guards its own context before anything else runs', async (name, load) => {
    const definition = (await load()).default;
    const ctx = new ContentScriptContext(`teardown-${name}`);
    const register = vi.spyOn(ctx, 'onInvalidated');
    const listen = vi.spyOn(ctx, 'addEventListener');
    expect(() => (definition.main as (ctx: ContentScriptContext) => unknown)(ctx)).toThrow(STOP);
    expect(guard).toHaveBeenCalledOnce();
    expect(guard.mock.calls[0]?.[0]).toBe(ctx);
    // Nothing reached the context before the guard did.
    expect(register).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
  });
});
