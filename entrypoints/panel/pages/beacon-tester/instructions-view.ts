/**
 * The beacon instructions card's pure view: what WP Rocket told its beacon
 * on the inspected page, read from the detection payload's already-parsed
 * beacon row (never the page, never a second decoder). The row carries only
 * the config fields the detection keeps — status map, device and the six
 * lists — so the raw view cannot hold the request fields the plugin also
 * sends (its nonce, AJAX URL, thresholds).
 *
 * States: no beacon (one calm line) · beacon with an unreadable config ·
 * instructions · instructions from an earlier page load that are no longer
 * on the page (the page reloaded or navigated to a load without a beacon).
 */
import {
  BEACON_STATUS_KEY_LABELS,
  LABEL_OPTIMIZE_CRITICAL_IMAGES,
  LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS,
  LABEL_PRELOAD_FONTS
} from '../../../../lib/detection/labels';
import { BEACON_STATUS_KEYS } from '../../../../lib/wp-rocket/constants';
import type {
  BeaconFeatureStatus,
  PriorityElementsBeaconDetection
} from '../../../../lib/wp-rocket/types';
import { formatCount } from '../../../../utils/format-count';
import type { DataState } from '../../state/fdt-state-machine';
import { isOtherLoad, pageIdOf } from '../../state/page-identity';

/** The card's heading. */
export const INSTRUCTIONS_TITLE = 'Beacon instructions on this page';

/** The one line of a page without the beacon. */
export const NO_INSTRUCTIONS_COPY =
  'No beacon on this page: WP Rocket adds it only while a feature still needs measuring here.';

/** The one line of a beacon whose config could not be read. */
export const UNREADABLE_INSTRUCTIONS_COPY =
  'The beacon is on this page, but its instructions could not be read.';

/** The notice over instructions of an earlier page load. */
export const STALE_INSTRUCTIONS_TITLE = 'No longer on the page';
export const STALE_INSTRUCTIONS_COPY =
  'The page reloaded or changed and has no beacon instructions now. These are from an earlier page load.';

/** An empty list's word. */
export const EMPTY_LIST_COPY = 'None';

/** A group whose lists the config did not send at all. */
export const NOTHING_SENT_COPY = 'None sent';

/** Items a list renders before its "+N more" line (real configs sit far below). */
export const LIST_DISPLAY_MAX = 50;

/**
 * Characters the raw view renders before its cut note: the parser caps the
 * config text at 65,536 characters, so the pretty-printed view stays below
 * about 90,000 (real ones are a few hundred). Copy always takes the whole text.
 */
export const RAW_DISPLAY_MAX_CHARS = 50_000;

/** One feature toggle of the status map. */
export interface FeatureRow {
  /** WP Rocket's feature name, or the plugin's raw key for a key this tool does not know. */
  readonly label: string;
  /** Whether the label is the raw key (rendered as code). */
  readonly rawKey: boolean;
  readonly on: boolean;
}

/** One list the config sent, as displayed. */
export interface InstructionList {
  /** Stable hook (the config field name). */
  readonly id: string;
  readonly label: string;
  /** Every entry's count (what the list holds, not what renders). */
  readonly count: number;
  /** The entries that render (at most {@link LIST_DISPLAY_MAX}). */
  readonly shown: readonly string[];
  /** Entries left to the raw view. */
  readonly hidden: number;
}

/** The two list groups. */
export interface InstructionGroup {
  readonly id: 'elements' | 'exclusions';
  readonly title: string;
  /** Entries across the group's lists. */
  readonly count: number;
  /** Only the lists the config sent (an absent field is not an empty list). */
  readonly lists: readonly InstructionList[];
}

/** Readable instructions, ready to render. */
export interface InstructionsView {
  /** The collapsed line: features on and the device. */
  readonly summary: string;
  /** The summary's hover text: every feature by state. */
  readonly summaryTitle: string;
  readonly features: readonly FeatureRow[];
  /** "N of M on". */
  readonly featuresCount: string;
  readonly device: string;
  readonly groups: readonly InstructionGroup[];
  /** The instructions as pretty JSON (whole; copy takes it). */
  readonly raw: string;
}

/** What the card shows. */
export type InstructionsCardState =
  | { readonly kind: 'none' }
  | { readonly kind: 'unreadable' }
  | { readonly kind: 'instructions'; readonly view: InstructionsView }
  /** The page's load has no beacon; these instructions are the earlier load's. */
  | { readonly kind: 'stale'; readonly view: InstructionsView };

/** The groups' titles. */
export const GROUP_TITLES = {
  features: 'Features',
  elements: 'Elements checked',
  exclusions: 'Exclusions'
} as const;

