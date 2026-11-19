/**
 * The Detections page's card view model: `FdtData` → the typed card list the
 * page renders. Pure — presentation decisions (layout, palette, motion)
 * belong to the page; this model owns the card set, the verdicts and the
 * per-card subtitle composition; feature names, order, evidence source and
 * unsure-state wording come from the HUD registry (`lib/detection/hud`), so
 * the cards, the on-page strip and the report name a feature one way.
 *
 * Cards are keyed by the detection row's id (plus the three derived cards'
 * ids) — never by an index or a magic number, so a card's identity survives
 * the record's shape evolving and a future detection row joins the set with
 * no card-list edit.
 */

import {
  BYPASS_APPLIED_COPY,
  isAppliedDespiteBypass,
  isBypassRender,
  type BypassAppliedCopy,
  type BypassAppliedRow
} from '../detection/bypass-applied';
import {
  describeDetections,
  formatCacheTimestamp,
  isRepresentableCacheStamp,
  type PageAnalysisReport
} from '../detection/describe';
import {
  builderModifierCopy,
  HUD_FEATURES,
  DNS_PREFETCH_LIMIT,
  dnsPrefetchHintText,
  MOBILE_CACHE_LIMIT,
  mobileCacheRenderText,
  simulationModifierCopy,
  hudFeatureOf,
  readHudFeature,
  type HudFeature,
  type HudVerdict
} from '../detection/hud';
import { LABEL_OPTIMIZE_CSS_DELIVERY, LABEL_PRIORITY_ELEMENTS_BEACON } from '../detection/labels';
import {
  capturedHostLayers,
  HOST_LAYER_ADD_ON_CAVEAT,
  HOST_LAYER_READING_TEXT,
  type CapturedHostLayer
} from '../detection/host-layers';
import { countNoun } from '../../utils/format-count';
import { KNOWN_PLATFORMS } from '../wp-rocket/constants';
import type {
  BuilderFact,
  FdtData,
  FeatureEvidenceSource,
  PageHeader,
  SimulationFact,
  WprDetections
} from '../wp-rocket/types';
import { getRealOptionName } from '../options-map/get-real-option-name';
import { capitalize } from '../../utils/text';

/**
 * A card's verdict. `collecting` (an enabled Priority Elements feature not
 * yet applied) and `unknown` (an undecided row whose footprint cannot prove
 * absence) are the two unsure states; neither counts as active.
 */
export type StatusKind = 'active' | 'collecting' | 'unknown' | 'not-active';

/** One detection row of the record, named by its own id (the card key). */
export type DetectionRow = keyof WprDetections;

/** The card list's key vocabulary: four derived cards + every detection row. */
export type StatusItemId = 'server' | 'known-platform' | 'host-layers' | 'cached' | DetectionRow;

/**
 * The richer subtitle data the redesigned cards render beyond the one-line
 * copy: the server value, the platform + the header that named it, the cache
 * the captured host layers, the cache
 * stamp (the stamp only when it is a representable instant — a hostile
 * page-crafted digit run stays out of downstream math), a version string,
 * a preloaded-image count, and a declaration-only fact with its proof
 * limit (the mobile cache render's device, the DNS prefetch hints seen).
 */
export type StatusItemDetail =
  | { readonly kind: 'server'; readonly value: string }
  | { readonly kind: 'platform'; readonly name: string; readonly header: string }
  | { readonly kind: 'host-layers'; readonly layers: readonly CapturedHostLayer[] }
  | {
      readonly kind: 'cached-at';
      readonly seconds: number | null;
      readonly formatted: string | null;
    }
  | { readonly kind: 'version'; readonly version: string | null }
  | { readonly kind: 'preloaded-images'; readonly count: number }
  | { readonly kind: 'proof-limit'; readonly text: string; readonly limit: string };

/**
 * The declaration-only rows whose active card states a page fact under its
 * proof limit (the subtitle, with the limit as its tooltip/report detail).
 */
const PROOF_LIMIT_CARDS: Readonly<
  Record<
    'mobile_cache' | 'dns_prefetch',
    { readonly text: (detections: WprDetections) => string; readonly limit: string }
  >
> = {
  mobile_cache: {
    text: (detections) =>
      mobileCacheRenderText(
        detections.mobile_cache.variant,
        detections.priority_elements_beacon.isMobile
      ),
    limit: MOBILE_CACHE_LIMIT
  },
  dns_prefetch: {
    text: (detections) => dnsPrefetchHintText(detections.dns_prefetch),
    limit: DNS_PREFETCH_LIMIT
  }
};

