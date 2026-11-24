/**
 * The release-notes registry's shape: valid, unique, strictly newest-first
 * versions; a row for the `package.json` version (every bump adds one) and
 * 3.0.0 announced; unique ids; no blank copy; only known placeholders;
 * every screenshot id resolving to a bundled file in both palettes whose
 * header size is the registry's box.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { compareExtensionVersions, parseExtensionVersion } from '../../utils/extension-version';
import { readImageSize } from '../../utils/image-size';
import { COPY_TOKENS, tokensIn } from './copy-tokens';
import { noticeAppliesTo, RELEASE_NOTES, type ReleaseNote, type ReleaseNotice } from './notes';
import { LAST_UNMARKED_VERSION, RELEASES } from './releases';
import {
  RELEASE_SCREENSHOTS,
  SCREENSHOT_PALETTES,
  screenshotPath,
  type ScreenshotMeta
} from './screenshots';

/** The repository root (this file sits in `lib/release-notes/`). */
const ROOT = path.resolve(import.meta.dirname, '..', '..');

/** The `package.json` version (the manifest's). */
const PACKAGE_VERSION = (
  JSON.parse(readFileSync(path.join(ROOT, 'package.json'), 'utf8')) as { version: string }
).version;

/** Every copy string a row carries. */
function copyOf(note: ReleaseNote): string[] {
  return [
    note.headline,
    ...note.improvements,
    ...note.highlights.flatMap((h) => [h.title, h.summary, ...h.howTo, ...(h.details ?? [])]),
    ...note.notices.flatMap((n) => [
      n.title,
      n.body,
      ...(n.items ?? []).flatMap((item) => [item.label, item.text])
    ])
  ];
}

/** The bundled table, widened to string keys (lookups by any id). */
const table: Readonly<Record<string, ScreenshotMeta>> = RELEASE_SCREENSHOTS;

