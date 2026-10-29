/**
 * Which supported WP Rocket version a served document is simulated with:
 * the version its WP Rocket generator metas name, when they agree and it is
 * exactly a supported one, else the latest stable — no such meta, metas
 * without a version (WP Rocket can hide it), an unsupported or malformed
 * version, or metas naming different versions (ambiguous). Per document,
 * pure, read off the served text with the tag scanner (no DOM).
 */
import { scanTags, type ScannedTag } from '../exclusion-builder/html-scan';
import { WPR_NAME_PATTERN, WPR_VERSION_PATTERN } from '../wp-rocket/constants';
import {
  SUPPORTED_WPR_VERSIONS,
  latestStableWprVersion,
  supportedWprVersion,
  type SupportedWprVersion
} from '../wp-rocket/versions';
import { attributeValue, isGeneratorMeta } from './generator-meta';

/** The version a document is simulated with, and what the page itself names. */
export interface WprVersionSelection {
  /** The supported version simulated. */
  readonly selected: SupportedWprVersion;
  /**
   * The version token the page's WP Rocket generator metas name (see
   * {@link wprVersionToken}; may be unsupported, e.g. `3.22` or
   * `3.24-beta5`), absent when none names one. When versioned metas
   * disagree: the first in document order (the page's own first claim) —
   * the selection then falls back to the latest stable. The UI states both
   * when they differ.
   */
  readonly siteVersion?: string;
}

/** Characters that continue a version token past its digits (`-beta5`, `.9`, `+build`). */
const VERSION_TAIL = /^[\w.+-]*/;

/**
 * The whole version token a WP Rocket generator content names: the digits
 * the shared version pattern reads, plus any text glued to them — so
 * `3.24-beta5` or `3.23.5.1.9` never reads as a supported `3.24` /
 * `3.23.5.1`. Deliberately wider than detection's digits-only version
 * (`extractWprVersion`): detection only reports the number, while the
 * simulation picks plugin behavior by exact version, so a pre-release or
 * longer build must never be taken for the release it starts with.
 *
 * @param content The meta's `content` value.
 * @returns The token, or `null` when the content names no version.
 */
export function wprVersionToken(content: string): string | null {
  const match = WPR_VERSION_PATTERN.exec(content);
  if (match?.[1] === undefined) return null;
  const tail = VERSION_TAIL.exec(content.slice(match.index + match[0].length))?.[0] ?? '';
  return match[1] + tail;
}

/**
 * Select the WP Rocket version to simulate a served document with.
 *
 * @param html The served document.
 * @param tags Its opening tags, when already scanned (`scanTags(html)`).
 * @param rows The registry (default: the supported versions).
 */
export function selectWprVersion(
  html: string,
  tags: readonly ScannedTag[] = scanTags(html),
  rows: readonly SupportedWprVersion[] = SUPPORTED_WPR_VERSIONS
): WprVersionSelection {
  const latest = latestStableWprVersion(rows);
  const tokens = siteVersionTokens(tags);
  const [siteVersion] = tokens;
  if (siteVersion === undefined) return { selected: latest };
  const agreed = tokens.every((token) => token === siteVersion);
  const named = agreed ? supportedWprVersion(siteVersion, rows) : undefined;
  return { selected: named ?? latest, siteVersion };
}

/**
 * The version tokens of every WP Rocket generator meta, in document order —
 * metas naming no version skipped, so a version-less meta never hides a
 * later versioned one.
 *
 * @param tags The document's opening tags.
 */
function siteVersionTokens(tags: readonly ScannedTag[]): string[] {
  const tokens: string[] = [];
  for (const tag of tags) {
    if (!isGeneratorMeta(tag)) continue;
    const content = attributeValue(tag, 'content');
    if (content === null || !WPR_NAME_PATTERN.test(content)) continue;
    const token = wprVersionToken(content);
    if (token !== null) tokens.push(token);
  }
  return tokens;
}
