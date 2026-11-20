/**
 * The options rows' shared look, declared once for the drafted rows
 * (`./sections`) and the instant rows (`./instant-rows`): calm rows inside
 * a section card, set apart by the card's row gap — never a hairline.
 */

/**
 * A row's box: 4 px inline padding, so with the card's 10 px body padding
 * the row content sits 14 px from the card edge (the list rows' inset),
 * and 8 px above and below.
 */
export const OPTION_ROW = 'px-1 py-2';

/** A stacked row (label, control, then its lines), 6 px apart. */
export const OPTION_ROW_STACKED = 'flex flex-col gap-1.5 px-1 py-2';

/** A row's description or note line: small, secondary, readable line height. */
export const OPTION_ROW_LINE = 'text-2xs leading-snug text-fg-secondary';

/**
 * A switch row's lines start under the label text, not under the toggle:
 * the switch's 36 px hit box plus its 6 px gap.
 */
export const SWITCH_ROW_LINE_INDENT = 'ps-10.5';
