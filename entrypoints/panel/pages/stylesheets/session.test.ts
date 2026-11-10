/**
 * The Stylesheets read: asks on creation, once more per new settled page
 * load, never retries a miss on its own, ignores a Refresh while a read is
 * on its way, and stops recording once its owner goes.
 */
import { createRoot, createSignal } from 'solid-js';
import { describe, expect, it, vi } from 'vitest';
import type { PageStylesheetsReply } from '../../../../lib/messaging/page-stylesheets';
import { createStylesheetsRead } from './session';
import type { StylesheetsOutcome } from './style-view';

const REPLY: PageStylesheetsReply = { styles: [], total: 0 };
const MISS: StylesheetsOutcome = { kind: 'page-unreachable', miss: 'no-receiver' };

/** Let queued promise callbacks run. */
async function settle(): Promise<void> {
  for (let index = 0; index < 10; index++) await Promise.resolve();
}

/** A read over doubles: the page identity and settled flag are signals the test moves. */
function setup(answers: StylesheetsOutcome[] = [], initiallySettled = true) {
  const [pageId, setPageId] = createSignal<string | null>('page-1');
  const [settled, setSettled] = createSignal(initiallySettled);
  const listStylesheets = vi.fn((): Promise<StylesheetsOutcome> =>
    Promise.resolve(answers.shift() ?? { kind: 'reply', reply: REPLY })
  );
  const log = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() };
  let dispose = (): void => undefined;
  const read = createRoot((owner) => {
    dispose = owner;
    return createStylesheetsRead({ listStylesheets, pageId, pageSettled: settled, log });
  });
  return { read, listStylesheets, setPageId, setSettled, dispose, log };
}

describe('createStylesheetsRead', () => {
  it('asks at once and shows the list', async () => {
    const { read, listStylesheets } = setup();
    expect(read.view()).toEqual({ status: 'loading' });
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(1);
    expect(read.view()).toMatchObject({ status: 'ready', reply: REPLY });
  });

  it('reads again once per new settled page load, not while the shell refetches', async () => {
    const { read, listStylesheets, setPageId, setSettled } = setup();
    await settle();
    setSettled(false);
    setPageId('page-2');
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(1);
    // The earlier load's list is never shown beside the new page's facts.
    expect(read.view()).toEqual({ status: 'loading' });
    setSettled(true);
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(2);
    expect(read.view()).toMatchObject({ status: 'ready' });
    // Same load again (a payload refresh): no new read.
    setSettled(false);
    setSettled(true);
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(2);
  });

  it('never retries a miss on its own; Retry reads again', async () => {
    const { read, listStylesheets } = setup([MISS]);
    await settle();
    expect(read.view()).toEqual({ status: 'failed', miss: 'no-receiver' });
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(1);
    read.refresh();
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(2);
    expect(read.view()).toMatchObject({ status: 'ready' });
  });

  it('a new page load whose read missed shows the miss, and is not retried in a loop', async () => {
    const { read, listStylesheets, setPageId } = setup([{ kind: 'reply', reply: REPLY }, MISS]);
    await settle();
    setPageId('page-2');
    await settle();
    expect(read.view()).toEqual({ status: 'failed', miss: 'no-receiver' });
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(2);
  });

  it('ignores Refresh while a read is on its way', async () => {
    const { read, listStylesheets } = setup();
    read.refresh();
    read.refresh();
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(1);
  });

  it('a read asked mid-refetch is asked again once the shell settles', async () => {
    const { listStylesheets, setSettled } = setup([], false);
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(1);
    // The first read may have reached the previous load: the settled one is read once more.
    setSettled(true);
    await settle();
    expect(listStylesheets).toHaveBeenCalledTimes(2);
  });

  it('logs a throwing ask and shows it as a failed read', async () => {
    const { read, listStylesheets, log } = setup();
    listStylesheets.mockImplementationOnce(() => Promise.reject(new Error('boom')));
    read.refresh();
    await settle();
    // The first (resolving) read was pending: the refresh was ignored.
    expect(listStylesheets).toHaveBeenCalledTimes(1);
    read.refresh();
    await settle();
    expect(log.error).toHaveBeenCalledWith('Stylesheet inventory read: the ask threw', 'boom');
    expect(read.view()).toMatchObject({ status: 'ready', refreshMiss: 'failed' });
  });

  it('stops recording once its owner is gone', async () => {
    const { read, dispose } = setup();
    dispose();
    await settle();
    expect(read.view()).toEqual({ status: 'loading' });
  });
});
