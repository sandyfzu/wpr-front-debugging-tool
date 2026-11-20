/**
 * The panel's nav pin at runtime: the boot read (before the first render,
 * so the first frame already has the pinned form) and the session state the
 * collapse/expand button writes through.
 *
 * A toggle takes effect at once and then persists; a failed write is
 * reported (log + toast) and the panel keeps the new form for this session —
 * never a click that changes nothing.
 */
import { createSignal, type Accessor } from 'solid-js';
import { toast } from '../../../components/ui/toast-store';
import { createLogger, type Logger } from '../../../lib/logger';
import { NAV_PIN_DEFAULT, type NavPin } from '../../../lib/panel/nav-mode';
import { readNavPin, setNavPin } from '../../../lib/storage/panel-nav-pin';

const log = createLogger('panel');

/** The failure toast's title. */
export const NAV_PIN_FAILURE_TITLE = 'The sidebar choice did not save';

/** The failure toast's remedy line. */
export const NAV_PIN_FAILURE_NOTE = 'It applies until this panel closes; try again to keep it.';

/**
 * Summarize a cause for the log: an `Error`'s message, anything else as is.
 *
 * @param cause The caught value.
 */
function logCause(cause: unknown): unknown {
  return cause instanceof Error ? { message: cause.message } : cause;
}

/**
 * Read the stored pin for the boot. Never rejects: a failed read logs and
 * degrades to `auto` (the width rule), so the boot always renders.
 *
 * @param bootLog The panel boot's diagnostics sink.
 * @param read The pin read (tests inject doubles); absent, the storage item.
 * @returns The stored pin, or `auto` when the read failed.
 */
export async function bootNavPin(
  bootLog: Logger,
  read: () => Promise<NavPin> = readNavPin
): Promise<NavPin> {
  try {
    return await read();
  } catch (cause) {
    bootLog.warn('Sidebar pin could not be read — the sidebar follows the panel width', {
      cause: logCause(cause)
    });
    return NAV_PIN_DEFAULT;
  }
}

/**
 * Persist one pin and report a failure (a rejection or a synchronous throw)
 * with a log and a toast. Never rejects.
 *
 * @param write The persistence.
 * @param pin The pin to store.
 */
async function persistNavPin(write: (pin: NavPin) => Promise<void>, pin: NavPin): Promise<void> {
  try {
    await write(pin);
  } catch (cause: unknown) {
    log.warn('The sidebar pin could not be persisted', { pin, cause: logCause(cause) });
    toast.error(NAV_PIN_FAILURE_TITLE, { description: NAV_PIN_FAILURE_NOTE });
  }
}

/** The session's pin: what the nav renders from, and its writer. */
export interface NavPinState {
  /** The current pin. */
  readonly pin: Accessor<NavPin>;
  /** Apply a pin now and persist it (failures are reported, never thrown). */
  set(next: NavPin): void;
}

/**
 * Create the session pin. Call inside the shell (it owns a signal).
 *
 * @param initial The boot's pin.
 * @param write The persistence (tests inject doubles); absent, the storage item.
 * @returns The pin state.
 */
export function createNavPinState(
  initial: NavPin,
  write: (pin: NavPin) => Promise<void> = setNavPin
): NavPinState {
  const [pin, setPin] = createSignal<NavPin>(initial);
  return {
    pin,
    set: (next) => {
      setPin(next);
      void persistNavPin(write, next);
    }
  };
}