/** A list field of the beacon row (the `elements` string included). */
type ListField = Exclude<keyof PriorityElementsBeaconDetection, 'present' | 'status' | 'isMobile'>;

/** Each group's lists, in display order, with their labels. */
const GROUP_LISTS: Readonly<
  Record<InstructionGroup['id'], readonly { field: ListField; label: string }[]>
> = {
  elements: [
    { field: 'elements', label: `${LABEL_OPTIMIZE_CRITICAL_IMAGES}: selectors` },
    {
      field: 'preconnect_external_domain_elements',
      label: `${LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS}: tags`
    },
    { field: 'processed_extensions', label: `${LABEL_PRELOAD_FONTS}: font file types` }
  ],
  exclusions: [
    { field: 'preconnect_external_domain_exclusions', label: LABEL_PRECONNECT_TO_EXTERNAL_DOMAINS },
    { field: 'preload_fonts_exclusions', label: `${LABEL_PRELOAD_FONTS}: fonts` },
    { field: 'external_font_exclusions', label: `${LABEL_PRELOAD_FONTS}: external font domains` }
  ]
};

/**
 * Split the comma-joined selector string into its selectors, for display
 * only (the payload keeps the plugin's string verbatim).
 *
 * @param elements The `elements` config value.
 * @returns The trimmed, non-empty selectors in order.
 */
export function splitSelectors(elements: string): string[] {
  return elements
    .split(',')
    .map((selector) => selector.trim())
    .filter((selector) => selector !== '');
}

/**
 * The visiting device the config was generated for.
 *
 * @param isMobile The row's device flag.
 * @returns "Mobile", "Desktop", or a line saying the config did not state it.
 */
export function deviceLabel(isMobile: boolean | null): string {
  if (isMobile === null) return 'Device not stated';
  return isMobile ? 'Mobile' : 'Desktop';
}

/**
 * The status map as feature rows: the four known features always (an absent
 * key means off — the plugin omits some keys when a feature is not allowed),
 * then any other boolean key under its raw name. Non-boolean unknown values
 * are not toggles; they stay visible in the raw view only.
 *
 * @param status The parsed status map.
 * @returns The rows in display order.
 */
export function featureRows(status: BeaconFeatureStatus): FeatureRow[] {
  const known: FeatureRow[] = BEACON_STATUS_KEYS.map((key) => ({
    label: BEACON_STATUS_KEY_LABELS[key],
    rawKey: false,
    on: status[key] === true
  }));
  const knownKeys: readonly string[] = BEACON_STATUS_KEYS;
  const extra: FeatureRow[] = Object.entries(status)
    .filter(
      (entry): entry is [string, boolean] =>
        !knownKeys.includes(entry[0]) && typeof entry[1] === 'boolean'
    )
    .map(([key, on]) => ({ label: key, rawKey: true, on }));
  return [...known, ...extra];
}

/**
 * One list as displayed, cut to {@link LIST_DISPLAY_MAX}.
 *
 * @param id The config field.
 * @param label The list's label.
 * @param entries Every entry.
 */
export function displayList(
  id: string,
  label: string,
  entries: readonly string[]
): InstructionList {
  const shown = entries.slice(0, LIST_DISPLAY_MAX);
  return { id, label, count: entries.length, shown, hidden: entries.length - shown.length };
}

/**
 * A group's lists, only those the config sent.
 *
 * @param id The group.
 * @param beacon The beacon row.
 */
export function instructionGroup(
  id: InstructionGroup['id'],
  beacon: PriorityElementsBeaconDetection
): InstructionGroup {
  const lists: InstructionList[] = [];
  for (const { field, label } of GROUP_LISTS[id]) {
    const value = beacon[field];
    if (value === undefined) continue;
    lists.push(
      displayList(field, label, typeof value === 'string' ? splitSelectors(value) : value)
    );
  }
  return {
    id,
    title: GROUP_TITLES[id],
    count: lists.reduce((sum, list) => sum + list.count, 0),
    lists
  };
}

/**
 * The instructions as pretty JSON, from an explicit allowlist of the row's
 * config fields — never a spread, so no other key can reach the raw view.
 *
 * @param beacon The beacon row.
 * @returns The JSON text.
 */
export function rawInstructions(beacon: PriorityElementsBeaconDetection): string {
  const raw: Record<string, unknown> = { status: beacon.status, isMobile: beacon.isMobile };
  for (const field of [...GROUP_LISTS.elements, ...GROUP_LISTS.exclusions]) {
    const value = beacon[field.field];
    if (value !== undefined) raw[field.field] = value;
  }
  return JSON.stringify(raw, null, 2);
}

