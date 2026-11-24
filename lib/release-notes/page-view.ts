/**
 * What the What's new page shows, derived purely from the registry, the
 * running build and the page's `since` floor: after an update, every
 * announced release above the floor in full (newest first); otherwise (no
 * floor, or none announced above it) the running version's notes — or, for
 * a version without its own row, the newest earlier one. Everything else at
 * or below the running version is history; each release's notices are
 * filtered to the build.
 */
import {
  compareExtensionVersions,
  parseExtensionVersion,
  type ExtensionVersion
} from '../../utils/extension-version';
import { formatChord, type PaletteChord } from '../storage/palette-chord';
import type { ChordPlatform } from '../storage/palette-chord-platform';
import type { CopyTokenValues } from './copy-tokens';
import { noticeAppliesTo, type ReleaseBrowser, type ReleaseNote } from './notes';

/** The page's releases. */
export interface WhatsNewView {
  /** The releases shown in full, newest first (empty: the registry has nothing for this version). */
  readonly featured: readonly ReleaseNote[];
  /** Earlier releases, newest first (shown collapsed). */
  readonly history: readonly ReleaseNote[];
}

/** A registry row with its parsed version. */
interface ParsedNote {
  readonly note: ReleaseNote;
  readonly version: ExtensionVersion;
}

/**
 * Keep only a release's notices for the running build.
 *
 * @param note A release.
 * @param browser The running build.
 */
function forBrowser(note: ReleaseNote, browser: ReleaseBrowser): ReleaseNote {
  return { ...note, notices: note.notices.filter((notice) => noticeAppliesTo(notice, browser)) };
}

/**
 * The rows at or below the running version (all valid rows when it is
 * unparsable), newest first.
 *
 * @param notes The registry.
 * @param running The parsed running version, or null.
 */
function shownRows(notes: readonly ReleaseNote[], running: ExtensionVersion | null): ParsedNote[] {
  return notes
    .flatMap((note) => {
      const version = parseExtensionVersion(note.version);
      return version === null ? [] : [{ note, version }];
    })
    .filter((entry) => running === null || compareExtensionVersions(entry.version, running) <= 0)
    .sort((a, b) => compareExtensionVersions(b.version, a.version));
}

/**
 * Build the page's view.
 *
 * @param notes The registry (any order; rows with an invalid version are skipped).
 * @param running The running manifest version.
 * @param browser The running build.
 * @param since The floor from the page's address (null: opened without one).
 * @returns The featured releases and the history, both newest first.
 */
export function whatsNewView(
  notes: readonly ReleaseNote[],
  running: string,
  browser: ReleaseBrowser,
  since: string | null = null
): WhatsNewView {
  const shown = shownRows(notes, parseExtensionVersion(running));
  const floor = parseExtensionVersion(since);
  const unseen =
    floor === null
      ? []
      : shown.filter(
          (entry) => entry.note.announce && compareExtensionVersions(entry.version, floor) > 0
        );
  const featured = unseen.length > 0 ? unseen : shown.slice(0, 1);
  return {
    featured: featured.map((entry) => forBrowser(entry.note, browser)),
    history: shown
      .filter((entry) => !featured.includes(entry))
      .map((entry) => forBrowser(entry.note, browser))
  };
}

/** The browsers' own DevTools shortcut per keyboard convention (Chromium and Firefox agree). */
export const DEVTOOLS_SHORTCUTS: Readonly<Record<ChordPlatform, string>> = {
  mac: '⌥⌘I',
  other: 'Ctrl+Shift+I or F12'
};

/**
 * The copy placeholders' values for the running user.
 *
 * @param chord The user's palette shortcut.
 * @param platform The keyboard convention.
 */
export function whatsNewTokens(chord: PaletteChord, platform: ChordPlatform): CopyTokenValues {
  return {
    paletteShortcut: formatChord(chord, platform),
    devtoolsShortcut: DEVTOOLS_SHORTCUTS[platform]
  };
}
