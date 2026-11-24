/**
 * Whether the What's new page opens: one pure decision over the trigger
 * (an `onInstalled` event, or the background's start), the running version,
 * the stored marker (the newest version already considered) and the user's
 * opt-out.
 *
 * Rules:
 * - The page opens for the newest announced version `v` with
 *   `previous < v ≤ current` and `v > marker` — so once per announced
 *   version, never on a browser restart or a worker wake.
 * - `install` never announces: it seeds the marker at the running version.
 * - An update with no marker comes from a build that never wrote one
 *   (≤ {@link LAST_UNMARKED_VERSION}): it announces from the older of
 *   `previousVersion` and that version, whatever `previousVersion` says —
 *   Chromium reports the version installed at the last update, even one it
 *   kept disabled and never ran (or the running one, on a same-version
 *   repair), so it alone could skip a release. Cost: a marker-less reload
 *   (development, or a failed seed write) announces once.
 * - An update with a marker whose `previousVersion` is at or above the
 *   running version (a reload, a downgrade) announces nothing.
 * - The page is told the floor (`since`), so it expands every announced
 *   release the user has not seen, not only the newest.
 * - The start check (missed-event catch-up: e.g. an update the browser kept
 *   disabled until a new permission was accepted) only acts on an existing
 *   marker; with none it waits for `onInstalled`, which also fires on that
 *   first start — seeding here could swallow the update's announcement.
 * - Browser and shared-module updates carry no extension version change:
 *   they act like the start check.
 * - The marker moves forward to the running version whenever it is behind
 *   (opened, opted out or nothing announced), so a later opt-in never
 *   replays old notes. It never moves backwards (a downgrade writes nothing).
 * - Malformed input (running version, `previousVersion`, marker) opens
 *   nothing and returns a warning; a corrupt marker is repaired.
 */
import {
  compareExtensionVersions,
  parseExtensionVersion,
  type ExtensionVersion
} from '../../utils/extension-version';
import { LAST_UNMARKED_VERSION, type ReleaseEntry } from './releases';

/** What asked for the decision. */
export type WhatsNewTrigger =
  /** `runtime.onInstalled` (its reason as the browser sent it). */
  | { readonly kind: 'installed'; readonly reason: string; readonly previousVersion?: string }
  /** The background started (catch-up for a missed event). */
  | { readonly kind: 'startup' };

/** The decision's inputs. */
export interface WhatsNewInput {
  readonly trigger: WhatsNewTrigger;
  /** The running manifest version. */
  readonly current: string;
  /** The stored marker as read (any value; validated here). */
  readonly marker: unknown;
  /** The user's "Show what's new after updates" setting. */
  readonly enabled: boolean;
  /** The release index. */
  readonly releases: readonly ReleaseEntry[];
}

/** The page to open. */
export interface WhatsNewOpening {
  /** The newest announced version the page presents. */
  readonly version: string;
  /** The floor: every announced release above it (to `version`) is new to the user. */
  readonly since: string;
}

/** What to do. */
export interface WhatsNewDecision {
  /** The page to open, or null. */
  readonly open: WhatsNewOpening | null;
  /** The marker to store first (before any open), or null to leave it. */
  readonly writeMarker: string | null;
  /** Why the input was unusable, for the log; null when it was fine. */
  readonly warning: string | null;
}

/** A version as both text (for the page's address) and parts (for ordering). */
interface KnownVersion {
  readonly text: string;
  readonly parsed: ExtensionVersion;
}

/**
 * Read a version from any value.
 *
 * @param raw A stored, event-delivered or constant value.
 * @returns The version, or null when `raw` is not a valid version string.
 */
function knownVersion(raw: unknown): KnownVersion | null {
  if (typeof raw !== 'string') return null;
  const parsed = parseExtensionVersion(raw);
  return parsed === null ? null : { text: raw, parsed };
}

/** The marker as the decision sees it. */
type MarkerState =
  | { readonly kind: 'absent' }
  | { readonly kind: 'corrupt' }
  | { readonly kind: 'valid'; readonly version: KnownVersion };

/**
 * Classify a stored marker.
 *
 * @param raw The stored value (`undefined`/`null` when nothing is stored).
 */
function markerState(raw: unknown): MarkerState {
  if (raw === undefined || raw === null) return { kind: 'absent' };
  const version = knownVersion(raw);
  return version === null ? { kind: 'corrupt' } : { kind: 'valid', version };
}

/**
 * The newest announced version strictly above `lower` and at most `current`.
 *
 * @param releases The release index.
 * @param lower The exclusive floor.
 * @param current The inclusive ceiling.
 * @returns The note's version string, or null when none qualifies.
 */
