/**
 * The panel nav's form rule: the labeled sidebar or the icon rail, decided
 * from the shell (panel) width, the user's pin and whether a list detail is
 * open. Pure and JS-only — the shell measures its own width, so no CSS twin
 * exists to drift.
 *
 * Why the rule cannot oscillate with a list's detail layout: the automatic
 * fold depends on the detail being open, and a list publishes "open" for its
 * side pane and its drill-in alike, so the nav's width change (which can
 * swap pane ↔ drill) never flips its own input; the pinned forms ignore the
 * detail entirely.
 */
import { TOP_BAR_FULL_MIN_WIDTH } from './top-bar-layout';

/**
 * The shell width (px) from which the automatic nav shows its labeled form.
 * Below it the icon rail keeps the content region wide enough for the list
 * pages' wide rows.
 */
export const SIDEBAR_LABELED_MIN_WIDTH = 1080;

/** The user's pin choices: follow the rule, or hold one form. */
export const NAV_PINS = ['auto', 'labeled', 'rail'] as const;

/** One pin choice. */
export type NavPin = (typeof NAV_PINS)[number];

/** The pin a fresh install, a removed key or a corrupt value reads as. */
export const NAV_PIN_DEFAULT: NavPin = 'auto';

/** The nav's two forms. */
export type NavForm = 'labeled' | 'rail';

/** The rule's inputs. */
export interface NavModeInput {
  /** The shell's inline size in px (0 while unmeasured). */
  readonly shellWidth: number;
  /** The user's pin. */
  readonly pinned: NavPin;
  /** Whether a list detail (pane or drill-in) is open on the current page. */
  readonly detailOpen: boolean;
}

/**
 * Narrow any value to a pin choice.
 *
 * @param value Any value (storage, a test double).
 * @returns Whether it is one of {@link NAV_PINS}.
 */
export function isNavPin(value: unknown): value is NavPin {
  return (NAV_PINS as readonly unknown[]).includes(value);
}

/**
 * Validate a width input: a measuring bug must surface, never pick a form.
 *
 * @param width The shell width.
 * @throws {@link RangeError} When negative or not finite.
 */
function assertWidth(width: number): void {
  if (!Number.isFinite(width) || width < 0) {
    throw new RangeError(`navMode: shellWidth must be a finite number >= 0, got ${String(width)}`);
  }
}

/**
 * Pick the nav form.
 *
 * - pinned `rail` → the rail, always;
 * - pinned `labeled` → labeled from the top bar's full-width threshold on,
 *   else the rail (narrower, the content would drop under its floor);
 * - `auto` → labeled from {@link SIDEBAR_LABELED_MIN_WIDTH} on while no
 *   detail is open, else the rail.
 *
 * @param input The shell width, the pin and the detail presence.
 * @returns The form to render.
 * @throws {@link RangeError} When the width is negative or not finite.
 */
export function navMode(input: NavModeInput): NavForm {
  assertWidth(input.shellWidth);
  switch (input.pinned) {
    case 'rail':
      return 'rail';
    case 'labeled':
      return input.shellWidth >= TOP_BAR_FULL_MIN_WIDTH ? 'labeled' : 'rail';
    case 'auto':
      return input.shellWidth >= SIDEBAR_LABELED_MIN_WIDTH && !input.detailOpen
        ? 'labeled'
        : 'rail';
  }
}

/**
 * Whether the toggle can change the form right now: below the top bar's
 * full-width threshold every pin renders the rail, so there is nothing to
 * toggle (the shell hides the button).
 *
 * @param shellWidth The shell width in px.
 * @returns True from {@link TOP_BAR_FULL_MIN_WIDTH} on.
 * @throws {@link RangeError} When the width is negative or not finite.
 */
export function navToggleAvailable(shellWidth: number): boolean {
  assertWidth(shellWidth);
  return shellWidth >= TOP_BAR_FULL_MIN_WIDTH;
}

/**
 * The pin the collapse/expand toggle stores: the form opposite the one on
 * screen, stored as `auto` whenever the automatic rule already yields it
 * there (so expanding on a wide panel, or collapsing on a narrow one, hands
 * the nav back to the rule instead of pinning it for good), else as the
 * explicit form.
 *
 * @param input The current width, pin and detail presence.
 * @returns The pin to store; the form it renders is always the opposite of
 *   the current one whenever {@link navToggleAvailable} holds.
 * @throws {@link RangeError} When the width is negative or not finite.
 */
export function toggledNavPin(input: NavModeInput): NavPin {
  const target: NavForm = navMode(input) === 'labeled' ? 'rail' : 'labeled';
  return navMode({ ...input, pinned: 'auto' }) === target ? 'auto' : target;
}
