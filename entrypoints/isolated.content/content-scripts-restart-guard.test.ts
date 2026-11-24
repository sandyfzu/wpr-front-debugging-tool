/**
 * Every isolated-world content script (manifest and runtime) installs the
 * restart guard on its own context right after the teardown guard — before
 * any feature registers anything — and opts out of WXT's start broadcast.
 * The guard is replaced by a spy that stops `main` right there; its
 * behavior is `lib/content-script-restart`'s own suite.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ContentScriptContext } from 'wxt/utils/content-script-context';
import type * as DeadContext from '../../lib/dead-context';
import type * as Restart from '../../lib/content-script-restart';

/** Thrown by the spy to end `main` at the restart guard. */
const STOP = new Error('stopped at the restart guard');

/** Call order of the two guards. */
const order = vi.hoisted(() => [] as string[]);
const teardownGuard = vi.hoisted(() => vi.fn());
const restartGuard = vi.hoisted(() => vi.fn());

vi.mock('../../lib/dead-context', async (importOriginal) => ({
  ...(await importOriginal<typeof DeadContext>()),
  guardInvalidationTeardown: teardownGuard
}));
vi.mock('../../lib/content-script-restart', async (importOriginal) => ({
  ...(await importOriginal<typeof Restart>()),
  installRestartGuard: restartGuard
}));

/** The definition fields this suite reads. */
interface Definition {
  readonly main: unknown;
  readonly noScriptStartedPostMessage?: boolean;
}

/** Every isolated-world content-script definition (main-world ones get no WXT context). */
const SCRIPTS: readonly [string, () => Promise<{ default: Definition }>][] = [
  ['isolated', () => import('./index')],
  ['ua-relay', () => import('../ua-relay.content')],
  ['command-palette', () => import('../command-palette.content/index')],
  ['exclusion-overlay', () => import('../exclusion-overlay.content/index')]
];

describe('isolated-world content scripts guard their restart signal', () => {
  beforeEach(() => {
    order.length = 0;
    teardownGuard.mockReset();
    teardownGuard.mockImplementation(() => order.push('teardown'));
    restartGuard.mockReset();
    restartGuard.mockImplementation(() => {
      order.push('restart');
      throw STOP;
    });
  });

  it.each(SCRIPTS)('%s: installs it right after the teardown guard', async (name, load) => {
    const definition = (await load()).default;
    const ctx = new ContentScriptContext(`restart-${name}`);
    const register = vi.spyOn(ctx, 'onInvalidated');
    const listen = vi.spyOn(ctx, 'addEventListener');
    expect(() => (definition.main as (ctx: ContentScriptContext) => unknown)(ctx)).toThrow(STOP);
    expect(order).toEqual(['teardown', 'restart']);
    expect(restartGuard.mock.calls[0]?.[0]).toBe(ctx);
    expect(register).not.toHaveBeenCalled();
    expect(listen).not.toHaveBeenCalled();
    ctx.abort('test over');
  });

  it.each(SCRIPTS)('%s: opts out of the start broadcast', async (_name, load) => {
    expect((await load()).default.noScriptStartedPostMessage).toBe(true);
  });
});
