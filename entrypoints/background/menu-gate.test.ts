/**
 * The menus' gate follower over injected effects: watch-before-read ordering
 * (a write racing the boot read is never lost), the serial queue (edits and
 * recreations reach the browser in issue order, a recreation uses the newest
 * gate), absent rows recreated instead of warned about until rows are known,
 * per-row update failures logged without stopping siblings once they are, and
 * the gate entry's toggle direction (what the rows show, not the newest gate).
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

/**
 * Make the harness behave like the browser: an edit of a row id not created
 * yet rejects; a recreation creates every row the harness edits.
 */
function browserRows(h: ReturnType<typeof harness>, existing: string[] = []): Set<string> {
  const rows = new Set(existing);
  h.deps.update = (id, props) => {
    h.log.push(`update:${id}:${JSON.stringify(props)}`);
    return rows.has(id)
      ? Promise.resolve()
      : Promise.reject(new Error(`Cannot find menu item with id ${id}`));
  };
  h.deps.recreate = (uiEnabled) => {
    h.log.push(`recreate:${String(uiEnabled)}`);
    rows.add('page').add('gate');
    return Promise.resolve();
  };
  return rows;
}

let error: MockInstance;
let warn: MockInstance;
let debug: MockInstance;

beforeEach(() => {
  error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
  warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
  debug = vi.spyOn(console, 'debug').mockImplementation(() => undefined);
});

afterEach(() => {
  error.mockRestore();
  warn.mockRestore();
  debug.mockRestore();
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

  it('once rows are known, one refused row update is logged with its id; its siblings still update', async () => {
    const h = harness();
    const follower = createMenuGateFollower(h.deps);
    // The lifecycle recreation ran first: rows are known to exist.
    follower.recreate();
    h.deps.update = (id, props) => {
      h.log.push(`update:${id}:${JSON.stringify(props)}`);
      return id === 'page'
        ? Promise.reject(new Error('Cannot find menu item with id page'))
        : Promise.resolve();
    };
    await follower.start();
    await follower.idle();
    expect(h.log).toContain('update:gate:{"title":"off-title"}');
    expect(h.log.filter((line) => line.startsWith('recreate'))).toEqual(['recreate:true']);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu entry update failed', {
      id: 'page',
      cause: new Error('Cannot find menu item with id page')
    });
  });

  it('a boot apply before the rows exist recreates them in the gate state, without warning', async () => {
    const h = harness(() => Promise.resolve(false));
    browserRows(h);
    const follower = createMenuGateFollower(h.deps);
    // The read beats the lifecycle event: rows are created only afterwards.
    await follower.start();
    follower.recreate();
    await follower.idle();
    expect(h.log).toEqual([
      'watch',
      'read',
      'update:page:{"enabled":false}',
      'update:gate:{"title":"rescue-title"}',
      'recreate:false',
      'recreate:false'
    ]);
    expect(warn).not.toHaveBeenCalled();
    expect(error).not.toHaveBeenCalled();
    expect(debug).toHaveBeenCalledWith('[WPR FDT] [context-menus] Menu rows absent — recreating', {
      ids: ['page', 'gate']
    });
  });

  it('rows missing only some ids (an update adding rows) are recreated, not warned about', async () => {
    const h = harness();
    browserRows(h, ['page']);
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    expect(h.log.slice(-1)).toEqual(['recreate:true']);
    expect(warn).not.toHaveBeenCalled();
    // Rows are known now: a later refusal is a real degradation and warns.
    h.deps.update = () => Promise.reject(new Error('Cannot find menu item with id gate'));
    h.emit(false);
    await follower.idle();
    expect(warn).toHaveBeenCalledTimes(2);
    expect(h.log.filter((line) => line.startsWith('recreate'))).toHaveLength(1);
  });

  it('a recreation for absent rows uses the newest gate, not the value being applied', async () => {
    const h = harness();
    browserRows(h);
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    // A write lands before the queued boot apply settles.
    h.emit(false);
    await follower.idle();
    expect(h.log.filter((line) => line.startsWith('recreate'))).toEqual(['recreate:false']);
    expect(h.log.at(-1)).toBe('update:gate:{"title":"rescue-title"}');
    expect(warn).not.toHaveBeenCalled();
  });

  it('a live delivery before any row exists takes the recreation path too', async () => {
    const read = deferred<boolean>();
    const h = harness(() => read.promise);
    browserRows(h);
    const follower = createMenuGateFollower(h.deps);
    const started = follower.start();
    h.emit(false);
    read.resolve(true);
    await started;
    await follower.idle();
    expect(h.log.filter((line) => line.startsWith('recreate'))).toEqual(['recreate:false']);
    expect(warn).not.toHaveBeenCalled();
  });

  it('a failing recreation for absent rows is error-logged and the next edit retries it', async () => {
    const h = harness();
    browserRows(h);
    h.deps.recreate = () => Promise.reject(new Error('removeAll exploded'));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    expect(error).toHaveBeenCalledWith(
      '[WPR FDT] [context-menus] Menu gate update failed',
      new Error('removeAll exploded')
    );
    expect(warn).not.toHaveBeenCalled();
    // Rows still unknown: the next delivery reconciles again instead of warning.
    browserRows(h);
    h.emit(false);
    await follower.idle();
    expect(h.log.at(-1)).toBe('recreate:false');
    expect(warn).not.toHaveBeenCalled();
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

  it('a click between a gate change and its row edit writes what the clicked row offered', async () => {
    const h = harness(() => Promise.resolve(false));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    // Rows show off ("Turn on…"); a write of on is delivered but not applied yet.
    h.emit(true);
    await expect(follower.toggle()).resolves.toBe(true);
    expect(h.written).toEqual([true]);
  });

  it('before any apply ran, the toggle follows the newest known gate', async () => {
    const h = harness(() => Promise.resolve(true));
    const follower = createMenuGateFollower(h.deps);
    // Delivered but the queue never ran: nothing is shown yet.
    void follower.start();
    h.emit(false);
    await expect(follower.toggle()).resolves.toBe(true);
    expect(h.log.filter((line) => line === 'read')).toHaveLength(1);
  });

  it('the toggle follows a recreation: rows created off → writes on', async () => {
    const h = harness(() => Promise.resolve(false));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await follower.idle();
    follower.recreate();
    await follower.idle();
    await expect(follower.toggle()).resolves.toBe(true);
  });

  it('a throwing watch registration is logged; start still resolves and applies the read', async () => {
    const h = harness(() => Promise.resolve(false));
    h.deps.watchGate = () => {
      throw new Error('storage unavailable');
    };
    const follower = createMenuGateFollower(h.deps);
    await expect(follower.start()).resolves.toBeUndefined();
    await follower.idle();
    expect(error).toHaveBeenCalledWith(
      '[WPR FDT] [context-menus] On-page UI gate unwatched — menu entries follow only the boot read',
      new Error('storage unavailable')
    );
    expect(h.log).toContain('update:page:{"enabled":false}');
  });

  it('a rejected write rejects the toggle (the click logs it)', async () => {
    const h = harness();
    h.deps.writeGate = () => Promise.reject(new Error('quota'));
    const follower = createMenuGateFollower(h.deps);
    await follower.start();
    await expect(follower.toggle()).rejects.toThrow('quota');
  });
});
