/**
 * The `<meta http-equiv="Content-Security-Policy">` policies a browser
 * applies from a served document (pure, string scan): HTML applies one
 * only as a child of `<head>` with a non-empty `content` (a report-only
 * meta is never applied), so the scan follows the tree builder's head
 * rules — a meta before `<head>` still lands in the implied head, one
 * after `</head>` but before any body content is moved into it, one after
 * body content (text, a non-head element, `<body>`) is ignored, as is one
 * inside `<template>` or `<noscript>` (raw text with scripting on). Each
 * policy keeps its offset: whether it precedes the Delay JS runtime
 * decides whether it binds the runtime element itself. A meta whose
 * attributes hold a reference the attribute decoder cannot read is
 * flagged, never skipped (its policy is unknown); it is still a head
 * element, so the scan goes on past it.
 */
import type { SimulationCspMeta } from '../messaging/exclusion-simulation';
import { isEndTag, scanTokens, type ScannedTag } from '../exclusion-builder/html-scan';
import { decodeAttributeValue } from '../../utils/html-attribute-value';
import { CSP_HEADER } from './csp-headers';

/** Start tags the tree builder keeps in `<head>` (also when met before it or after `</head>`). */
const HEAD_ELEMENTS: ReadonlySet<string> = new Set([
  'base',
  'basefont',
  'bgsound',
  'link',
  'meta',
  'noframes',
  'noscript',
  'script',
  'style',
  'template',
  'title'
]);

/** End tags after which the document is in its body (`</br>` included, as the tree builder reads it). */
const BODY_END_TAGS: ReadonlySet<string> = new Set(['body', 'html', 'br']);

/** Markup in a gap between tokens that is not text: comments, declarations, bogus comments. */
const NON_TEXT_MARKUP = /<!--->|<!-->|<!--[\s\S]*?(?:--!?>|$)|<[!?][^>]*>?|<\/(?![A-Za-z])[^>]*>?/g;

/** A character the tree builder reads as text: anything but TAB, LF, FF, CR, SPACE (U+FEFF included). */
const NON_WHITESPACE = /[^\t\n\f\r ]/;

/**
 * Whether a stretch between two tags holds text (which ends the head).
 *
 * @param gap The markup between two tokens.
 */
function holdsText(gap: string): boolean {
  return NON_WHITESPACE.test(gap.replace(NON_TEXT_MARKUP, ''));
}

/** A value the attribute decoder cannot read. */
const UNREADABLE = Symbol('unreadable');

/**
 * The first value of an attribute (the tokenizer drops repeats), decoded.
 *
 * @param tag The tag.
 * @param name The attribute name (lowercase).
 * @returns The value (`''` when absent or valueless), or {@link UNREADABLE}.
 */
function attributeValue(tag: ScannedTag, name: string): string | typeof UNREADABLE {
  const value = tag.attrs.find((attr) => attr.name === name)?.value ?? '';
  return decodeAttributeValue(value) ?? UNREADABLE;
}

/**
 * A meta's enforced CSP content.
 *
 * @param tag A `meta` start tag.
 * @returns The content, null when the meta is not an applied CSP one, or
 *   {@link UNREADABLE} when it may be one but cannot be read.
 */
function cspContent(tag: ScannedTag): string | null | typeof UNREADABLE {
  const httpEquiv = attributeValue(tag, 'http-equiv');
  if (httpEquiv === UNREADABLE) return UNREADABLE;
  if (httpEquiv.toLowerCase() !== CSP_HEADER) return null;
  const content = attributeValue(tag, 'content');
  return content === '' ? null : content;
}

/** A document's applied CSP metas as the scan reads them. */
export interface CspMetaScan {
  /** Each readable policy's content (decoded) and its tag's offset, in order. */
  readonly metas: SimulationCspMeta[];
  /** Some applied meta may be a CSP one but cannot be read (its policy is unknown). */
  readonly unreadable: boolean;
}

/**
 * The enforced CSP meta policies a document applies, in order.
 *
 * @param html The served document text.
 * @returns The readable policies, and whether an applied one is unreadable.
 */
export function cspMetaPolicies(html: string): CspMetaScan {
  const metas: SimulationCspMeta[] = [];
  let unreadable = false;
  let templates = 0;
  let previousEnd = 0;
  for (const token of scanTokens(html, 'browser')) {
    const gap = html.slice(previousEnd, token.start);
    previousEnd = token.end;
    if (templates === 0 && holdsText(gap)) break;
    if (isEndTag(token)) {
      if (token.name === 'template') templates = Math.max(0, templates - 1);
      else if (templates === 0 && BODY_END_TAGS.has(token.name)) break;
      continue;
    }
    if (token.name === 'template') {
      // `/>` never closes a non-void element: the template opens either way.
      templates += 1;
      continue;
    }
    if (templates > 0 || token.name === 'html' || token.name === 'head') continue;
    if (!HEAD_ELEMENTS.has(token.name)) break;
    const content = token.name === 'meta' ? cspContent(token) : null;
    if (content === UNREADABLE) unreadable = true;
    else if (content !== null) metas.push({ content, offset: token.start });
  }
  return { metas, unreadable };
}
