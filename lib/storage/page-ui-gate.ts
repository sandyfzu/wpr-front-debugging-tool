/**
 * The on-page UI master gate: one synced boolean deciding whether this
 * extension injects any UI into inspected pages at all.
 *
 * Precedence — the gate outranks every per-site and per-feature setting:
 * while it is off, the detection chip, the known-conflicts card, the
 * Side-by-Side overlay, the exclusion builder overlay and the on-page
 * command palette itself neither mount at boot nor survive a live off-write
 * (open pages unmount them). Their own settings (per-origin chip entries,
 * feature flags) are kept untouched and simply lose their consumers until
 * the gate is back on; nothing resurrects a surface the gate closed. Page
 * behavior that is not injected UI (device simulation, the UA relay,
 * improvements) never reads it.
 *
 * Turning the gate off therefore also turns off the on-page palette — the
 * browser's context menu (outside the page, outside the gate) is the way
 * back. Default on: a fresh install, a removed key, and any corrupt or
 * foreign stored value all read as on, so the tool never goes dark by
 * accident.
 */
import { storage } from 'wxt/utils/storage';

/** The `sync:page-ui-gate` store key, single-sourced. */
export const PAGE_UI_GATE_KEY = 'sync:page-ui-gate';

/** The gate's value whenever storage holds nothing usable: on-page UI shows. */
export const PAGE_UI_GATE_DEFAULT = true;

/** The raw storage item (reads, writes and watches go through the helpers below). */
export const pageUiGateStore = storage.defineItem<boolean>(PAGE_UI_GATE_KEY, {
  fallback: PAGE_UI_GATE_DEFAULT
});

/**
 * Validate a raw (possibly corrupt or foreign) stored value: only a real
 * boolean is trusted; anything else degrades to {@link PAGE_UI_GATE_DEFAULT}.
 *
 * @param input Any storage-delivered value.
 * @returns Whether on-page UI is enabled.
 */
export function parsePageUiGate(input: unknown): boolean {
  return typeof input === 'boolean' ? input : PAGE_UI_GATE_DEFAULT;
}

/**
 * Read the gate through the validator (the boot ask every gated surface makes
 * before mounting).
 *
 * @returns Whether on-page UI is enabled.
 * @throws The storage read rejects as the platform does (e.g. an invalidated
 *   extension context) — callers branch.
 */
export async function readPageUiEnabled(): Promise<boolean> {
  return parsePageUiGate(await pageUiGateStore.getValue());
}

/**
 * Persist the gate. Every writer (options switch, context-menu rescue row,
 * palette row) goes through here; followers pick the change up through
 * {@link watchPageUiGate}.
 *
 * @param enabled `true` turns on-page UI on, `false` turns all of it off.
 * @throws The storage write rejects as the platform does — callers branch.
 */
export async function setPageUiGate(enabled: boolean): Promise<void> {
  await pageUiGateStore.setValue(enabled);
}

/**
 * Follow the gate: every write is validated before it reaches the callback,
 * so a corrupt write reads as the default and a removed key as on. The
 * callback may see the same value twice (a corrupt write over a stored `true`
 * delivers `true` again) — consumers apply idempotently.
 *
 * @param onChange Receives the validated gate after each write.
 * @returns The unsubscribe handle (idempotent).
 */
export function watchPageUiGate(onChange: (enabled: boolean) => void): () => void {
  return pageUiGateStore.watch((raw: unknown) => {
    onChange(parsePageUiGate(raw));
  });
}
