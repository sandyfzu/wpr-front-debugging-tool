/**
 * The panel's navigation registry — one typed row per page, owned here.
 *
 * Every nav surface (this sub-phase's provisional flat nav, the adaptive
 * grouped nav that later morphs it) and the command palette consume the rows
 * in table order; adding a page = adding one row (+ its tests), never new
 * branches in sibling surfaces. Rows carry everything a nav item renders:
 * label, icon, journey group and an optional live-state selector.
 */
import type { LucideIcon } from 'lucide-solid';
import FileCode from 'lucide-solid/icons/file-code';
import Gauge from 'lucide-solid/icons/gauge';
import Images from 'lucide-solid/icons/images';
import Palette from 'lucide-solid/icons/palette';
import Radar from 'lucide-solid/icons/radar';
import ScrollText from 'lucide-solid/icons/scroll-text';
import SearchX from 'lucide-solid/icons/search-x';
import ShieldCheck from 'lucide-solid/icons/shield-check';
import TestTubeDiagonal from 'lucide-solid/icons/test-tube-diagonal';
import Zap from 'lucide-solid/icons/zap';
import type { StatusKind } from '../../components/ui/status-badge';
import { HEADER_NOUN, HINT_NOUN, IMAGE_NOUN, SCRIPT_NOUN } from '../../lib/detection/count-nouns';
import { runtimeOnPage } from '../../lib/detection/simulation-fact';
import type { FdtData } from '../../lib/wp-rocket/types';
import { PAYLOAD_LIMITS } from '../../lib/messaging/payload-bounds';
import { listCapped, countLabel, type CountNoun } from '../../lib/panel/list-behavior';
import { reportHints, reportHintsTruncated } from '../../lib/panel/resources-view-model';
import { formatCount, formatCountFloor } from '../../utils/format-count';

/** Journey groups, in the order the nav renders them. */
export const NAV_GROUPS = ['Overview', 'Inspect', 'Diagnose', 'Tools'] as const;

/** One journey group (maps to the study's IA). */
export type NavGroup = (typeof NAV_GROUPS)[number];

/** Route ids — the hash router's shared vocabulary and its parse allowlist. */
export const ROUTE_IDS = [
  'detections',
  'javascript',
  'stylesheets',
  'lazyload',
  'preloaded-resources',
  'headers-cookies',
  'undefined-references',
  'rucss-tester',
  'beacon-tester',
  'lcp-vitals'
] as const;

/** One panel page's route id. */
export type RouteId = (typeof ROUTE_IDS)[number];

/** The route the panel shows for an empty or unknown hash. */
export const DEFAULT_ROUTE: RouteId = 'detections';

/** What a nav row's live-state selector resolves to (rendered by the adaptive nav). */
export interface NavLiveState {
  /** Short state text rendered next to the label (e.g. "12 found", "delayed 3/9"). */
  text: string;
  /** The status tone from the shared vocabulary (`status-badge.tsx`). */
  tone: StatusKind;
  /**
   * The figure the labeled sidebar's narrow right column shows (e.g. "3/9");
   * absent, it shows a dot in the tone (the phrase stays the row's
   * description).
   */
  short?: string;
}

/**
 * A nav row's live-state selector: the owning page derives its glanceable
 * nav text from the panel's `FdtData` at `null` (no data yet) and returns
 * the row's current state — or null for "nothing to say right now".
 */
export type NavLiveStateSelector = (data: FdtData | null) => NavLiveState | null;

/** What a nav row's count selector resolves to: how many items its page lists. */
export interface NavCount {
  /** The listed items (the captured list's length). */
  readonly count: number;
  /** More may exist beyond the captured list (the count is a lower bound). */
  readonly partial: boolean;
  /** What is counted (the tooltip and menu phrase it: "14 scripts"). */
  readonly noun: CountNoun;
}

/**
 * A nav row's count selector: the number of items the page will list, from
 * loaded data only (the nav never calls it without data). Null when the
 * payload holds no such list (e.g. no header capture for this tab).
 */
export type NavCountSelector = (data: FdtData) => NavCount | null;

/** One row of the nav registry. */
export interface NavRoute {
  id: RouteId;
  /** Explanation-heavy routes use the same shorter canvas in every data state. */
  reading?: boolean;
  /** User-facing label (sentence case; the nav, palette and page titles read it). */
  label: string;
  /** The row's lucide icon (the nav renders it when it has room for it). */
  icon: LucideIcon;
  group: NavGroup;
  /** Per-row live-state selector (consumed by the adaptive nav, not this shell). */
  liveState?: NavLiveStateSelector;
  /**
   * Per-row item count, shown where the row has no live state to say (the
   * labeled sidebar's right column, the rail tooltip, the overflow menu).
   */
  count?: NavCountSelector;
}

/**
 * The nav registry, in render order — today's pages. A new page lands
 * additively here as one row.
 *
 * The Overview row carries no live state on purpose: WPR presence, version
 * and cache age are the top bar's first-paint answers, owned there — the
 * nav would only duplicate them. Headers & Cookies stays state-free for the
 * same reason (its cache evidence condenses to the top bar's answer); it
 * only counts its headers. Stylesheets has no count: the payload carries no
 * style list (the page reads it live on open).
 */
