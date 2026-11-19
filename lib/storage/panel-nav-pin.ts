/**
 * The panel nav's pin: whether the sidebar follows the width rule (`auto`)
 * or holds the labeled form or the icon rail. Per device (`local:`): a
 * panel layout choice belongs to the screen it was made on, not to every
 * synced browser.
 *
 * Read once at panel boot (before the first render, so the first frame has
 * the right form) and written by the sidebar's collapse/expand button. A
 * fresh install, a removed key and any corrupt or foreign value read as
 * `auto`.
 */
import { storage } from 'wxt/utils/storage';
import { NAV_PIN_DEFAULT, isNavPin, type NavPin } from '../panel/nav-mode';

/** The `local:panel-nav-pin` store key, single-sourced. */
export const PANEL_NAV_PIN_KEY = 'local:panel-nav-pin';

/** The raw storage item (reads and writes go through the helpers below). */
export const panelNavPinStore = storage.defineItem<NavPin>(PANEL_NAV_PIN_KEY, {
  fallback: NAV_PIN_DEFAULT
});

/**
 * Validate a raw stored value: only a known pin is trusted.
 *
 * @param input Any storage-delivered value.
 * @returns The pin, or {@link NAV_PIN_DEFAULT} for anything else.
 */
export function parseNavPin(input: unknown): NavPin {
  return isNavPin(input) ? input : NAV_PIN_DEFAULT;
}

/**
 * Read the pin through the validator.
 *
 * @returns The stored pin (`auto` when nothing usable is stored).
 * @throws The storage read rejects as the platform does — callers branch.
 */
export async function readNavPin(): Promise<NavPin> {
  return parseNavPin(await panelNavPinStore.getValue());
}

/**
 * Persist the pin.
 *
 * @param pin The pin to store.
 * @throws {@link TypeError} For a value outside the pin vocabulary (a caller bug).
 * @throws The storage write rejects as the platform does — callers branch.
 */
export async function setNavPin(pin: NavPin): Promise<void> {
  if (!isNavPin(pin)) throw new TypeError(`setNavPin: unknown pin ${JSON.stringify(pin)}`);
  await panelNavPinStore.setValue(pin);
}