export function newestAnnouncedBetween(
  releases: readonly ReleaseEntry[],
  lower: ExtensionVersion,
  current: ExtensionVersion
): string | null {
  let best: { version: string; parsed: ExtensionVersion } | null = null;
  for (const note of releases) {
    if (!note.announce) continue;
    const parsed = parseExtensionVersion(note.version);
    if (parsed === null) continue;
    if (compareExtensionVersions(parsed, lower) <= 0) continue;
    if (compareExtensionVersions(parsed, current) > 0) continue;
    if (best === null || compareExtensionVersions(parsed, best.parsed) > 0) {
      best = { version: note.version, parsed };
    }
  }
  return best?.version ?? null;
}

/** Nothing to do. */
const NOTHING: WhatsNewDecision = Object.freeze({ open: null, writeMarker: null, warning: null });

/** The last marker-less version (a constant, pinned valid by the registry test). */
const LAST_UNMARKED: KnownVersion = knownVersion(LAST_UNMARKED_VERSION) ?? {
  text: LAST_UNMARKED_VERSION,
  parsed: []
};

/**
 * The newer of two versions.
 *
 * @param a A version.
 * @param b Another version.
 */
function newer(a: KnownVersion, b: KnownVersion): KnownVersion {
  return compareExtensionVersions(a.parsed, b.parsed) >= 0 ? a : b;
}

/**
 * The older of two versions.
 *
 * @param a A version.
 * @param b Another version.
 */
function older(a: KnownVersion, b: KnownVersion): KnownVersion {
  return compareExtensionVersions(a.parsed, b.parsed) <= 0 ? a : b;
}

/**
 * Whether a marker is behind the running version (it then moves up).
 *
 * @param marker The valid marker, if any.
 * @param current The parsed running version.
 */
function isBehind(marker: ExtensionVersion | null, current: ExtensionVersion): boolean {
  return marker === null || compareExtensionVersions(marker, current) < 0;
}

/**
 * Decide from a known floor: open the newest announced version above it
 * (unless opted out) and move the marker up to the running version.
 *
 * @param input The decision's inputs.
 * @param floor Versions at or below it are already known to the user.
 * @param current The parsed running version.
 * @param writeMarker The marker to store (null: it is not behind).
 */
function decideAbove(
  input: WhatsNewInput,
  floor: KnownVersion,
  current: ExtensionVersion,
  writeMarker: string | null
): WhatsNewDecision {
  const announced = newestAnnouncedBetween(input.releases, floor.parsed, current);
  const open =
    input.enabled && announced !== null ? { version: announced, since: floor.text } : null;
  return { open, writeMarker, warning: null };
}

/**
 * Decide whether the What's new page opens (pure; never throws).
 *
 * @param input See {@link WhatsNewInput}.
 * @returns The page to open (if any), the marker to store first, and any warning.
 */
export function decideWhatsNew(input: WhatsNewInput): WhatsNewDecision {
  const current = parseExtensionVersion(input.current);
  if (current === null) {
    return {
      ...NOTHING,
      warning: `The running version "${input.current}" is not a valid extension version`
    };
  }
  const marker = markerState(input.marker);
  if (marker.kind === 'corrupt') {
    // Repaired at the running version: no page now, announcements resume from here.
    return {
      open: null,
      writeMarker: input.current,
      warning: 'The stored What’s new marker is not a valid version — reset to the running version'
    };
  }
  const markerVersion = marker.kind === 'valid' ? marker.version : null;
  const moveMarker = isBehind(markerVersion?.parsed ?? null, current) ? input.current : null;
  const { trigger } = input;

  if (trigger.kind === 'installed' && trigger.reason === 'install') {
    return { ...NOTHING, writeMarker: moveMarker };
  }

  if (trigger.kind === 'installed' && trigger.reason === 'update') {
    const previous = knownVersion(trigger.previousVersion);
    if (previous === null) {
      return {
        open: null,
        writeMarker: moveMarker,
        warning: `The update's previous version "${String(trigger.previousVersion)}" is not a valid extension version`
      };
    }
    // No marker: the user never ran a marker-writing build, whatever the event
    // says (even a previousVersion at or above the running one).
    if (markerVersion === null) {
      return decideAbove(input, older(previous, LAST_UNMARKED), current, moveMarker);
    }
    // A reload or a downgrade of a marker-writing build: nothing new to present.
    if (compareExtensionVersions(previous.parsed, current) >= 0) {
      return { ...NOTHING, writeMarker: moveMarker };
    }
    return decideAbove(input, newer(previous, markerVersion), current, moveMarker);
  }

  // The start check and the browser's own updates: only an existing marker
  // says what the user has seen.
  if (markerVersion === null) return NOTHING;
  return decideAbove(input, markerVersion, current, moveMarker);
}
