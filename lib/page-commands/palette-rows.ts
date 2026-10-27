/**
 * The on-page palette's view-only row details — the matcher keywords, the
 * per-page availability and the confirm step of each palette command — and
 * the row list the palette view renders. Only the view (a runtime content
 * script loaded on the first open) imports this module, so none of it rides
 * the always-loaded isolated script; ids and labels stay in `./commands`.
 */
import { isPsiHost } from '../side-by-side/analysis-host';
import { PAGE_UI_GATE_RESCUE_LABEL, paletteCommands, type PaletteCommandId } from './commands';

/** The page facts a row's availability reads. */
export interface PageCommandFacts {
  /** The page is the PageSpeed Insights analysis host itself. */
  readonly analysisHost: boolean;
}

/** The confirmation a command asks for before it runs from the palette. */
export interface PageCommandConfirm {
  /** The confirm's title line. */
  readonly title: string;
  /** One sentence naming the consequence and the way back. */
  readonly body: string;
  /** The confirming button's label. */
  readonly action: string;
}

/** One palette command's view-only details. */
interface PaletteRowDetail {
  /** Extra lowercase words the matcher scores (never rendered). */
  readonly keywords: readonly string[];
  /** Why the command cannot run on this page, or null. Absent = always runnable. */
  readonly disabledNote?: (facts: PageCommandFacts) => string | null;
  /** Asked before the command runs (absent: runs at once). */
  readonly confirm?: PageCommandConfirm;
}

/** Each palette command's details (the compiler checks every palette id has one). */
const PALETTE_ROW_DETAILS: Readonly<Record<PaletteCommandId, PaletteRowDetail>> = {
  'side-by-side': { keywords: ['compare', 'cache', 'bypass', 'nowprocket', 'split', 'sbs'] },
  'psi-side-by-side': {
    keywords: ['pagespeed', 'insights', 'psi', 'lighthouse', 'performance', 'compare'],
    // On the analysis host the entry does nothing: an analysis starts from
    // a site, never from PageSpeed Insights itself.
    disabledNote: (facts) =>
      facts.analysisHost ? 'Starts from a site, not from PageSpeed Insights' : null
  },
  'toggle-detection-widget': {
    keywords: ['chip', 'strip', 'inspector', 'widget', 'detections', 'show', 'hide']
  },
  'exclusion-builder': {
    keywords: ['open', 'exclusions', 'exclude', 'delay', 'defer', 'rucss', 'test']
  },
  'page-ui-gate': {
    keywords: ['disable', 'hide', 'gate', 'master', 'off', 'everything'],
    confirm: {
      title: 'Turn off all on-page UI?',
      body: `This also turns off this command palette. Turn it back on from the page’s right-click menu (“${PAGE_UI_GATE_RESCUE_LABEL}”) or the extension’s options.`,
      action: 'Turn off'
    }
  }
};

/** One row as the view renders it (label from the vocabulary, availability resolved). */
export interface PaletteRowView {
  readonly id: PaletteCommandId;
  readonly label: string;
  readonly keywords: readonly string[];
  /** Why the row cannot run here, or null. */
  readonly disabledNote: string | null;
  /** The confirm step the row asks for before running, or null. */
  readonly confirm: PageCommandConfirm | null;
}

/**
 * The facts of the page at a URL.
 *
 * @param url The page's URL.
 */
export function pageCommandFacts(url: URL): PageCommandFacts {
  return { analysisHost: isPsiHost(url) };
}

/**
 * The rows the view lists for a page: the vocabulary's palette rows in
 * display order, their availability resolved against the page facts.
 *
 * @param facts The page facts.
 */
export function paletteRowViews(facts: PageCommandFacts): PaletteRowView[] {
  return paletteCommands().map((row) => {
    // `paletteCommands` lists palette rows only, so the id is a palette id.
    const id = row.id as PaletteCommandId;
    const detail = PALETTE_ROW_DETAILS[id];
    return {
      id,
      label: row.label,
      keywords: detail.keywords,
      disabledNote: detail.disabledNote?.(facts) ?? null,
      confirm: detail.confirm ?? null
    };
  });
}
