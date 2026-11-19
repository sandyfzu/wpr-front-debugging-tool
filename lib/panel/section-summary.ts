/**
 * The header summary of a tool page's settings section — one shape for
 * every page, so each page's pure summaries feed the shared disclosure
 * section without a per-page copy of the type.
 */

/** What a section's header says beside its title. */
export interface SectionSummary {
  /** What the section holds, e.g. "Desktop · 1,600 × 700 px" (may be empty when nothing readable is left). */
  readonly text: string;
  /** The run check's problem in it, e.g. "1 invalid value" (error tone), or null. */
  readonly problem: string | null;
}
