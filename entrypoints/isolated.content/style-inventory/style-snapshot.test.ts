/**
 * The stylesheet snapshot store: one kept list, addressed by id + position,
 * `gone` once replaced, released or detached, chunked reads from one pin.
 */
import { afterEach, describe, expect, it } from 'vitest';
import {
  STYLE_SOURCE_CHUNK_CHARS,
  STYLE_SOURCE_MAX_CHARS
} from '../../../lib/messaging/style-source';
import { createStyleSnapshots } from './style-snapshot';

/** Ids handed out in order (`a…`, `b…`), well-formed. */
function idSource(): () => string {
  let next = 0;
  return () => (next++).toString(16).padStart(32, 'a');
}

/**
 * Append elements to the body.
 *
 * @param html Their markup.
 * @returns The appended elements, document order.
 */
function mount(html: string): Element[] {
  const host = document.createElement('div');
  host.innerHTML = html;
  document.body.append(host);
  return [...host.children];
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('createStyleSnapshots', () => {
  it('reads an inline style of the kept list by position', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const id = store.take(mount('<link rel="stylesheet" href="/a.css"><style>a>b{}</style>'));
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 0 })).toEqual({
      status: 'ok',
      text: 'a>b{}',
      total: 5,
      truncated: false
    });
  });

  it('refuses a link position and any malformed request', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const id = store.take(mount('<link rel="stylesheet" href="/a.css">'));
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: 0 })).toEqual({
      status: 'error',
      reason: 'not-inline'
    });
    for (const input of [
      null,
      { snapshotId: id, styleIndex: 0 },
      { snapshotId: id, styleIndex: -1, offset: 0 },
      { snapshotId: id, styleIndex: 0, offset: STYLE_SOURCE_MAX_CHARS + 1 },
      { snapshotId: 'x', styleIndex: 0, offset: 0 },
      { snapshotId: id, styleIndex: 0, offset: 0, extra: true }
    ]) {
      expect(store.read(input), JSON.stringify(input)).toEqual({
        status: 'error',
        reason: 'invalid-request'
      });
    }
  });

  it('answers gone for an unknown snapshot, a position past the list and before any list', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const unknown = 'f'.repeat(32);
    expect(store.read({ snapshotId: unknown, styleIndex: 0, offset: 0 })).toEqual({
      status: 'gone'
    });
    const id = store.take(mount('<style>.a{}</style>'));
    expect(store.read({ snapshotId: unknown, styleIndex: 0, offset: 0 })).toEqual({
      status: 'gone'
    });
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 0 })).toEqual({ status: 'gone' });
  });

  it('keeps only the latest list: an older id is gone once replaced', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const [style] = mount('<style>.a{}</style>');
    const first = store.take([style as Element]);
    const second = store.take([style as Element]);
    expect(second).not.toBe(first);
    expect(store.read({ snapshotId: first, styleIndex: 0, offset: 0 })).toEqual({
      status: 'gone'
    });
    expect(store.read({ snapshotId: second, styleIndex: 0, offset: 0 })).toMatchObject({
      status: 'ok'
    });
  });

  it('answers gone for a detached element and after release', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const elements = mount('<style>.a{}</style><style>.b{}</style>');
    const id = store.take(elements);
    elements[0]?.remove();
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: 0 })).toEqual({ status: 'gone' });
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 0 })).toMatchObject({
      status: 'ok'
    });
    store.release();
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 0 })).toEqual({ status: 'gone' });
  });

  it('copies the list, so the caller’s array cannot change the snapshot', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const elements = mount('<style>.a{}</style>');
    const id = store.take(elements);
    elements.length = 0;
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: 0 })).toMatchObject({
      status: 'ok',
      text: '.a{}'
    });
  });

  it('serves the chunks of one read from one reading, a new read fresh', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const [style] = mount('<style></style>');
    const element = style as HTMLStyleElement;
    element.textContent = 'a'.repeat(STYLE_SOURCE_CHUNK_CHARS) + 'tail';
    const id = store.take([element]);
    const first = store.read({ snapshotId: id, styleIndex: 0, offset: 0 });
    expect(first).toMatchObject({ status: 'ok', total: STYLE_SOURCE_CHUNK_CHARS + 4 });
    // A page script rewrites the style mid-read: the continuation still reads the pin.
    element.textContent = 'changed';
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: STYLE_SOURCE_CHUNK_CHARS })).toEqual(
      { status: 'ok', text: 'tail', total: STYLE_SOURCE_CHUNK_CHARS + 4, truncated: false }
    );
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: 0 })).toEqual({
      status: 'ok',
      text: 'changed',
      total: 7,
      truncated: false
    });
  });

  it('drops the pin with a new list: the same position there reads its own element', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const [first] = mount(`<style>${'a'.repeat(STYLE_SOURCE_CHUNK_CHARS)}old</style>`);
    const older = store.take([first as Element]);
    store.read({ snapshotId: older, styleIndex: 0, offset: 0 });
    const [second] = mount(`<style>${'b'.repeat(STYLE_SOURCE_CHUNK_CHARS)}new</style>`);
    const newer = store.take([second as Element]);
    // A continuation at the pinned position of the earlier list must not serve its text.
    expect(
      store.read({ snapshotId: newer, styleIndex: 0, offset: STYLE_SOURCE_CHUNK_CHARS })
    ).toEqual({ status: 'ok', text: 'new', total: STYLE_SOURCE_CHUNK_CHARS + 3, truncated: false });
  });

  it('reads a fresh source for a continuation of another style, and refuses an offset past it', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const id = store.take(mount('<style>.a{}</style><style>.bb{}</style>'));
    store.read({ snapshotId: id, styleIndex: 0, offset: 0 });
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 2 })).toEqual({
      status: 'ok',
      text: 'b{}',
      total: 5,
      truncated: false
    });
    expect(store.read({ snapshotId: id, styleIndex: 1, offset: 6 })).toEqual({
      status: 'error',
      reason: 'invalid-request'
    });
  });

  it('keeps at most the read cap of a huge style and says it was cut', () => {
    const store = createStyleSnapshots({ createId: idSource() });
    const [style] = mount('<style></style>');
    (style as HTMLStyleElement).textContent = 'x'.repeat(STYLE_SOURCE_MAX_CHARS + 10);
    const id = store.take([style as Element]);
    expect(store.read({ snapshotId: id, styleIndex: 0, offset: 0 })).toMatchObject({
      status: 'ok',
      total: STYLE_SOURCE_MAX_CHARS,
      truncated: true
    });
  });

  it('uses unguessable random ids by default', () => {
    const store = createStyleSnapshots();
    const [style] = mount('<style>.a{}</style>');
    const id = store.take([style as Element]);
    expect(id).toMatch(/^[0-9a-f]{32}$/);
    expect(store.take([style as Element])).not.toBe(id);
  });
});