/** One status card: name, verdict, subtitle copy and its richer detail. */
export interface StatusItem {
  readonly id: StatusItemId;
  readonly name: string;
  readonly status: StatusKind;
  readonly subtitle?: string;
  readonly detail?: StatusItemDetail;
  /** The evidence class that decided a feature card, when one did. */
  readonly source?: FeatureEvidenceSource;
  /** The sentence explaining an unsure verdict (`collecting` / `unknown`). */
  readonly why?: string;
  /**
   * The declared-only sentence (the shared HUD copy): WP Rocket's meta
   * declared the feature, but the page holds nothing it acted on — beside an
   * active verdict only.
   */
  readonly declaredOnly?: string;
  /**
   * The Exclusion Builder's effect on this feature in this tab — a modifier
   * on top of `status` (the served verdict), present only when the page
   * states one.
   */
  readonly builder?: BuilderFact;
  /** The modifier's sentence (the shared builder copy), beside `builder`. */
  readonly modifier?: string;
  /** The modifier's chip text (the shared builder copy), beside `builder`. */
  readonly modifierChip?: string;
  /**
   * The extension's simulation of this feature in this tab (`simulated`:
   * verified, so `status` is not served; `unverified`: `status` reads the
   * page as served) — a second modifier, present only when the page states one.
   */
  readonly simulation?: SimulationFact;
  /** The simulation modifier's sentence (the shared simulation copy), beside `simulation`. */
  readonly simulationSentence?: string;
  /** The simulation modifier's chip text (the shared simulation copy), beside `simulation`. */
  readonly simulationChip?: string;
  /**
   * The "applied despite the bypass" warning (the shared copy): WP Rocket
   * applied this feature on a render whose URL requested its bypass —
   * present only then, never on a simulated row.
   */
  readonly bypassWarning?: BypassAppliedCopy;
}

/** The measurement beacon's verified label (the one non-feature row the option map lacks). */
const NON_FEATURE_ROW_LABELS: ReadonlyMap<DetectionRow, string> = new Map([
  ['priority_elements_beacon', LABEL_PRIORITY_ELEMENTS_BEACON]
]);

/**
 * Card name for a detection row: the HUD registry's full name for a feature,
 * else the option map's label (the plugin identity row), else the verified
 * non-feature label, else the raw row id. The raw-id fallback is the record-typed
 * keying's futures-tolerance design, not a defect path: a future detection
 * row is carded automatically (named by its own id until the vocabulary learns
 * it). Row VALUES that are not `{ present }`-shaped are a boundary concern —
 * the payload validator rebuilds the exact record, so the fallback only ever
 * reads rows that are, with one extra keyed row being shape-tolerant by
 * design (pinned by the view model's "futures tolerance" test).
 */
function cardName(row: DetectionRow): string {
  const feature = hudFeatureOf(row);
  if (feature !== undefined) return feature.label;
  const mapped = getRealOptionName(row);
  if (mapped !== row) return mapped;
  return NON_FEATURE_ROW_LABELS.get(row) ?? row;
}

/**
 * The record's rows in render order: the plugin identity row, then the HUD
 * registry's features in its order, then every other row in the payload's
 * declaring order (the beacon, and any future row — enumerated, never
 * dropped). Keys other than the record's own ids are impossible by
 * construction; the cast pins that fact for the compiler once, here.
 */
function detectionRows(detections: WprDetections): DetectionRow[] {
  const own = Object.keys(detections) as DetectionRow[];
  const ownSet = new Set<DetectionRow>(own);
  const features = HUD_FEATURES.map((feature) => feature.row).filter((row) => ownSet.has(row));
  const featureSet = new Set<DetectionRow>(features);
  const rest = own.filter((row) => row !== 'wpr' && !featureSet.has(row));
  return [...(ownSet.has('wpr') ? (['wpr'] as const) : []), ...features, ...rest];
}

/** The card verdict of a HUD verdict (the report's state, folded to the card's four). */
const CARD_STATUS: Readonly<Record<HudVerdict, StatusKind>> = {
  applied: 'active',
  collecting: 'collecting',
  unknown: 'unknown',
  'not enabled': 'not-active',
  'not applied': 'not-active'
};

/**
 * A feature card's verdict + evidence decoration, read through the HUD
 * registry (the report's composition is the state's one owner).
 *
 * @param row The feature row.
 * @param report The page-analysis report.
 * @param detections The engine rows.
 * @param bypassRender The page is a bypass render (`isBypassRender`).
 * @returns The status plus the optional source/why/modifier fields
 *   (spread-ready — absent fields are omitted, never own `undefined`s).
 */