export const NAV_ROUTES: readonly NavRoute[] = [
  { id: 'detections', label: 'Detections', icon: ShieldCheck, group: 'Overview' },
  {
    // The glanceable count the study's interaction budget names: how many
    // page scripts the Delay-JS feature holds (delayed / every script the
    // inventory classified), so the number is visible before the page opens.
    id: 'javascript',
    label: 'JavaScript',
    icon: FileCode,
    group: 'Inspect',
    // Every page script, delayed or not (the page's rows), for when Delay JS
    // is not on the page and the live state stays silent.
    count: (data) => {
      const { scripts, truncated } = data.wprDetections.delay_js;
      return {
        count: scripts.length,
        partial: listCapped(truncated, scripts.length, PAYLOAD_LIMITS.delayScripts.count),
        noun: SCRIPT_NOUN
      };
    },
    liveState: (data) => {
      if (data === null || !runtimeOnPage(data.wprDetections.delay_js)) return null;
      const { delayedScripts, scripts, truncated } = data.wprDetections.delay_js;
      // The delayed count is the whole page's: never print it over a shorter
      // shown list without the lower-bound marker.
      const partial =
        listCapped(truncated, scripts.length, PAYLOAD_LIMITS.delayScripts.count) ||
        delayedScripts > scripts.length;
      const ratio = `${formatCount(delayedScripts)}/${formatCountFloor(scripts.length, partial)}`;
      return { text: `delayed ${ratio}`, tone: 'info', short: ratio };
    }
  },
  // Read live from the page on open (the payload carries no style list), so
  // the row has no number to show before the page opens.
  { id: 'stylesheets', label: 'Stylesheets', icon: Palette, group: 'Inspect' },
  {
    id: 'lazyload',
    label: 'Lazyload',
    icon: Images,
    group: 'Inspect',
    liveState: (data) => {
      if (data === null || !data.wprDetections.lazyload.present) return null;
      // The feature is active either way; "no images" is the page's state.
      const { images, truncated } = data.wprDetections.lazyload;
      const count = images.length;
      const partial = listCapped(truncated, count, PAYLOAD_LIMITS.images.count);
      return count > 0
        ? {
            text: countLabel(count, IMAGE_NOUN, partial),
            tone: 'info',
            short: formatCountFloor(count, partial)
          }
        : { text: 'No images', tone: 'neutral', short: '0' };
    }
  },
  {
    id: 'preloaded-resources',
    label: 'Preloaded Resources',
    icon: Zap,
    group: 'Inspect',
    liveState: (data) => {
      // No data, no hint or no collected list (unknown): say nothing rather
      // than a number that is not known.
      if (data === null) return null;
      const report = data.preloadedResources;
      const count = reportHints(report).length;
      if (count === 0) return null;
      const partial = listCapped(
        reportHintsTruncated(report),
        count,
        PAYLOAD_LIMITS.preloaded.count
      );
      return {
        text: countLabel(count, HINT_NOUN, partial),
        tone: 'info',
        short: formatCountFloor(count, partial)
      };
    }
  },
  {
    id: 'headers-cookies',
    label: 'Headers & Cookies',
    icon: ScrollText,
    group: 'Inspect',
    // The captured response headers (no capture for this tab: nothing to count).
    count: (data) => {
      const headers = data.pageHeaders;
      if (headers === null) return null;
      return {
        count: headers.length,
        partial: listCapped(
          data.pageHeadersTruncated,
          headers.length,
          PAYLOAD_LIMITS.headers.count
        ),
        noun: HEADER_NOUN
      };
    }
  },
  // Copy delta: the single-singular menu name becomes the plural the page
  // actually implements — tracked for the copy sweep.
  {
    id: 'undefined-references',
    reading: true,
    label: 'Undefined References',
    icon: SearchX,
    group: 'Diagnose',
    liveState: (data) => {
      if (data === null) return null;
      const found = data.undefinedReferencesOnPage.length;
      if (found > 0) {
        return { text: `${formatCount(found)} found`, tone: 'warn', short: formatCount(found) };
      }
      // Nothing found while the page still loads means the finder is
      // watching; once loading settled, a clean page is silence.
      return data.allScriptsLoaded ? null : { text: 'Monitoring', tone: 'neutral' };
    }
  },
  {
    // A tool, not a reading of the page: TEST MODE is the page's own fact
    // (Detections and the on-page widget carry it), so the row stays quiet.
    id: 'rucss-tester',
    label: 'RUCSS Tester',
    icon: TestTubeDiagonal,
    group: 'Tools'
  },
  {
    // A tool like the RUCSS Tester: its results are a run's, not the page's
    // payload, so the row stays quiet.
    id: 'beacon-tester',
    label: 'Beacon Tester',
    icon: Radar,
    group: 'Tools'
  },
  {
    // A tool too: its answers are asked of the live page on demand, not
    // read from the payload, so the row stays quiet.
    id: 'lcp-vitals',
    label: 'LCP & Vitals',
    icon: Gauge,
    group: 'Tools'
  }
];

/**
 * Guard every raw location hash against: is it a "usable" route id?
 *
 * @param value Any string a hash, storage or user input produced.
 */
export function isRouteId(value: string): value is RouteId {
  return (ROUTE_IDS as readonly string[]).includes(value);
}

/** The registry row for a route id, or undefined for a foreign one. */
export function navRoute(id: RouteId): NavRoute | undefined {
  return NAV_ROUTES.find((row) => row.id === id);
}
