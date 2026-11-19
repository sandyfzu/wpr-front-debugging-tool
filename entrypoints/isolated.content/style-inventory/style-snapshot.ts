/**
 * The Stylesheets list's addressable snapshot (top frame): the elements one
 * `listPageStylesheets` answer described, in its order, under a random id,
 * so a later `getStyleSourceChunk` reads exactly the element the panel's row
 * stands for — or learns it is gone.
 *
 * Bounded memory: only the latest list is kept (strong references to at
 * most `PAGE_STYLE_LIMITS.count` elements), replaced by the next list and
 * dropped on `pagehide`; at most one style's CSS is pinned for a chunked
 * read (≤ `STYLE_SOURCE_MAX_CHARS`), so the chunks of one read come from one
 * reading of the element even while a page script rewrites it.
 */
import { createRandomId } from '../../../utils/random-id';
import {
  keepStyleSource,
  parseStyleSourceRequest,
  styleSourceChunk,
  type KeptStyleSource,
  type StyleSourceReply
} from '../../../lib/messaging/style-source';

/** The kept list and its pinned source. */
export interface StyleSnapshots {
  /**
   * Keep a new list (the previous one and its pin are dropped).
   *
   * @param elements The listed elements, in the answer's order.
   * @returns The new snapshot's id.
   */
  readonly take: (elements: readonly Element[]) => string;
  /** Drop the kept list (the page is going away). */
  readonly release: () => void;
  /**
   * Answer one chunk read.
   *
   * @param input The untrusted request.
   * @returns The chunk, `gone`, or the refusal.
   */
  readonly read: (input: unknown) => StyleSourceReply;
}

/** What the store needs (tests inject a fixed id source). */
export interface StyleSnapshotDeps {
  /** A fresh, unguessable snapshot id. */
  readonly createId?: () => string;
}

/**
 * Create the store.
 *
 * @param deps See {@link StyleSnapshotDeps}.
 * @returns The store, empty.
 */
export function createStyleSnapshots(deps: StyleSnapshotDeps = {}): StyleSnapshots {
  const createId = deps.createId ?? createRandomId;
  let kept: { readonly id: string; readonly elements: readonly Element[] } | null = null;
  let pinned: { readonly index: number; readonly source: KeptStyleSource } | null = null;

  /**
   * The source a read serves: a fresh reading at offset 0 (a new read), the
   * pin for a continuation of the same style, a fresh reading otherwise.
   *
   * @param index The style's position.
   * @param element The element.
   * @param offset The read's offset.
   */
  const sourceOf = (index: number, element: Element, offset: number): KeptStyleSource => {
    if (offset > 0 && pinned?.index === index) return pinned.source;
    const source = keepStyleSource(element.textContent);
    pinned = { index, source };
    return source;
  };

  return {
    take: (elements) => {
      kept = { id: createId(), elements: [...elements] };
      pinned = null;
      return kept.id;
    },
    release: () => {
      kept = null;
      pinned = null;
    },
    read: (input) => {
      const request = parseStyleSourceRequest(input);
      if (request === null) return { status: 'error', reason: 'invalid-request' };
      if (kept === null || kept.id !== request.snapshotId) return { status: 'gone' };
      const element = kept.elements[request.styleIndex];
      if (element === undefined || !element.isConnected) return { status: 'gone' };
      if (element.localName !== 'style') return { status: 'error', reason: 'not-inline' };
      return styleSourceChunk(
        sourceOf(request.styleIndex, element, request.offset),
        request.offset
      );
    }
  };
}
