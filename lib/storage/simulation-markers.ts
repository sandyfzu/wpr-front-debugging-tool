/**
 * The simulation markers the background wrote: tab id → the tab's last
 * {@link SIMULATION_MARKERS_PER_TAB} `{ markerId, origin, features }`,
 * newest first — what lets the background vouch for a page's simulation
 * marker (page markup alone is untrusted: a forged or saved copy must not
 * pass).
 *
 * Lives in the `session:` area: in memory, never on disk nor synced,
 * cleared at browser shutdown (tab ids are not stable across a restart),
 * readable by extension contexts only. Entries outlive a session's Stop
 * (the stopped document keeps running its simulation) and a plain
 * background restart; the background drops a tab's entries on tab close
 * ({@link clearSimulationMarkersForTab}) and every entry on an extension
 * update or reload ({@link clearAllSimulationMarkers}), since the area may
 * survive those. Entries exist only for open tabs that simulated, at most
 * {@link SIMULATION_MARKERS_PER_TAB} each (≤ ~10 KiB per tab), and at most
 * {@link SIMULATION_MARKERS_TOTAL} across tabs (the oldest written evicted
 * first) — a bound that holds even if tab-close clears are missed.
 *
 * Writers serialize through one write queue; the background is the only
 * writer. Reads validate: malformed entries are dropped one by one,
 * unknown fields ignored, each tab and the whole map held to their caps.
 */
import { storage } from 'wxt/utils/storage';
import { EXCLUSION_SET_LIMITS } from '../messaging/exclusion-session';
import { isSimulationMarkerId, parseSimulateSpec } from '../messaging/exclusion-simulation';
import type { SimulatedFeatureId } from '../wp-rocket-simulation/spec';
import { isCount } from '../messaging/guard-policy';
import { isRecord, ownValue } from '../../utils/is-record';
import { isHttpOrigin } from '../../utils/urls';
import { createWriteQueue } from './write-queue';
import { tabKey } from './tab-key';

/** The `session:simulation-markers` store key, single-sourced. */
export const SIMULATION_MARKERS_KEY = 'session:simulation-markers';

/** Markers remembered per tab (the oldest dropped past it). */
export const SIMULATION_MARKERS_PER_TAB = 16;

/** Markers remembered across all tabs (the oldest written evicted past it). */
export const SIMULATION_MARKERS_TOTAL = 256;

/** One marker the background wrote into a simulated document. */
export interface SimulationMarkerEntry {
  /** The marker's id (32 lowercase hex). */
  readonly markerId: string;
  /** The http(s) origin of the document it was written into. */
  readonly origin: string;
  /** The features the document simulated (non-empty, each once). */
  readonly features: readonly SimulatedFeatureId[];
}

/** One stored entry: the marker plus its write order across every tab. */
export interface StoredSimulationMarker extends SimulationMarkerEntry {
  /** Write order across tabs (higher = written later) — the global eviction order. */
  readonly seq: number;
}

/** The stored map: decimal tab id → the tab's entries, newest first. */
export type StoredSimulationMarkers = Record<string, readonly StoredSimulationMarker[]>;

/** The map as read back: decimal tab id → the tab's markers, newest first. */
export type SimulationMarkers = Record<string, readonly SimulationMarkerEntry[]>;

/** The raw storage item (reads/writes go through the helpers below). */
export const simulationMarkersStore = storage.defineItem<StoredSimulationMarkers>(
  SIMULATION_MARKERS_KEY,
  { fallback: {} }
);

/** The item's write queue. */
const enqueueWrite = createWriteQueue();

/**
 * Parse one entry (unknown fields ignored).
 *
 * @param input Any storage-delivered value.
 * @returns A fresh entry, or null when malformed.
 */
export function parseSimulationMarkerEntry(input: unknown): SimulationMarkerEntry | null {
  if (!isRecord(input)) return null;
  const markerId = ownValue(input, 'markerId');
  const origin = ownValue(input, 'origin');
  const spec = parseSimulateSpec({ features: ownValue(input, 'features') }, 'reject');
  if (!isSimulationMarkerId(markerId) || spec === null) return null;
  if (typeof origin !== 'string' || origin.length > EXCLUSION_SET_LIMITS.originChars) return null;
  return isHttpOrigin(origin) ? { markerId, origin, features: spec.features } : null;
}

