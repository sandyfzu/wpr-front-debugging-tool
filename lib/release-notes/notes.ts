/**
 * The release notes' copy: one row per version of the release index
 * (`./releases`, which owns the versions and the `announce` flags), joined
 * into {@link RELEASE_NOTES} for the What's new page — the running version's
 * row first, earlier rows as history. Copy may carry `{token}` placeholders
 * (`./copy-tokens`) the page fills with values only the running extension
 * knows.
 */
import {
  LABEL_DELAY_JAVASCRIPT_EXECUTION,
  LABEL_IMAGE_LAZYLOAD,
  LABEL_LOAD_JAVASCRIPT_DEFERRED
} from '../detection/labels';
import { PAGE_SURFACE_NAMES, pageCommandLabel } from '../page-commands/commands';
import { capitalize } from '../../utils/text';
import { RELEASES, type ReleaseEntry, type ReleaseVersion } from './releases';
import type { ScreenshotId } from './screenshots';

/** A build a note applies to (absent on a note: both). */
export type ReleaseBrowser = 'chromium' | 'firefox';

/** One new feature, shown as a card. */
export interface ReleaseHighlight {
  /** Stable id, unique within its release (the card's hook). */
  readonly id: string;
  readonly title: string;
  /** What it does, in one sentence. */
  readonly summary: string;
  /** Every way to reach it, one short path each ("Panel → Tools → RUCSS Tester"). */
  readonly howTo: readonly string[];
  /** Further facts worth a line each (states, limits). */
  readonly details?: readonly string[];
  /** Its screenshot; absent, the card is text only. */
  readonly screenshot?: ScreenshotId;
}

/** Something users must know about (a permission, a removal, a retirement). */
export interface ReleaseNotice {
  /** Stable id, unique within its release. */
  readonly id: string;
  readonly title: string;
  readonly body: string;
  /** Labeled lines under the body (e.g. where a retired tool's features went). */
  readonly items?: readonly { readonly label: string; readonly text: string }[];
  /** The builds the notice applies to (absent: both). */
  readonly browsers?: readonly ReleaseBrowser[];
}

/** One release's copy. */
export interface ReleaseCopy {
  /** The release in one sentence. */
  readonly headline: string;
  /** The really new things, most important first. */
  readonly highlights: readonly ReleaseHighlight[];
  /** Smaller improvements, one line each (a list, never cards). */
  readonly improvements: readonly string[];
  /** Changes users must know about. */
  readonly notices: readonly ReleaseNotice[];
}

/** One release as the page renders it: its index row and its copy. */
export type ReleaseNote = ReleaseEntry & ReleaseCopy;

/** The panel, as paths name it (opened from the browser's DevTools). */
const PANEL = 'DevTools → WPR FDT';

/** The command palette, as paths name it. */
const PALETTE = capitalize(PAGE_SURFACE_NAMES.commandPalette);