function featureFacts(
  row: DetectionRow,
  report: PageAnalysisReport,
  detections: WprDetections,
  bypassRender: boolean
): Pick<StatusItem, 'status' | 'source' | 'why' | 'declaredOnly' | FeatureModifierField> {
  const feature = hudFeatureOf(row);
  if (feature === undefined) {
    // A row outside the registry (a future row): its presence is the answer.
    return { status: detections[row].present ? 'active' : 'not-active' };
  }
  const reading = readHudFeature(feature, report, detections);
  return {
    status: CARD_STATUS[reading.verdict],
    ...(reading.source === null ? {} : { source: reading.source }),
    ...(reading.why === null ? {} : { why: capitalize(reading.why) }),
    ...(reading.declaredOnly === undefined
      ? {}
      : { declaredOnly: capitalize(reading.declaredOnly) }),
    ...(reading.builder === undefined ? {} : builderFacts(feature, reading.builder)),
    ...(reading.simulation === undefined ? {} : simulationFacts(reading.simulation)),
    ...bypassFacts(detections[feature.row], bypassRender)
  };
}

/**
 * The card fields the modifiers fill: the two in-tab ones (builder,
 * simulation) and the bypass warning.
 */
type FeatureModifierField =
  | 'builder'
  | 'modifier'
  | 'modifierChip'
  | 'simulation'
  | 'simulationSentence'
  | 'simulationChip'
  | 'bypassWarning';

/**
 * A feature card's bypass warning field, when the row earns it.
 *
 * @param row The feature's detection row.
 * @param bypassRender The page is a bypass render (`isBypassRender`).
 * @returns The spread-ready field, or nothing.
 */
function bypassFacts(
  row: BypassAppliedRow,
  bypassRender: boolean
): Pick<StatusItem, 'bypassWarning'> {
  return isAppliedDespiteBypass(row, bypassRender) ? { bypassWarning: BYPASS_APPLIED_COPY } : {};
}

/**
 * A feature card's simulation fields: the fact plus its shared copy.
 *
 * @param fact The row's simulation fact.
 */
function simulationFacts(
  fact: SimulationFact
): Pick<StatusItem, 'simulation' | 'simulationSentence' | 'simulationChip'> {
  const copy = simulationModifierCopy(fact);
  return { simulation: fact, simulationSentence: copy.sentence, simulationChip: copy.chip };
}

/**
 * A feature card's builder fields: the fact plus its shared copy.
 *
 * @param feature The HUD row.
 * @param fact The row's builder fact.
 */
function builderFacts(
  feature: HudFeature,
  fact: BuilderFact
): Pick<StatusItem, 'builder' | 'modifier' | 'modifierChip'> {
  const copy = builderModifierCopy(feature, fact);
  return { builder: fact, modifier: copy.sentence, modifierChip: copy.chip };
}

/**
 * The capture's header rows, keyed by lowercase header name with later
 * duplicate rows winning — the intake shape both card sources read (the row
 * stays whole so captured-casing header names are available to details).
 */
function lastRowByName(headers: readonly PageHeader[]): Map<string, PageHeader> {
  const map = new Map<string, PageHeader>();
  for (const row of headers) {
    map.set(row.name.toLowerCase(), row);
  }
  return map;
}

/**
 * The capture's header truth rule (shared with the top bar's answers): a
 * row's value is present when present and non-empty once trimmed — a
 * name-only row and a whitespace-only value both say "no value".
 */
function headerValue(row: PageHeader): string {
  return (row.value ?? '').trim();
}

/**
 * A platform match result: the platform's registry name and the captured
 * header that named it.
 */
interface PlatformMatch {
  readonly name: string;
  readonly header: string;
}

/**
 * The first known platform whose declared headers match the capture:
 * value-less declared headers match on the header's presence alone; a
 * value-declared header matches when the captured value contains the
 * expected value (trimmed, case-insensitive — real platform headers carry
 * suffixes, e.g. "WP Engine/…"). The registry order is the scan order; a
 * row whose value carries no match leaves that platform's own later headers
 * the chance to match, then the scan proceeds to the next platform.
 *
 * @returns The match, or null when no known platform's headers matched.
 */
function resolvePlatform(headers: readonly PageHeader[]): PlatformMatch | null {
  const captured = lastRowByName(headers);
  for (const [name, declaredHeaders] of KNOWN_PLATFORMS) {
    for (const declared of declaredHeaders) {
      const row = captured.get(declared.headerName.toLowerCase());
      if (row === undefined) continue;
      if (declared.value === undefined) return { name, header: row.name };
      if (headerValue(row).toLowerCase().includes(declared.value.trim().toLowerCase())) {
        return { name, header: row.name };
      }
    }
  }
  return null;
}

