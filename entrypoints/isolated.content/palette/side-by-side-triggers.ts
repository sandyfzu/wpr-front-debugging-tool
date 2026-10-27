/**
 * Where the compare module hands the palette its open triggers: the exact
 * functions its own tab-message receivers (`openSideBySide`,
 * `openSideBySidePerformance`) call, so a palette run and a menu click end
 * in the same code. One slot per content-script world; the provider's
 * context invalidation empties it, and a module that failed to set up never
 * fills it (the palette then reports the command as failed, never guesses).
 */
import type { ContentScriptContext } from 'wxt/utils/content-script-context';

/** The compare module's open triggers. */
export interface SideBySideTriggers {
  /** The overlay's single open path (resolves once the open settled). */
  open(): Promise<void>;
  /** The PageSpeed Insights flow's entry (opens the analysis tab). */
  openPerformance(): void;
}

/** The provided triggers, while their module lives. */
let provided: SideBySideTriggers | null = null;

/**
 * Provide the triggers for this world's lifetime.
 *
 * @param ctx The provider's context (its invalidation empties the slot).
 * @param triggers The triggers.
 */
export function provideSideBySideTriggers(
  ctx: Pick<ContentScriptContext, 'onInvalidated'>,
  triggers: SideBySideTriggers
): void {
  provided = triggers;
  ctx.onInvalidated(() => {
    if (provided === triggers) provided = null;
  });
}

/**
 * The provided triggers.
 *
 * @throws {@link Error} when the compare module is not running in this world.
 */
export function sideBySideTriggers(): SideBySideTriggers {
  if (provided === null) throw new Error('The Side-by-Side module is not running on this page');
  return provided;
}
