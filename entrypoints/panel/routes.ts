/**
 * The panel's navigation registry — one typed row per page, owned here.
 *
 * Every nav surface (this sub-phase's provisional flat nav, the adaptive
 * grouped nav that later morphs it) and the command palette consume the rows
 * in table order; adding a page = adding one row (+ its tests), never new
 * branches in sibling surfaces. Rows carry everything a nav item renders:
 * label, icon, journey group, and a reserved flag for pages whose producer
 * ships in a later phase.
 */
import type { LucideIcon } from 'lucide-solid';
import FileCode from 'lucide-solid/icons/file-code';
import Images from 'lucide-solid/icons/images';
import ScrollText from 'lucide-solid/icons/scroll-text';
import SearchX from 'lucide-solid/icons/search-x';
import ShieldCheck from 'lucide-solid/icons/shield-check';
import Stethoscope from 'lucide-solid/icons/stethoscope';
import Zap from 'lucide-solid/icons/zap';
import type { StatusKind } from '../../components/ui/status-badge';
import type { FdtData } from '../../lib/wp-rocket/types';
import { PAYLOAD_LIMITS } from '../../lib/messaging/payload-bounds';

/** Journey groups, in the order the nav renders them. */
export const NAV_GROUPS = ['Overview', 'Inspect', 'Diagnose', 'Tools'] as const;

/** One journey group (maps to the study's IA). */
export type NavGroup = (typeof NAV_GROUPS)[number];

/** Route ids — the hash router's shared vocabulary and its parse allowlist. */
export const ROUTE_IDS = [
  'detections',
  'javascript',
  'lazyload',
  'preloaded-resources',
  'headers-cookies',
  'undefined-references',
  'diagnoser'
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
}

/**
 * A nav row's live-state selector: the owning page derives its glanceable
 * nav text from the panel's `FdtData` at `null` (no data yet) and returns
 * the row's current state — or null for "nothing to say right now".
 */
export type NavLiveStateSelector = (data: FdtData | null) => NavLiveState | null;

/** One row of the nav registry. */
export interface NavRoute {
  id: RouteId;
  /** User-facing label (P15 copy sweep owns its final wording). */
  label: string;
  /** The row's lucide icon (the nav renders it when it has room for it). */
  icon: LucideIcon;
  group: NavGroup;
  /**
   * Reserved rows have no producer yet: the nav renders them disabled with
   * {@link NavRoute.reservedNote}, and enabling the page later is one flag
   * flip. The palette likewise declines their rows. Their hash deep-links
   * still resolve — the pages table renders the shared honest placeholder
   * body until the real page ships — so a bookmarked link never dead-ends.
   */
  reserved?: boolean;
  /** What the disabled row's tooltip says (a reserved row must not dead-end). */
  reservedNote?: string;
  /** Per-row live-state selector (consumed by the adaptive nav, not this shell). */
  liveState?: NavLiveStateSelector;
}

/**
 * An English-counted chip copy: '1 image', '2 images' — or '5,000+ images'
 * for a list the producer cut to its cap (the page has more).
 *
 * @param count The load's count.
 * @param noun The singular noun the count quantifies.
 * @param partial The list was cut: the count is a floor.
 */
function counted(count: number, noun: string, partial = false): string {
  return `${shownTotal(count, partial)} ${noun}${count === 1 ? '' : 's'}`;
}

/** A shown list total: plain, or `5,000+` when the list was cut. */
function shownTotal(count: number, partial: boolean): string {
  return partial ? `${count.toLocaleString('en-US')}+` : count.toString();
}

/**
 * Whether a row's list itself was cut: the mark alone also covers clipped
 * strings, so only a marked list sitting at its count cap lost entries.
 *
 * @param truncated The row's truncation mark.
 * @param length The shown list's length.
 * @param cap The list's count cap.
 */
function listCut(truncated: true | undefined, length: number, cap: number): boolean {
  return truncated === true && length >= cap;
}

/**
 * The nav registry, in render order — today's pages. Future rows land
 * additively here with their named owners: RUCSS Tester (P13, Tools),
 * Beacon & LCP (P14, Tools), Compare (P17 — decision-gated optional SBS
 * panel home, Tools).
 *
 * The Overview row carries no live state on purpose: WPR presence, version
 * and cache age are the status bar's first-paint answers, owned there — the
 * nav would only duplicate them. Headers & Cookies stays state-free for the
 * same reason: its cache evidence condenses to the status bar's answer.
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
    liveState: (data) => {
      if (data === null || !data.wprDetections.delay_js.present) return null;
      const { delayedScripts, scripts, truncated } = data.wprDetections.delay_js;
      // The delayed count is the whole page's: never print it over a shorter
      // shown list without the "more exists" marker.
      const partial =
        listCut(truncated, scripts.length, PAYLOAD_LIMITS.delayScripts.count) ||
        delayedScripts > scripts.length;
      return {
        text: `delayed ${delayedScripts.toString()}/${shownTotal(scripts.length, partial)}`,
        tone: 'info'
      };
    }
  },
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
      const partial = listCut(truncated, count, PAYLOAD_LIMITS.images.count);
      return count > 0
        ? { text: counted(count, 'image', partial), tone: 'info' }
        : { text: 'No images', tone: 'neutral' };
    }
  },
  {
    id: 'preloaded-resources',
    label: 'Preloaded Resources',
    icon: Zap,
    group: 'Inspect',
    liveState: (data) => {
      // The feature may be present without a collected inventory (unknown) —
      // say nothing rather than a number that is not known.
      if (data === null || !data.preloadedResources.present) return null;
      const resources = data.preloadedResources.resources;
      if (resources === undefined) return null;
      return {
        text:
          resources.length > 0
            ? counted(
                resources.length,
                'link',
                listCut(
                  data.preloadedResources.truncated,
                  resources.length,
                  PAYLOAD_LIMITS.preloaded.count
                )
              )
            : 'None',
        tone: resources.length > 0 ? 'info' : 'neutral'
      };
    }
  },
  { id: 'headers-cookies', label: 'Headers & Cookies', icon: ScrollText, group: 'Inspect' },
  // Copy delta: the single-singular menu name becomes the plural the page
  // actually implements — tracked for the copy sweep.
  {
    id: 'undefined-references',
    label: 'Undefined References',
    icon: SearchX,
    group: 'Diagnose',
    liveState: (data) => {
      if (data === null) return null;
      const found = data.undefinedReferencesOnPage.length;
      if (found > 0) return { text: `${found.toString()} found`, tone: 'warn' };
      // Nothing found while the page still loads means the finder is
      // watching; once loading settled, a clean page is silence.
      return data.allScriptsLoaded ? null : { text: 'Monitoring', tone: 'neutral' };
    }
  },
  {
    id: 'diagnoser',
    label: 'Diagnoser',
    icon: Stethoscope,
    group: 'Diagnose',
    reserved: true,
    reservedNote: 'Returns with the Diagnoser plugin v2'
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