/**
 * The Host layers card, or null when the capture names no host layer (an
 * absent layer is never a negative, so it gets no card).
 *
 * @param headers The captured response headers.
 * @returns The card: each layer with its state in the subtitle, the layers in the detail.
 */
function hostLayersItem(headers: readonly PageHeader[]): StatusItem | null {
  const layers = capturedHostLayers(headers);
  if (layers.length === 0) return null;
  return {
    id: 'host-layers',
    name: 'Host layers',
    status: 'active',
    subtitle: layers.map(hostLayerText).join(' · '),
    detail: { kind: 'host-layers', layers }
  };
}

/**
 * One captured layer as words: its label and state.
 *
 * @param layer The captured layer.
 * @returns E.g. "Cloudflare: cache hit".
 */
export function hostLayerText(layer: CapturedHostLayer): string {
  return `${layer.label}: ${HOST_LAYER_READING_TEXT[layer.reading]}`;
}

/** The tooltip's header noun in its count forms. */
const RESPONSE_HEADER_NOUN = { one: 'response header', other: 'response headers' } as const;

/**
 * The Host layers card's tooltip: the headers that named the layers (the
 * noun agreeing with their count, as the Known Platform card's singular
 * line does) and the add-on caveat.
 *
 * @param layers The captured layers (never empty: no layer, no card).
 * @returns E.g. "Identified by the cf-cache-status, cf-ray response headers. …".
 */
export function hostLayersTooltip(layers: readonly CapturedHostLayer[]): string {
  const headers = layers.flatMap((layer) => layer.headers);
  return `Identified by the ${headers.join(', ')} ${countNoun(headers.length, RESPONSE_HEADER_NOUN)}. ${HOST_LAYER_ADD_ON_CAVEAT}`;
}

/**
 * Build the status cards for one loaded data state.
 *
 * Structure (in render order):
 * 1. **Headers-derived cards exist only when headers were captured**
 *    (`pageHeaders` null ⇒ all omitted silently) — the `Server` card's
 *    verdict follows the captured value (a value-less row is no value), and
 *    the `Known Platform` card exists only when a known platform's headers
 *    matched, and the `Host layers` card only when a host-layer header was
 *    captured.
 * 2. The `wpr` card, then one card per feature in HUD order (verdict,
 *    source chip and unsure-state why from the HUD reading), then every
 *    other row (the beacon, any future row) — except `async_css`, whose state is carried
 *    by the "Optimize CSS delivery" card: with RUCSS absent but async-CSS
 *    applied the card is renamed to async CSS's own name and marked active;
 *    with both absent the card reads as the shared "Optimize CSS delivery"
 *    feature in its natural not-active state (the subtle presentation
 *    rules, ported deliberately).
 * 3. The `wpr` row carries the version subtitle and, on a cached page, the
 *    separate **Cached** card: the subtitle and detail carry the UTC
 *    formatting, the raw page-provided seconds ride the detail only when
 *    they name a real instant.
 *
 * @param data The loaded page data.
 */
