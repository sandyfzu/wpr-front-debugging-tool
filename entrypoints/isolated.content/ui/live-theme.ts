/**
 * The live palette leg of every injected UI this content script mounts.
 *
 * The shared mount applies the stored appearance to the shadow-root
 * container before its first paint; this module keeps that declaration on
 * the stored choice afterwards: a change made in the options page (or the
 * panel's palette cycle) restyles every mounted UI live, without a page
 * reload — the live half of the isolation standard's palette rule. A stored
 * `system` choice needs none of it while it lasts: the container then
 * declares `color-scheme: light dark`, and the browser follows OS changes
 * itself; only a change of the stored choice re-applies here.
 */

import { optionsStore, storedOptionsOrFallback } from '../../../lib/storage/options';
import type { StoredOptions } from '../../../lib/storage/options';
import { applyTheme, type Appearance, type Theme } from '../../../utils/theme';

/** The options seam the leg follows (the real item satisfies it; fakes in tests). */
export interface AppearanceSource {
  /** The current stored value, as the item's own read types it. */
  getValue(): Promise<StoredOptions>;
  /**
   * The item's write channel. `raw` is whatever storage delivered — the item
   * types it but does not validate it, so every consumer validates first.
   */
  watch(onWrite: (raw: StoredOptions) => void): () => void;
}

/**
 * The `data-theme` declaration an injected shadow-root container carries for
 * a stored appearance choice. Inside the shadow root the document's scheme
 * chain is aborted by the mount's isolation reset, so the container must
 * declare its own scheme: `system` is declared itself (`"light dark"` —
 * both palettes, browser-resolved live against the OS preference), explicit
 * choices pin dark/light on the spot.
 *
 * @param appearance The stored three-way choice.
 */
export function containerTheme(appearance: Appearance): Theme | 'system' {
  return appearance === 'system' ? 'system' : appearance;
}

/**
 * The container declaration a fresh options write resolves to, or `null`
 * when the write leaves the appearance unchanged (every write to the whole
 * options item reaches the watch; only a real appearance change may touch
 * the tree). A write the validator rejects degrades to the documented
 * defaults exactly like the read path — validation once, in the owner.
 *
 * @param current The declaration currently on the container (`data-theme`,
 *   `null` when unset — read from the attribute, not trusted as an enum).
 * @param raw The delivered write, still unvalidated.
 * @returns The declaration to apply, `null` to apply nothing.
 */
export function nextContainerTheme(current: string | null, raw: unknown): Theme | 'system' | null {
  const next = containerTheme(storedOptionsOrFallback(raw).appearance);
  return next === current ? null : next;
}

/**
 * Put the container on the stored appearance and arm the follow that keeps
 * it there: the stored choice applies at once (before the caller renders,
 * so no wrong-palette frame paints), then every options write re-applies
 * the appearance until the returned handle runs.
 *
 * @param container The UI container inside the shadow root.
 * @param source The options seam (the real storage item by default).
 * @returns The stop handle — unsubscribes the write channel; the mount's
 *   disposer folds it in, so the follow lives exactly as long as the view.
 */
export async function followStoredAppearance(
  container: HTMLElement,
  source: AppearanceSource = optionsStore
): Promise<() => void> {
  applyTheme(
    container,
    containerTheme(storedOptionsOrFallback(await source.getValue()).appearance)
  );
  return source.watch((raw) => {
    const next = nextContainerTheme(container.getAttribute('data-theme'), raw);
    if (next !== null) applyTheme(container, next);
  });
}