describe('RELEASE_NOTES', () => {
  it('has valid, unique versions, strictly newest first', () => {
    expect(RELEASE_NOTES.length).toBeGreaterThan(0);
    const versions = RELEASE_NOTES.map((note) => {
      const parsed = parseExtensionVersion(note.version);
      expect(parsed, note.version).not.toBeNull();
      return parsed ?? [];
    });
    for (let index = 1; index < versions.length; index += 1) {
      const newer = versions[index - 1] ?? [];
      const older = versions[index] ?? [];
      expect(compareExtensionVersions(newer, older)).toBeGreaterThan(0);
    }
  });

  it('joins the index rows with their copy, in the index order', () => {
    expect(RELEASE_NOTES.map((note) => [note.version, note.announce])).toEqual(
      RELEASES.map((entry) => [entry.version, entry.announce])
    );
    for (const note of RELEASE_NOTES) expect(typeof note.headline).toBe('string');
  });

  it('has a row for the package.json version, and announces 3.0.0', () => {
    expect(RELEASE_NOTES.map((note) => note.version)).toContain(PACKAGE_VERSION);
    expect(RELEASE_NOTES.find((note) => note.version === '3.0.0')?.announce).toBe(true);
  });

  it('lists only versions above the last marker-less one (3.0.0 first wrote the marker)', () => {
    const unmarked = parseExtensionVersion(LAST_UNMARKED_VERSION);
    expect(unmarked).toEqual([2, 2, 5]);
    for (const note of RELEASE_NOTES) {
      const parsed = parseExtensionVersion(note.version) ?? [];
      expect(compareExtensionVersions(parsed, unmarked ?? []), note.version).toBeGreaterThan(0);
    }
  });

  it('dates only as YYYY-MM-DD calendar days', () => {
    for (const note of RELEASE_NOTES) {
      if (note.date === undefined) continue;
      expect(note.date).toMatch(/^\d{4}-\d{2}-\d{2}$/);
      expect(new Date(`${note.date}T00:00:00Z`).toISOString().slice(0, 10)).toBe(note.date);
    }
  });

  it('keeps ids unique within each release and every copy line non-blank', () => {
    for (const note of RELEASE_NOTES) {
      const highlightIds = note.highlights.map((h) => h.id);
      const noticeIds = note.notices.map((n) => n.id);
      expect(new Set(highlightIds).size, note.version).toBe(highlightIds.length);
      expect(new Set(noticeIds).size, note.version).toBe(noticeIds.length);
      for (const highlight of note.highlights) expect(highlight.howTo.length).toBeGreaterThan(0);
      for (const text of copyOf(note)) expect(text.trim(), note.version).not.toBe('');
    }
  });

  it('uses only known placeholders', () => {
    for (const note of RELEASE_NOTES) {
      for (const text of copyOf(note)) {
        for (const token of tokensIn(text)) {
          expect(COPY_TOKENS as readonly string[], `${note.version}: ${text}`).toContain(token);
        }
      }
    }
  });

  it('resolves every screenshot id to a bundled file in both palettes, at its declared size', () => {
    for (const note of RELEASE_NOTES) {
      for (const highlight of note.highlights) {
        const id = highlight.screenshot;
        if (id === undefined) continue;
        const meta = table[id];
        expect(meta, id).toBeDefined();
        if (meta === undefined) continue;
        for (const palette of SCREENSHOT_PALETTES) {
          const file = path.join(ROOT, 'public', screenshotPath(id, palette, meta.format));
          expect(existsSync(file), file).toBe(true);
          // The page reserves the row's box: a file of another size would stretch in it.
          expect(readImageSize(readFileSync(file)), file).toEqual({
            width: meta.width,
            height: meta.height
          });
        }
      }
    }
  });

  it('shows a screenshot on every 3.0.0 highlight, each image used once', () => {
    const highlights = RELEASE_NOTES.find((note) => note.version === '3.0.0')?.highlights ?? [];
    const ids = highlights.map((highlight) => highlight.screenshot);
    expect(ids.length).toBeGreaterThan(0);
    for (const id of ids) expect(id).toBeDefined();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('declares sane screenshot metadata', () => {
    for (const [id, meta] of Object.entries(table)) {
      expect(id).toMatch(/^[a-z0-9-]+$/);
      expect(meta.alt.trim()).not.toBe('');
      expect(Number.isInteger(meta.width) && meta.width > 0).toBe(true);
      expect(Number.isInteger(meta.height) && meta.height > 0).toBe(true);
    }
  });

  it('tells Chromium users about the debugger permission, never Firefox users', () => {
    const notice = RELEASE_NOTES.find((note) => note.version === '3.0.0')?.notices.find(
      (n) => n.id === 'debugger-permission'
    );
    expect(notice).toBeDefined();
    if (notice === undefined) return;
    expect(noticeAppliesTo(notice, 'chromium')).toBe(true);
    expect(noticeAppliesTo(notice, 'firefox')).toBe(false);
  });

  it('names the one retired-tool feature that did not move, and what covers it', () => {
    const notice = RELEASE_NOTES.find((note) => note.version === '3.0.0')?.notices.find(
      (n) => n.id === 'predecessor-tool-retired'
    );
    expect(notice?.body).toBe(
      'Everything it did now lives here except its Alt+H strip toggle: turn the detection widget on or off from the right-click menu or the command palette ({paletteShortcut}). You can uninstall WPR Inspector.'
    );
  });
});

describe('noticeAppliesTo', () => {
  const base: ReleaseNotice = { id: 'n', title: 't', body: 'b' };

  it('applies a notice without browsers everywhere', () => {
    expect(noticeAppliesTo(base, 'chromium')).toBe(true);
    expect(noticeAppliesTo(base, 'firefox')).toBe(true);
  });

  it('applies a scoped notice only to its builds', () => {
    expect(noticeAppliesTo({ ...base, browsers: ['firefox'] }, 'chromium')).toBe(false);
    expect(noticeAppliesTo({ ...base, browsers: ['firefox'] }, 'firefox')).toBe(true);
  });
});
