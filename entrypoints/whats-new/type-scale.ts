/**
 * The What's new page's type scale, one declaring site per text role. The
 * page is read, not scanned: it takes Tailwind's reading sizes (16 px body
 * and up) instead of the panel's devtools density (`text-xs`/`text-sm`, which
 * the theme shrinks to 12/13 px), and caps prose at a readable measure so a
 * wide window widens the screenshots, never the lines.
 */
export const WHATS_NEW_TYPE = {
  /** The page's `h1` (the product name). */
  title: 'text-2xl font-semibold text-fg-primary',
  /** The release's one-line headline under the title. */
  lead: 'max-w-prose text-lg text-fg-primary',
  /** A top-level section heading (`h2`). */
  section: 'text-xl font-semibold text-fg-primary',
  /** A section heading one level down (inside a featured or earlier release). */
  subsection: 'text-lg font-semibold text-fg-primary',
  /** A card's title (highlight, notice). */
  item: 'text-base font-semibold text-fg-primary',
  /** A version number heading an earlier release's collapsed entry. */
  version: 'font-mono text-sm font-semibold text-fg-primary',
  /** Body copy: paragraphs, bulleted lines and labeled lists. */
  body: 'max-w-prose text-base text-fg-secondary',
  /** A small-caps label ("How to open", "What's new"). */
  caps: 'text-xs font-medium uppercase tracking-wide text-fg-muted',
  /** Footer copy, quieter than the body. */
  meta: 'text-sm text-fg-secondary'
} as const;