export function buildStatusItems(data: FdtData): StatusItem[] {
  const items: StatusItem[] = [];
  const detections = data.wprDetections;
  const statusOf = (present: boolean): StatusKind => (present ? 'active' : 'not-active');
  // One report per build: the HUD readings' state owner.
  const report = describeDetections(detections);
  const bypassRender = isBypassRender(data.bypassAttested === true, data.wprGeneratorMeta === true);
  const readFacts = (row: DetectionRow): ReturnType<typeof featureFacts> =>
    featureFacts(row, report, detections, bypassRender);

  if (data.pageHeaders !== null) {
    const captured = lastRowByName(data.pageHeaders);
    const serverRow = captured.get('server');
    const server = serverRow === undefined ? '' : headerValue(serverRow);
    items.push(
      server === ''
        ? { id: 'server', name: 'Server', status: 'not-active' }
        : {
            id: 'server',
            name: 'Server',
            status: 'active',
            subtitle: server,
            detail: { kind: 'server', value: server }
          }
    );
    const platform = resolvePlatform(data.pageHeaders);
    if (platform !== null) {
      items.push({
        id: 'known-platform',
        name: 'Known Platform',
        status: 'active',
        subtitle: platform.name,
        detail: { kind: 'platform', name: platform.name, header: platform.header }
      });
    }
    const hostLayers = hostLayersItem(data.pageHeaders);
    if (hostLayers !== null) items.push(hostLayers);
  }

  for (const row of detectionRows(detections)) {
    if (row === 'async_css') continue;
    switch (row) {
      case 'wpr': {
        const wpr = detections.wpr;
        items.push(
          wpr.present
            ? {
                id: row,
                name: cardName(row),
                status: statusOf(wpr.present),
                subtitle:
                  wpr.version === null ? 'Version: not available' : `Version: ${wpr.version}`,
                detail: { kind: 'version', version: wpr.version }
              }
            : { id: row, name: cardName(row), status: statusOf(wpr.present) }
        );
        if (wpr.cached) {
          const stamp = isRepresentableCacheStamp(wpr.timeStamp) ? wpr.timeStamp : null;
          const formatted = stamp === null ? null : formatCacheTimestamp(stamp);
          items.push({
            id: 'cached',
            name: 'Cached',
            status: 'active',
            subtitle: formatted ?? undefined,
            detail: { kind: 'cached-at', seconds: stamp, formatted }
          });
        }
        continue;
      }
      case 'remove_unused_css': {
        const rucssPresent = detections.remove_unused_css.present;
        const asyncCssPresent = detections.async_css.present;
        if (!asyncCssPresent && !rucssPresent) {
          // Both absent: the shared feature's own card, without the
          // "which one of the two" subtitle. A meta that refuted both rows
          // decided the card, like any other refuted card.
          const refuted =
            detections.remove_unused_css.source === 'meta' &&
            detections.async_css.source === 'meta';
          items.push({
            id: row,
            name: LABEL_OPTIMIZE_CSS_DELIVERY,
            status: 'not-active',
            ...(refuted ? { source: 'meta' as const } : {})
          });
          continue;
        }
        // Async CSS applied by itself stands in for the disabled RUCSS card
        // (the merge's standalone-evidence branch) — both render states here
        // are the applied one, hence the fixed active verdict.
        const shown = rucssPresent ? row : 'async_css';
        const source = detections[shown].source;
        items.push({
          id: row,
          name: cardName(shown),
          status: 'active',
          subtitle: LABEL_OPTIMIZE_CSS_DELIVERY,
          ...(source === undefined ? {} : { source }),
          ...bypassFacts(detections[shown], bypassRender)
        });
        continue;
      }
      case 'delay_js': {
        const facts = readFacts(row);
        const version = detections.delay_js.version;
        items.push(
          version === null
            ? { id: row, name: cardName(row), ...facts }
            : {
                id: row,
                name: cardName(row),
                ...facts,
                subtitle: `Version: ${version}`,
                detail: { kind: 'version', version }
              }
        );
        continue;
      }
      case 'lazyload_iframes': {
        const facts = readFacts(row);
        // The replacement script ships with the option: on a declared-only
        // card it names nothing the page holds.
        const replaceImage =
          detections.lazyload_iframes.replaceImage && facts.declaredOnly === undefined;
        items.push(
          replaceImage
            ? {
                id: row,
                name: cardName(row),
                ...facts,
                subtitle: 'Replace iframe with preview image'
              }
            : { id: row, name: cardName(row), ...facts }
        );
        continue;
      }
      case 'rocket_above_the_fold_optimization': {
        const facts = readFacts(row);
        const count = detections.rocket_above_the_fold_optimization.preloadedImages?.length ?? 0;
        // Applied evidence only: the presentation's coarse count (past nine
        // it reads "9+", not the exact figure the card would only sit on).
        // A refuted render's remnant preloads assert nothing, and the
        // collecting/not-enabled states speak through the verdict + why —
        // the beacon row never lends this card a subtitle of its own.
        items.push(
          facts.status === 'active' && count > 0
            ? {
                id: row,
                name: cardName(row),
                ...facts,
                subtitle: `Preloaded images detected: ${count <= 9 ? count.toString() : '9+'}`,
                detail: { kind: 'preloaded-images', count }
              }
            : { id: row, name: cardName(row), ...facts }
        );
        continue;
      }
      case 'mobile_cache':
      case 'dns_prefetch': {
        const facts = readFacts(row);
        // Only a declared row states its fact; the limit rides as its detail.
        // A declared-only row has no fact to state: its sentence says so.
        if (facts.status !== 'active' || facts.declaredOnly !== undefined) {
          items.push({ id: row, name: cardName(row), ...facts });
          continue;
        }
        const text = PROOF_LIMIT_CARDS[row].text(detections);
        items.push({
          id: row,
          name: cardName(row),
          ...facts,
          subtitle: text,
          detail: { kind: 'proof-limit', text, limit: PROOF_LIMIT_CARDS[row].limit }
        });
        continue;
      }
      default:
        items.push({ id: row, name: cardName(row), ...readFacts(row) });
    }
  }
  return items;
}
