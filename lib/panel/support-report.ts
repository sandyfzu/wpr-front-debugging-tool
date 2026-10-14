/**
 * The support report: one page's detection evidence as a markdown block a
 * support ticket can carry verbatim — the summary facts, every detection
 * card with its state, the captured response headers and the undefined
 * references the page reported.
 *
 * Pure: the generation time, the extension version and the inspected page's
 * URL arrive as a {@link SupportReportContext} argument (the caller reads the
 * clock and the runtime), so the same inputs always yield the same bytes —
 * the golden test pins the format. Timestamps are absolute UTC only (a
 * relative age pasted into a ticket is wrong by the time someone reads it).
 *
 * Every page-derived string (versions, header names/values, server values,
 * reference words) is untrusted: it lands inside a code span sized past its
 * own backtick runs, with control characters flattened and table pipes
 * escaped, so a hostile value can neither break the layout nor inject
 * markdown into the ticket. Secret-bearing header values are redacted by the
 * shared redaction rule (`redaction.ts`), and the page URL is rebuilt
 * without credentials, fragment or sensitive query values — a session token
 * must never travel into a ticket.
 */

import { formatCacheTimestamp } from '../detection/describe';
import { UNDEFINED_REFERENCE_EXTERNAL_ERROR } from '../wp-rocket/constants';
import type { FdtData } from '../wp-rocket/types';
import { buildHeadersViewModel, type HeaderRowVM } from './headers-view-model';
import { buildStatusItems, type StatusItem } from './detections-view-model';
import { STATUS_LABELS, summarizeDetections, type DetectionsSummary } from './detections-summary';
import { REDACTED, redactHeaderValue, redactUrl } from './redaction';

/** The report's provenance, read by the caller (keeps the builder pure). */
export interface SupportReportContext {
  /** When the report was generated (epoch ms). */
  readonly generatedAt: number;
  /** The extension's own version, or null when the runtime could not say. */
  readonly extensionVersion: string | null;
  /** The inspected page's raw URL, or null when it could not be read (redacted here). */
  readonly pageUrl: string | null;
}

/** What an empty table cell or a missing value reads as. */
const NONE = '—';

/** The report's title line. */
export const SUPPORT_REPORT_TITLE = '## WP Rocket page report';

/**
 * Characters that are never meaningful in a report line and can break or
 * disguise it: C0 controls + DEL + C1 controls, the Unicode line/paragraph
 * separators (U+2028/2029 — line breaks to some renderers), and the bidi
 * controls (LRM/RLM/ALM, embeddings/overrides U+202A–202E, isolates
 * U+2066–2069) that can visually reorder a value into a different-looking one.
 */
const CONTROL_CLASS =
  '[\\u0000-\\u001f\\u007f-\\u009f\\u061c\\u200e\\u200f\\u2028\\u2029\\u202a-\\u202e\\u2066-\\u2069]+';

/** Control runs at either edge (dropped — they carry no content). */
const EDGE_CONTROLS = new RegExp(`^${CONTROL_CLASS}|${CONTROL_CLASS}$`, 'g');

/** Control runs inside a value (flattened to one space each). */
const INNER_CONTROLS = new RegExp(CONTROL_CLASS, 'g');

/**
 * Wrap an untrusted string as an inline code span that renders it literally.
 *
 * The fence is one backtick longer than the value's longest backtick run
 * (CommonMark), padded with spaces when the value starts or ends with a
 * backtick or wrapped in spaces on both sides (CommonMark would strip
 * one of each); control characters are dropped at the edges and collapse
 * to one space inside. Inside a GFM table
 * a `|` must be escaped even within code, so `inTable` escapes it there
 * (outside a table the backslash would render literally, so it is not).
 *
 * @param value The untrusted text.
 * @param inTable Whether the span sits in a table cell.
 * @returns The code span, or {@link NONE} for an empty/blank value.
 */
