/**
 * The menus' gate follower over injected effects: watch-before-read ordering
 * (a write racing the boot read is never lost), the serial queue (edits and
 * recreations reach the browser in issue order, a recreation uses the newest
 * gate), per-row update failures logged without stopping siblings, and the
 * gate entry's toggle direction.
 */
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import { createMenuGateFollower, type MenuGateDeps, type MenuRowUpdate } from './menu-gate';

/** A deferred promise the test settles by hand. */
interface Deferred<T> {
  promise: Promise<T>;
  resolve(value: T): void;
  reject(cause: unknown): void;
}

/** Build a {@link Deferred}. */
function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (cause: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Recording deps: every browser/storage effect lands in `log` in call order. */
function harness(read: () => Promise<boolean> = () => Promise.resolve(true)): {
  deps: MenuGateDeps;
  log: string[];
  emit(enabled: boolean): void;
  written: boolean[];
  unwatched: () => number;
} {
  const log: string[] = [];
  const written: boolean[] = [];
  let listener: ((enabled: boolean) => void) | null = null;
  let unsubscribes = 0;
  const deps: MenuGateDeps = {
    readGate: () => {
      log.push('read');
      return read();
    },
    watchGate: (onChange) => {
      log.push('watch');
      listener = onChange;
      return () => {
        unsubscribes += 1;
      };
    },
    writeGate: (enabled) => {
      written.push(enabled);
      return Promise.resolve();
    },
    recreate: (uiEnabled) => {
      log.push(`recreate:${String(uiEnabled)}`);
      return Promise.resolve();
    },
    updatesFor: (uiEnabled): MenuRowUpdate[] => [
      { id: 'page', props: { enabled: uiEnabled } },
      { id: 'gate', props: { title: uiEnabled ? 'off-title' : 'rescue-title' } }
    ],
    update: (id, props) => {
      log.push(`update:${id}:${JSON.stringify(props)}`);
      return Promise.resolve();
    }
  };
  return {
    deps,
    log,
    written,
    emit: (enabled) => {
      listener?.(enabled);
    },
    unwatched: () => unsubscribes
  };
}

let error: MockInstance;
let warn: MockInstance;

beforeEach(() => {
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
  warn.mockRestore();
});

describe('createMenuGateFollower', () => {
  it('arms the watch before the boot read, then applies the read gate to every row', async () => {
    const h = harness(() => Promise.resolve(false));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    expect(h.log).toEqual([
      'watch',
      'read',
      'update:page:{"enabled":false}',
      'update:gate:{"title":"rescue-title"}'
    ]);
    expect(h.unwatched()).toBe(0);
  });

  it('a write landing while the boot read is in flight wins over the older read', async () => {
    const read = deferred<boolean>();
    const h = harness(() => read.promise);
    const follower = createMenuGateFollower(h.deps);
    const started = follower.start();
    // The watch delivers "off"; the read then answers the pre-write "on".
    h.emit(false);
    read.resolve(true);
    await started;
    await follower.idle();
    expect(h.log.filter((line) => line.startsWith('update:gate'))).toEqual([
      'update:gate:{"title":"rescue-title"}'
    ]);
  });

  it('follows every later write live, in order', async () => {
    const h = harness();
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    h.emit(false);
    h.emit(true);
    await follower.idle();
    expect(h.log.filter((line) => line.startsWith('update:page'))).toEqual([
      'update:page:{"enabled":true}',
      'update:page:{"enabled":false}',
      'update:page:{"enabled":true}'
    ]);
  });

  it('a failed boot read is logged; rows keep their state until a write arrives', async () => {
    const h = harness(() => Promise.reject(new Error('Extension context invalidated.')));
    const follower = createMenuGateFollower(h.deps);
    await expect(follower.start()).resolves.toBeUndefined();
    await follower.idle();
    expect(h.log).toEqual(['watch', 'read']);
    expect(error).toHaveBeenCalledWith(
      '[WPR FDT] [context-menus] On-page UI gate unread — menu entries keep their state',
      new Error('Extension context invalidated.')
    );
    h.emit(false);
    await follower.idle();
    expect(h.log).toContain('update:page:{"enabled":false}');
  });

  it('a recreation before the gate is known creates the default (on) state', async () => {
    const h = harness();
    const follower = createMenuGateFollower(h.deps);
    follower.recreate();
    await follower.idle();
    expect(h.log).toEqual(['recreate:true']);
  });

  it('a recreation creates the newest gate, and later edits run after it', async () => {
    const recreated = deferred<undefined>();
    const h = harness(() => Promise.resolve(false));
    h.deps.recreate = (uiEnabled) => {
      h.log.push(`recreate:${String(uiEnabled)}`);
      return recreated.promise;
    };
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    follower.recreate();
    // A write lands before the queued recreation runs: it creates "on".
    h.emit(true);
    await Promise.resolve();
    await Promise.resolve();
    // The edit waits for the recreation (removeAll + create) to finish.
    expect(h.log.at(-1)).toBe('recreate:true');
    recreated.resolve(undefined);
    await follower.idle();
    expect(h.log.slice(-3)).toEqual([
      'recreate:true',
      'update:page:{"enabled":true}',
      'update:gate:{"title":"off-title"}'
    ]);
  });

  it('reads the gate when the recreation runs, not when it was queued', async () => {
    const h = harness(() => Promise.resolve(true));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    const slow = deferred<undefined>();
    h.deps.update = (id, props) => {
      h.log.push(`update:${id}:${JSON.stringify(props)}`);
      return slow.promise;
    };
    h.emit(false);
    follower.recreate();
    h.emit(true);
    slow.resolve(undefined);
    await follower.idle();
    expect(h.log).toContain('recreate:true');
    expect(h.log).not.toContain('recreate:false');
  });

  it('one refused row update is logged with its id; its siblings still update', async () => {
    const h = harness();
    h.deps.update = (id, props) => {
      h.log.push(`update:${id}:${JSON.stringify(props)}`);
      return id === 'page'
        ? Promise.reject(new Error('Cannot find menu item with id page'))
        : Promise.resolve();
    };
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    expect(h.log).toContain('update:gate:{"title":"off-title"}');
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu entry update failed', {
      id: 'page',
      cause: new Error('Cannot find menu item with id page')
    });
  });

  it('a throwing operation is logged and never stalls the queue', async () => {
    const h = harness();
    h.deps.recreate = () => Promise.reject(new Error('removeAll exploded'));
    const follower = createMenuGateFollower(h.deps);
    follower.recreate();
    await follower.start();
    await follower.idle();
    expect(error).toHaveBeenCalledWith(
      '[WPR FDT] [context-menus] Menu recreation failed',
      new Error('removeAll exploded')
    );
    expect(h.log).toContain('update:page:{"enabled":true}');
  });

  it('toggles to the opposite of the known gate, reading it first when unknown', async () => {
    const h = harness(() => Promise.resolve(false));
    const follower = createMenuGateFollower(h.deps);
    // Unknown: reads (off) → writes on.
    await expect(follower.toggle()).resolves.toBe(true);
    await follower.start();
    h.emit(true);
    // Known on → writes off, no extra read.
    const reads = h.log.filter((line) => line === 'read').length;
    await expect(follower.toggle()).resolves.toBe(false);
    expect(h.log.filter((line) => line === 'read')).toHaveLength(reads);
    expect(h.written).toEqual([true, false]);
  });

  it('a rejected write rejects the toggle (the click logs it)', async () => {
    const h = harness();
    h.deps.writeGate = () => Promise.reject(new Error('quota'));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await expect(follower.toggle()).rejects.toThrow('quota');
  });
});