/** The version 3.0.0 copy. */
const RELEASE_3_0_0: ReleaseCopy = {
  headline:
    'A rebuilt, faster tool: try exclusions live on the page, simulate WP Rocket features, test RUCSS and the beacon, and reach every tool from the page itself.',
  highlights: [
    {
      id: 'exclusion-builder',
      screenshot: 'exclusion-builder',
      title: PAGE_SURFACE_NAMES.exclusionBuilder,
      summary: `Try ${LABEL_DELAY_JAVASCRIPT_EXECUTION}, ${LABEL_LOAD_JAVASCRIPT_DEFERRED} and ${LABEL_IMAGE_LAZYLOAD} exclusions on the live page before changing the site, and simulate those features on a page served without them.`,
      howTo: [
        `${PANEL} → Exclusions (top bar)`,
        `Right-click the toolbar icon → ${pageCommandLabel('exclusion-builder')}`,
        `${PALETTE} → ${pageCommandLabel('exclusion-builder')}`
      ],
      details: [
        'Apply reloads the tab with your exclusions; Reset discards edits and goes back to the applied set; Stop ends the session without reloading.',
        'Each feature’s mode: As served shows the page as WP Rocket serves it (the feature on or off), Simulated applies the feature to a page served without it, and Disabled (where offered) turns it off.',
        'The session lasts across the tab’s pages until you stop it or close the tab.'
      ]
    },
    {
      id: 'rucss-tester',
      screenshot: 'rucss-tester',
      title: 'RUCSS Tester',
      summary:
        'Run WP Rocket’s Remove Unused CSS on the page and see the result live, until the page reloads.',
      howTo: [`${PANEL} → Tools → RUCSS Tester`]
    },
    {
      id: 'beacon-tester',
      screenshot: 'beacon-tester',
      title: 'Beacon Tester and LCP & Vitals',
      summary:
        'Run WP Rocket’s beacon on the page to see what it would find (critical images, lazy-render elements), and break the Largest Contentful Paint into its parts beside this visit’s Core Web Vitals.',
      howTo: [`${PANEL} → Tools → Beacon Tester`, `${PANEL} → Tools → LCP & Vitals`],
      details: [
        'Each script’s live state (executed, failed, pending…) is on the JavaScript page → Runtime states.'
      ]
    },
    {
      id: 'detection-widget',
      screenshot: 'detection-widget',
      title: capitalize(PAGE_SURFACE_NAMES.detectionWidget),
      summary:
        'A pill in the page’s corner shows WP Rocket’s state at a glance; click it for the WP Rocket features the page uses and the evidence for each. Drag it anywhere.',
      howTo: [
        'Shown on every inspected page by default',
        `Right-click the page → ${pageCommandLabel('toggle-detection-widget')}`,
        'Options → Features, to change the default'
      ]
    },
    {
      id: 'toolbar-dot',
      screenshot: 'toolbar-dot',
      title: 'Status dot on the toolbar icon',
      summary:
        'The toolbar icon shows the page’s WP Rocket state at a glance; hover it to read the state in words.',
      howTo: ['Toolbar icon (pin the extension to keep it visible)'],
      details: [
        'Green: WP Rocket active, page served from cache.',
        'Blue: WP Rocket active, page not served from cache.',
        'Grey: WP Rocket not detected.'
      ]
    },
    {
      id: 'command-palette',
      screenshot: 'command-palette',
      title: PALETTE,
      summary: 'Every on-page action in one searchable list, right over the page.',
      howTo: [
        'Press {paletteShortcut} on the page',
        'Click the toolbar icon',
        `Right-click the page → ${pageCommandLabel('open-command-palette')}`
      ],
      details: ['Change the shortcut in Options → Features.']
    }
  ],
  improvements: [
    'A redesigned panel: a labeled sidebar or an icon rail, lists with filters, search and a detail pane.',
    'Faster: the panel starts with only what it shows, and each tool loads when it is first needed.',
    'Light, dark or system appearance on every surface, the on-page UI included.',
    'Code and CSS shown with syntax highlighting, with long or minified code kept readable.'
  ],
  notices: [
    {
      id: 'debugger-permission',
      title: 'New permission: “Access the page debugger backend”',
      body: 'The Exclusion Builder needs it to rewrite the page before the browser reads it, which is how it shows your exclusions without touching the site. It is used only while a builder session runs on a tab, and the browser shows its debugging bar meanwhile. Because the permission is new, the browser may turn the extension off after this update until you accept it.',
      browsers: ['chromium']
    },
    {
      id: 'popup-removed',
      title: 'No more popup or Diagnoser',
      body: 'Clicking the toolbar icon now opens the command palette on the page (or the options page on tabs without one); the Diagnoser is gone. Its support report is in the panel: Detections → Copy report.'
    },
    {
      id: 'predecessor-tool-retired',
      title: 'WPR Inspector is retired',
      body: 'Everything it did now lives here, so you can uninstall WPR Inspector.',
      items: [
        {
          label: 'WP Rocket feature detection',
          text: `${PANEL} → Detections, and the ${PAGE_SURFACE_NAMES.detectionWidget} on the page`
        },
        {
          label: 'On-page detection strip',
          text: `The ${PAGE_SURFACE_NAMES.detectionWidget}`
        },
        { label: 'RUCSS live tester', text: `${PANEL} → Tools → RUCSS Tester` },
        {
          label: 'Beacon, LCP and script views',
          text: `${PANEL} → Tools → Beacon Tester and LCP & Vitals; JavaScript → Runtime states`
        }
      ]
    }
  ]
};

/** Every indexed release's copy, by version. */
const RELEASE_COPY: Readonly<Record<ReleaseVersion, ReleaseCopy>> = {
  '3.0.0': RELEASE_3_0_0
};

/** Every release's notes, in the index's order (newest first). */
export const RELEASE_NOTES: readonly ReleaseNote[] = RELEASES.map((entry) => ({
  ...entry,
  ...RELEASE_COPY[entry.version]
}));

/**
 * Whether a note applies to a build.
 *
 * @param notice The notice.
 * @param browser The running build.
 */
export function noticeAppliesTo(notice: ReleaseNotice, browser: ReleaseBrowser): boolean {
  return notice.browsers === undefined || notice.browsers.includes(browser);
}