/**
 * Parse one stored entry: a valid marker with its write order.
 *
 * @param input Any storage-delivered value.
 * @returns A fresh stored entry, or null when malformed.
 */
function parseStoredEntry(input: unknown): StoredSimulationMarker | null {
  const entry = parseSimulationMarkerEntry(input);
  const seq = isRecord(input) ? ownValue(input, 'seq') : undefined;
  return entry === null || !isCount(seq) ? null : { ...entry, seq };
}

/**
 * One tab's entries: malformed ones and repeats of an id dropped (the
 * first, newest, kept), capped at {@link SIMULATION_MARKERS_PER_TAB}.
 *
 * @param input Any storage-delivered value.
 * @returns The entries (empty when the value is not a list).
 */
function parseTabEntries(input: unknown): StoredSimulationMarker[] {
  if (!Array.isArray(input)) return [];
  const entries: StoredSimulationMarker[] = [];
  for (const raw of input) {
    const entry = parseStoredEntry(raw);
    if (entry === null || entries.some((seen) => seen.markerId === entry.markerId)) continue;
    entries.push(entry);
    if (entries.length === SIMULATION_MARKERS_PER_TAB) break;
  }
  return entries;
}

/**
 * Hold a map to {@link SIMULATION_MARKERS_TOTAL} entries, evicting the
 * lowest write orders (the oldest written, whatever their tab) first; a
 * tab left with no entry is dropped.
 *
 * @param markers A validated map.
 * @returns The map itself when within the cap, else a fresh trimmed map.
 */
export function withinMarkerTotal(markers: StoredSimulationMarkers): StoredSimulationMarkers {
  const all = Object.values(markers).flat();
  if (all.length <= SIMULATION_MARKERS_TOTAL) return markers;
  // Kept by identity, so equal orders (only a corrupt store has them) cannot overshoot the cap.
  const kept = new Set(all.sort((a, b) => b.seq - a.seq).slice(0, SIMULATION_MARKERS_TOTAL));
  const trimmed: StoredSimulationMarkers = {};
  for (const [key, entries] of Object.entries(markers)) {
    const tabKept = entries.filter((entry) => kept.has(entry));
    if (tabKept.length > 0) trimmed[key] = tabKept;
  }
  return trimmed;
}

/**
 * Validate a raw (possibly corrupt, partial, or foreign) stored map: keys
 * must be canonical tab ids; each tab's list is parsed entry by entry
 * (see {@link parseTabEntries}); a tab left with no entry is dropped; the
 * whole map is held to {@link SIMULATION_MARKERS_TOTAL}.
 *
 * @param input Any storage-delivered value.
 * @returns The validated map, or null when the value is not a map at all.
 */
export function parseSimulationMarkers(input: unknown): StoredSimulationMarkers | null {
  if (!isRecord(input)) return null;
  const parsed: StoredSimulationMarkers = {};
  for (const [key, raw] of Object.entries(input)) {
    const canonical = tabKey(key);
    const entries = canonical === null ? [] : parseTabEntries(raw);
    if (canonical !== null && entries.length > 0) parsed[canonical] = entries;
  }
  return withinMarkerTotal(parsed);
}

/** Entries without their storage-internal write order. */
function withoutSeq(entries: readonly StoredSimulationMarker[]): SimulationMarkerEntry[] {
  return entries.map(({ markerId, origin, features }) => ({ markerId, origin, features }));
}

/**
 * Read the map through the validator: corrupt storage degrades to no
 * markers (nothing verifies), never to fabricated ones.
 */
export async function getSimulationMarkers(): Promise<SimulationMarkers> {
  const stored = parseSimulationMarkers(await simulationMarkersStore.getValue()) ?? {};
  const markers: SimulationMarkers = {};
  for (const [key, entries] of Object.entries(stored)) markers[key] = withoutSeq(entries);
  return markers;
}

/**
 * One tab's entries, newest first.
 *
 * @param tabId The tab to look up.
 * @returns Its entries (empty for an unknown or malformed tab id).
 */