export function codeSpan(value: string, inTable = false): string {
  const flat = value.replace(EDGE_CONTROLS, '').replace(INNER_CONTROLS, ' ');
  if (flat.trim() === '') return NONE;
  const longestRun = Math.max(0, ...Array.from(flat.matchAll(/`+/g), (match) => match[0].length));
  const fence = '`'.repeat(longestRun + 1);
  // CommonMark strips one space from each side when both are present, and a
  // backtick touching the fence would merge with it: pad in both cases.
  const touchesFence = flat.startsWith('`') || flat.endsWith('`');
  const spaceWrapped = flat.startsWith(' ') && flat.endsWith(' ');
  const pad = touchesFence || spaceWrapped ? ' ' : '';
  const body = inTable ? flat.replace(/\|/g, '\\|') : flat;
  return `${fence}${pad}${body}${pad}${fence}`;
}

/**
 * Escape our own (trusted-vocabulary) text for a table cell: pipes and
 * backslashes, so a future label carrying either cannot split the row.
 *
 * @param value Plain text from the tool's own vocabulary.
 * @returns The escaped cell text.
 */
function cellText(value: string): string {
  return value.replace(/\\/g, '\\\\').replace(/\|/g, '\\|');
}

/**
 * The "Details" cell of one card: the typed detail when the card carries
 * one (its page-derived parts as code), otherwise its own subtitle copy.
 *
 * @param item The card.
 * @returns The cell's markdown.
 */
function detailsCell(item: StatusItem): string {
  const detail = item.detail;
  switch (detail?.kind) {
    case 'server':
      return codeSpan(detail.value, true);
    case 'platform':
      return `${cellText(detail.name)} (matched by ${codeSpan(detail.header, true)})`;
    case 'cached-at':
      return detail.formatted === null ? 'Time not available' : `Generated ${detail.formatted}`;
    case 'version':
      return detail.version === null
        ? 'Version not available'
        : `Version ${codeSpan(detail.version, true)}`;
    case 'preloaded-images':
    case undefined:
      return item.subtitle === undefined ? NONE : cellText(item.subtitle);
  }
}

/**
 * The provenance lines: page, generation time, extension version.
 *
 * @param context The report's provenance.
 * @returns The list lines (the page line only for a known http(s) URL, redacted).
 */
function contextLines(context: SupportReportContext): string[] {
  const lines: string[] = [];
  const page = context.pageUrl === null ? null : redactUrl(context.pageUrl);
  if (page !== null) {
    lines.push(`- **Page:** ${codeSpan(page)}`);
  }
  const generated = formatCacheTimestamp(Math.floor(context.generatedAt / 1000));
  lines.push(`- **Generated:** ${generated ?? 'Time not available'}`);
  lines.push(
    `- **Extension version:** ${
      context.extensionVersion === null ? 'Not available' : codeSpan(context.extensionVersion)
    }`
  );
  return lines;
}

/**
 * The summary list lines.
 *
 * @param summary The page facts.
 * @returns The list lines.
 */
function summaryLines(summary: DetectionsSummary): string[] {
  const wpr = summary.wpr.present
    ? summary.wpr.version === null
      ? 'Detected (version not available)'
      : `Detected, version ${codeSpan(summary.wpr.version)}`
    : 'Not detected';
  const lines = [`- **WP Rocket:** ${wpr}`];
  switch (summary.cache.kind) {
    case 'cached':
      lines.push(
        `- **Page cache:** ${
          summary.cache.formatted === null
            ? 'Cached (generation time not available)'
            : `Cached, generated ${summary.cache.formatted}`
        }`
      );
      break;
    case 'not-cached':
      lines.push('- **Page cache:** Not cached');
      break;
    case 'not-applicable':
      break;
  }
  if (summary.platform !== null) {
    lines.push(
      `- **Platform:** ${summary.platform.name} (matched by ${codeSpan(summary.platform.header)})`
    );
  }
  if (summary.server !== null) lines.push(`- **Server:** ${codeSpan(summary.server)}`);
  lines.push(
    `- **Optimizations:** ${summary.optimizations.active.toString()} of ${summary.optimizations.total.toString()} active`
  );
  return lines;
}

/**
 * The detections table: every card, in the page's order.
 *
 * @param items The status cards.
 * @returns The section's lines.
 */
function detectionLines(items: readonly StatusItem[]): string[] {
  return [
    '### Detections',
    '',
    '| Feature | Status | Details |',
    '| --- | --- | --- |',
    ...items.map(
      (item) => `| ${cellText(item.name)} | ${STATUS_LABELS[item.status]} | ${detailsCell(item)} |`
    )
  ];
}

/**
 * One header row's value cell, secret-bearing values redacted by the shared
 * sensitive-header rule (a `Set-Cookie` keeps only a well-formed cookie name).
 *
 * @param row The typed header row.
 * @returns The cell's markdown.
 */
function headerValueCell(row: HeaderRowVM): string {
  if (row.value === null) return NONE;
  const exported = redactHeaderValue(row.name, row.value);
  if (!exported.redacted) return codeSpan(exported.value, true);
  return exported.cookieName === null
    ? REDACTED
    : `${codeSpan(exported.cookieName, true)} ${REDACTED}`;
}

/**
 * The response-headers section: caching-relevant rows first (the shared
 * headers model's order), names and values only.
 *
 * @param headers The capture, or null when none was taken.
 * @returns The section's lines.
 */
function headerLines(headers: FdtData['pageHeaders']): string[] {
  if (headers === null) {
    return ['### Response headers', '', 'Not captured for this page.'];
  }
  const model = buildHeadersViewModel(headers);
  const rows = [...model.caching, ...model.other];
  if (rows.length === 0) {
    return ['### Response headers (0)', '', 'None were captured for this page.'];
  }
  return [
    `### Response headers (${rows.length.toString()})`,
    '',
    '| Header | Value |',
    '| --- | --- |',
    ...rows.map((row) => `| ${codeSpan(row.name, true)} | ${headerValueCell(row)} |`)
  ];
}

/**
 * The undefined-references section: the captured words as the page
 * reported them (the cross-origin sentinel spelled out — its real word is
 * hidden by the browser).
 *
 * @param words The captured words.
 * @returns The section's lines.
 */
function referenceLines(words: readonly string[]): string[] {
  if (words.length === 0) {
    return ['### Undefined references (0)', '', 'None were reported by the page.'];
  }
  return [
    `### Undefined references (${words.length.toString()})`,
    '',
    ...words.map((word) =>
      word === UNDEFINED_REFERENCE_EXTERNAL_ERROR
        ? '- A cross-origin script error (the browser hides its details)'
        : `- ${codeSpan(word)}`
    )
  ];
}

/**
 * Build the support report for one loaded data state.
 *
 * @param data The loaded page data.
 * @param context The report's provenance (time, extension version, page URL).
 * @returns The markdown report, `\n`-separated, ending with a newline.
 */
export function buildSupportReport(data: FdtData, context: SupportReportContext): string {
  const items = buildStatusItems(data);
  const sections = [
    [
      SUPPORT_REPORT_TITLE,
      '',
      ...contextLines(context),
      ...summaryLines(summarizeDetections(items))
    ],
    detectionLines(items),
    headerLines(data.pageHeaders),
    referenceLines(data.undefinedReferencesOnPage)
  ];
  return `${sections.map((lines) => lines.join('\n')).join('\n\n')}\n`;
}