/**
 * The raw text the code block renders: whole, or its first
 * {@link RAW_DISPLAY_MAX_CHARS} characters.
 *
 * @param raw The whole JSON.
 * @returns The shown text and whether it was cut.
 */
export function rawDisplay(raw: string): { readonly text: string; readonly cut: boolean } {
  return raw.length > RAW_DISPLAY_MAX_CHARS
    ? { text: raw.slice(0, RAW_DISPLAY_MAX_CHARS), cut: true }
    : { text: raw, cut: false };
}

/**
 * The raw view's cut note.
 *
 * @returns The note naming the shown length.
 */
export function rawCutNote(): string {
  return `Showing the first ${formatCount(RAW_DISPLAY_MAX_CHARS)} characters. Copy takes them all.`;
}

/**
 * A list's line for entries left to the raw view.
 *
 * @param hidden How many entries do not render.
 */
export function hiddenEntriesNote(hidden: number): string {
  return `+${formatCount(hidden)} more in the raw view`;
}

/**
 * Describe readable instructions.
 *
 * @param beacon A present beacon row whose status map parsed.
 * @param status That status map.
 */
export function describeInstructions(
  beacon: PriorityElementsBeaconDetection,
  status: BeaconFeatureStatus
): InstructionsView {
  const features = featureRows(status);
  const on = features.filter((row) => row.on);
  const off = features.filter((row) => !row.on);
  const device = deviceLabel(beacon.isMobile);
  const ratio = `${formatCount(on.length)} of ${formatCount(features.length)}`;
  const names = (rows: readonly FeatureRow[]): string =>
    rows.length === 0 ? 'none' : rows.map((row) => row.label).join(', ');
  return {
    summary: `${ratio} features on · ${device}`,
    summaryTitle: `On: ${names(on)}. Off: ${names(off)}.`,
    features,
    featuresCount: `${ratio} on`,
    device,
    groups: [instructionGroup('elements', beacon), instructionGroup('exclusions', beacon)],
    raw: rawInstructions(beacon)
  };
}

/** The last readable instructions seen, with the page load they came from. */
export interface InstructionsMemory {
  /** The load's identity (null when the payload carried none). */
  readonly page: string | null;
  readonly beacon: PriorityElementsBeaconDetection;
  readonly status: BeaconFeatureStatus;
}

/** The page payload's side the card reads. */
export interface InstructionsSource {
  /** The beacon row; null without page data. */
  readonly beacon: PriorityElementsBeaconDetection | null;
  /** The payload's load identity. */
  readonly page: string | null;
}

/**
 * The card's input from the shell's data state.
 *
 * @param state The shell's data state.
 * @returns The beacon row (null without page data) and the load identity.
 */
export function instructionsSourceOf(state: DataState): InstructionsSource {
  const loaded = state.status === 'ready' || state.status === 'refreshing';
  return {
    beacon: loaded ? state.data.wprDetections.priority_elements_beacon : null,
    page: pageIdOf(state)
  };
}

/**
 * Keep the last readable instructions: a payload with readable ones
 * replaces the memory; a beacon whose config could not be read forgets it
 * (its instructions superseded the remembered ones, so those would no longer
 * be the latest the page sent); a payload without a beacon keeps it (that is
 * when the memory matters).
 *
 * @param memory The memory so far.
 * @param source The payload now.
 * @returns The memory to keep (the same object when unchanged).
 */
export function rememberInstructions(
  memory: InstructionsMemory | null,
  source: InstructionsSource
): InstructionsMemory | null {
  const beacon = source.beacon;
  if (beacon?.present !== true) return memory;
  if (beacon.status === null) return null;
  if (memory?.beacon === beacon && memory.page === source.page) return memory;
  return { page: source.page, beacon, status: beacon.status };
}

/**
 * What the card shows: the payload's instructions; or, on a load without a
 * beacon, the remembered ones from another load (unless dismissed); else the
 * calm line. A beacon whose config could not be read says so — it is still
 * this load's answer, so no earlier instructions show over it.
 *
 * @param source The payload now.
 * @param memory The remembered instructions.
 * @param dismissed The memory the user dismissed (shown no more), if any.
 * @returns The card state.
 */
export function instructionsCardState(
  source: InstructionsSource,
  memory: InstructionsMemory | null,
  dismissed: InstructionsMemory | null
): InstructionsCardState {
  const beacon = source.beacon;
  if (beacon?.present === true) {
    return beacon.status === null
      ? { kind: 'unreadable' }
      : { kind: 'instructions', view: describeInstructions(beacon, beacon.status) };
  }
  if (memory !== null && memory !== dismissed && isOtherLoad(memory.page, source.page)) {
    return { kind: 'stale', view: describeInstructions(memory.beacon, memory.status) };
  }
  return { kind: 'none' };
}
