/**
 * The panel's appearance writes (the top bar's menu, the palette's cycle
 * row) share one failure path: storage has no mechanism module of its own,
 * so a rejected write is reported here — a log with the cause and an error
 * toast naming the outcome. Never a silent swallow, never a dead end: the
 * panel keeps the palette it shows and the user can pick again.
 */
import { createLogger } from '../../lib/logger';
import { toast } from '../../components/ui/toast-store';

const log = createLogger('panel');

/** The failure toast's title. */
export const APPEARANCE_FAILURE_TITLE = 'The appearance could not be changed';

/** The failure toast's remedy line. */
export const APPEARANCE_SAVE_NOTE = 'The choice did not save; the panel keeps its current palette.';

/**
 * Run one appearance write and report its rejection.
 *
 * @param write The storage write (a set or a cycle step).
 * @returns Resolves once the write settled — never rejects.
 */
export async function guardAppearanceWrite(write: () => Promise<void>): Promise<void> {
  try {
    await write();
  } catch (cause: unknown) {
    log.warn('The appearance choice could not be persisted', {
      cause: cause instanceof Error ? { message: cause.message } : cause
    });
    toast.error(APPEARANCE_FAILURE_TITLE, { description: APPEARANCE_SAVE_NOTE });
  }
}
