/**
 * The extension documents' appearance leg (panel + options boots) — the
 * extension-<html> half of the palette rule: the stored three-way choice
 * (system default / dark / light) resolves into the `[data-theme]`
 * declaration on `<html>` *before* the app renders (no wrong-palette frame),
 * and follows later writes live while the document is mounted.
 *
 * Page semantics (`tokens.css`'s appearance model): `system` needs no
 * attribute — the `:root` media query chain resolves it against the OS
 * scheme live, so an OS flip restyles the document without any JS; an
 * explicit `dark`/`light` pins the attribute and wins over the media query.
 * Only a *change of the stored choice* therefore ever touches the tree.
 *
 * Arm-first discipline (the committed pattern from the injected-UI leg, kept
 * identical here): the storage watch arms before the read, so a write
 * landing inside the read window is applied by the watch and the (older)
 * read result is skipped in its favor — read-then-arm would drop exactly
 * that write and leave a stale palette until the next write.
 */
import { applyTheme, type Appearance, type Theme } from '../../utils/theme';
import type { StoredOptions } from '../../lib/storage/options';
import { optionsStore, storedOptionsOrFallback } from '../../lib/storage/options';

/**
 * The `<html>` attribute value `index.html`'s paint-lock rule releases on:
 * the head stylesheet keeps the panel document hidden until this value is
 * declared, so no frame paints in a palette the boot has not resolved.
 */
const THEME_LOCK_DONE = 'done';

/**
 * Release an extension document's paint lock — set `<html>`'s
 * `data-theme-lock` to its done value, exactly once (a repeated release
 * writes nothing). The bootstrap calls this in both arms of the appearance
 * resolution: the resolved choice (after a successful read) and the token
 * stylesheet's system default (after a failed read). The arm itself is the
 * inline head rule — hiding needs no script before this runs, which keeps
 * the extension page inside its CSP (inline script is not permitted there).
 *
 * @param root The document root (`<html>`).
 */
export function releaseThemeLock(root: HTMLElement): void {
  if (root.getAttribute('data-theme-lock') === THEME_LOCK_DONE) return;
  root.setAttribute('data-theme-lock', THEME_LOCK_DONE);
}
/**
 * The options seam this leg follows. The real storage item satisfies it;
 * tests hand fakes. `watch`'s payload is what storage delivered — the item
 * types it but does not validate, so every consumer validates first.
 */
export interface AppearanceSource {
  /** The current stored value, as the item's own read types it. */
  getValue(): Promise<StoredOptions>;
  /** The item's write channel (every write to the whole options item). */
  watch(onWrite: (raw: unknown) => void): () => void;
}

/**
 * The `[data-theme]` declaration an extension document carries for a stored
 * choice: `system` resolves to "unset" (the `:root` media query then owns
 * both the boot palette and every later OS flip), explicit choices pin
 * themselves.
 *
 * @param appearance The stored three-way choice.
 */
export function pageTheme(appearance: Appearance): Theme | null {
  return appearance === 'system' ? null : appearance;
}

/** The follow's stop handle — unsubscribes the write channel (idempotent). */
export type AppearanceFollow = () => void;

/**
 * Arm the write half of the follow alone: every validated options write
 * re-applies the document's declaration (only when it changes) and reports
 * the choice. {@link applyStoredAppearance} builds on it; a boot whose read
 * failed arms it directly, so a later successful write (from any surface)
 * still restyles the document and moves its controls.
 *
 * @param root The document root (`<html>`).
 * @param source The options seam (the real storage item by default).
 * @param onAppearance Told the choice of every validated write (repeats
 *   included; a signal setter dedupes).
 * @returns The stop handle.
 */
export function followAppearanceWrites(
  root: HTMLElement,
  source: AppearanceSource = optionsStoreSource,
  onAppearance?: (appearance: Appearance) => void
): AppearanceFollow {
  const unwatch = source.watch((raw) => {
    const appearance = storedOptionsOrFallback(raw).appearance;
    const next = pageTheme(appearance);
    // Apply unless the declaration already sits on the tree: a write that
    // keeps the appearance (other option slots write too) must not restyle.
    if (next !== root.getAttribute('data-theme')) applyTheme(root, next);
    onAppearance?.(appearance);
  });
  return () => {
    unwatch();
  };
}

/**
 * Put the document on the stored appearance and arm the follow that keeps
 * it there. The read applies before the caller renders, so no wrong-palette
 * frame paints; every options write re-applies until the returned handle
 * runs.
 *
 * @param root The document root (`<html>`, the extension-page contract).
 * @param source The options seam (the real storage item by default).
 * @param onAppearance Told the stored choice the document follows — after
 *   the read and on every validated write (repeats included; a signal
 *   setter dedupes) — so a control can show the choice without a second
 *   storage subscription.
 * @returns The stop handle.
 * @throws {@link Error} when the options read fails — the watch is
 *   unsubscribed first, so a failed follow never leaves a subscription
 *   behind; the boot logs it and continues on the token stylesheet's
 *   system default.
 */
export async function applyStoredAppearance(
  root: HTMLElement,
  source: AppearanceSource = optionsStoreSource,
  onAppearance?: (appearance: Appearance) => void
): Promise<AppearanceFollow> {
  let writes = 0;
  const stop = followAppearanceWrites(root, source, (appearance) => {
    writes += 1;
    onAppearance?.(appearance);
  });
  try {
    // Track the writes the watch saw during the read: a change between
    // arming and the read resolving means the callback already applied the
    // newer value, and re-applying the (older) read result would regress
    // the palette by one stale write.
    const writesBeforeRead = writes;
    const appearance = storedOptionsOrFallback(await source.getValue()).appearance;
    if (writes === writesBeforeRead) {
      applyTheme(root, pageTheme(appearance));
      onAppearance?.(appearance);
    }
  } catch (cause) {
    // Read failed with the channel armed: unwind the subscription before
    // the error propagates (the boot treats a read rejection as broken
    // wiring, not bad input).
    stop();
    throw cause;
  }
  return stop;
}

/**
 * The real source: the options storage item (declared once in
 * `lib/storage/options`). The watch payload is passed through raw — the
 * consumer validates (the contract comment above).
 */
const optionsStoreSource: AppearanceSource = {
  getValue: () => optionsStore.getValue(),
  watch: (onWrite) =>
    optionsStore.watch((value) => {
      onWrite(value);
    })
};