export async function getTabSimulationMarkers(
  tabId: number
): Promise<readonly SimulationMarkerEntry[]> {
  const key = tabKey(tabId);
  const markers = await getSimulationMarkers();
  return (key === null ? undefined : markers[key]) ?? [];
}

/** The highest write order in a validated map (0 when empty). */
function maxSeq(markers: StoredSimulationMarkers): number {
  return Math.max(0, ...Object.values(markers).flatMap((list) => list.map((e) => e.seq)));
}

/**
 * Keep the next write order a safe count: when the highest stored one
 * leaves no room (only a corrupt store gets there), renumber every entry
 * densely from 1 in write order — otherwise each new entry would carry an
 * unsafe order and be dropped on every read, leaving its marker
 * unverifiable.
 *
 * @param markers A validated map.
 * @returns The map itself when there is room, else a fresh renumbered map.
 */
export function withSafeNextSeq(markers: StoredSimulationMarkers): StoredSimulationMarkers {
  if (maxSeq(markers) < Number.MAX_SAFE_INTEGER) return markers;
  // Stable sort: equal orders (a corrupt store) keep their map order.
  const ordered = Object.values(markers)
    .flat()
    .sort((a, b) => a.seq - b.seq);
  const renumbered = new Map(ordered.map((entry, index) => [entry, index + 1]));
  const next: StoredSimulationMarkers = {};
  for (const [key, entries] of Object.entries(markers)) {
    next[key] = entries.map((entry) => ({ ...entry, seq: renumbered.get(entry) ?? 0 }));
  }
  return next;
}

/**
 * Remember one marker for a tab (queued read-modify-write): put first with
 * the next write order, any older entry with the same id removed, the
 * oldest dropped past {@link SIMULATION_MARKERS_PER_TAB}; other tabs
 * untouched unless the map exceeds {@link SIMULATION_MARKERS_TOTAL} (then
 * the oldest written go first — never the new entry, the newest).
 *
 * @param tabId The tab the marked document was served to.
 * @param entry The marker (re-validated).
 * @returns The tab's entries as written. Rejects with an {@link Error} when
 *   `tabId` is not a tab id or `entry` is malformed (a broken caller —
 *   nothing touched), and with whatever the storage read/write rejects with.
 */
export function rememberSimulationMarker(
  tabId: number,
  entry: SimulationMarkerEntry
): Promise<readonly SimulationMarkerEntry[]> {
  const key = tabKey(tabId);
  if (key === null) {
    return Promise.reject(new Error(`rememberSimulationMarker: not a tab id: ${String(tabId)}`));
  }
  const checked = parseSimulationMarkerEntry(entry);
  if (checked === null) {
    return Promise.reject(
      new Error(`rememberSimulationMarker: the marker for tab ${key} is malformed`)
    );
  }
  return enqueueWrite(async () => {
    const current = withSafeNextSeq(
      parseSimulationMarkers(await simulationMarkersStore.getValue()) ?? {}
    );
    const seq = 1 + maxSeq(current);
    const entries = parseTabEntries([{ ...checked, seq }, ...(current[key] ?? [])]);
    const next = withinMarkerTotal({ ...current, [key]: entries });
    await simulationMarkersStore.setValue(next);
    return withoutSeq(next[key] ?? []);
  });
}

/**
 * Forget one tab's markers — tab close (queued read-modify-write; an
 * absent tab is a no-op write).
 *
 * @param tabId The closed tab.
 * @throws Whatever the storage read/write rejects with.
 */
export function clearSimulationMarkersForTab(tabId: number): Promise<void> {
  const key = tabKey(tabId);
  return enqueueWrite(async () => {
    const next = { ...(parseSimulationMarkers(await simulationMarkersStore.getValue()) ?? {}) };
    // eslint-disable-next-line @typescript-eslint/no-dynamic-delete -- the map is keyed by tab; removing one key is the operation
    if (key !== null) delete next[key];
    await simulationMarkersStore.setValue(next);
  });
}

/**
 * Forget every marker — extension update or reload (queued behind pending
 * writes, so none of them lands after it).
 *
 * @throws Whatever the storage write rejects with.
 */
export function clearAllSimulationMarkers(): Promise<void> {
  return enqueueWrite(() => simulationMarkersStore.setValue({}));
}
