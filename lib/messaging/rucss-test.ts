/**
 * The RUCSS test's message contracts and their boundary guards.
 *
 * A run crosses three contexts, and only plain data crosses: compiled
 * patterns never leave the context that compiled them.
 *
 * 1. `startRucssTest` (DevTools panel → the tab's top frame): the content
 *    script asks the background for the service's CSS
 *    (`fetchRucssShakenCss`, sender-resolved), then snapshots the page's
 *    styles (inline ones judged on the spot — substring checks only) and
 *    answers the CSS plus the stylesheet URLs to judge. The page is not
 *    touched.
 * 2. The panel judges the URLs and builds the CSS off every page thread.
 * 3. `applyRucssTest` (panel → top frame): the content script injects the
 *    built CSS and, once the page took it, removes the snapshot's styles
 *    that are not kept.
 *
 * Every guard rebuilds its value from known fields only and returns null
 * on any violation (unknown key, wrong type, past a bound).
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { isRandomId } from '../../utils/random-id';
import { RUCSS_CONFIG_LIMITS } from '../rucss-tester/config';
import { RUCSS_ENDPOINT_URL_OVERHEAD_CHARS } from '../rucss-tester/endpoint';
import {
  RUCSS_RESPONSE_MAX_BYTES,
  type RucssFetchFailure,
  type RucssFetchOutcome
} from '../rucss-tester/response';
import { RUCSS_RESULT_CSS_MAX_CHARS } from '../rucss-tester/run-plan';
import { boundedString } from './guard-policy';

/** A page address's character cap. */
const PAGE_URL_CHARS = 32_768;

/** Bounds of every RUCSS test payload. */
export const RUCSS_TEST_LIMITS = {
  /** A page address. */
  urlChars: PAGE_URL_CHARS,
  /**
   * A request address: a page address within `urlChars` plus what the
   * builder adds around it, so the request built for any accepted page
   * address also passes every guard downstream.
   */
  requestUrlChars: PAGE_URL_CHARS + RUCSS_ENDPOINT_URL_OVERHEAD_CHARS,
  /**
   * A line list's total characters: the configuration's list cap, plus
   * room for the default preserve markers the run adds to the user's.
   */
  listChars: RUCSS_CONFIG_LIMITS.listChars + 1_024,
  /** Stylesheet links one snapshot may hold. */
  links: 5_000,
  /** All stylesheet URLs of one snapshot together (characters). */
  linkChars: 4 * 1024 * 1024,
  /**
   * The service's CSS (characters): UTF-8 decoding never yields more UTF-16
   * units than bytes, so the byte cap bounds it.
   */
  shakenCssChars: RUCSS_RESPONSE_MAX_BYTES,
  /** The built CSS (characters). */
  cssChars: RUCSS_RESULT_CSS_MAX_CHARS
} as const;

/** Content script → background: what one service request asks. */
export interface RucssFetchRequest {
  /** The tested page's address (`location.href`); must be on the sender's own origin. */
  readonly pageUrl: string;
  /** Safelist entries sent to the service. */
  readonly safelist: readonly string[];
  readonly mobile: boolean;
  readonly home: boolean;
}

/**
 * The background's answer: the request it sent (its address, for the
 * panel to show) and how it ended — or `refused` when the sender may not
 * ask (not a top-frame http(s) page, a malformed request, a page address
 * off the sender's origin). Nothing is sent when refused.
 */
export type RucssFetchReply =
  | {
      readonly kind: 'answered';
      readonly requestUrl: string;
      readonly outcome: RucssFetchOutcome;
    }
  | { readonly kind: 'refused' };

/** Panel → tab: start a run (no page change). */
export interface RucssStartRequest {
  readonly safelist: readonly string[];
  /** Preserve markers (defaults included) judged against inline styles. */
  readonly inlinePreserves: readonly string[];
  readonly mobile: boolean;
  readonly home: boolean;
}

/** Why a start produced nothing to apply (the page is untouched in every case). */
export type RucssStartFailure =
  /** The service request failed. */
  | {
      readonly kind: 'fetch';
      readonly requestUrl: string;
      readonly failure: RucssFetchFailure;
    }
  /** The background refused the request (see {@link RucssFetchReply}). */
  | { readonly kind: 'refused' }
  /** The background did not answer (not running, no answer in time, a malformed answer). */
  | { readonly kind: 'background-unreachable' }
  /** A newer start on the same page replaced this one (or the content script's context ended). */
  | { readonly kind: 'superseded' }
  /** The page has more stylesheet links than {@link RUCSS_TEST_LIMITS} allows. */
  | { readonly kind: 'too-many-styles' };

/** A start's answer. */
export type RucssStartReply =
  | {
      readonly ok: true;
      /** Names this start's style snapshot; the apply must carry it. */
      readonly runId: string;
      readonly requestUrl: string;
      /** The service's CSS. */
      readonly shakenCss: string;
      /** The snapshot's stylesheet URLs, in snapshot order (empty for a link without one). */
      readonly links: readonly string[];
    }
  | { readonly ok: false; readonly failure: RucssStartFailure };

/** Panel → tab: apply a started run. */
export interface RucssApplyRequest {
  readonly runId: string;
  /** The CSS to inject. */
  readonly css: string;
  /** Indexes into the start's `links` that are kept (matched an exclusion pattern). */
  readonly keepLinks: readonly number[];
}

/** What an apply did. */
export interface RucssApplySummary {
  /** Styles removed. */
  readonly removed: number;
  /** Inline styles kept by a preserve marker. */
  readonly preserved: number;
  /** Stylesheet links kept by an exclusion pattern. */
  readonly excluded: number;
  /** Snapshot styles already gone from the page before the apply. */
  readonly gone: number;
  /** Characters of the injected CSS. */
  readonly cssChars: number;
}

/**
 * Why an apply changed nothing:
 * - `stale-run` — the run is not this page's current one (a newer start,
 *   an earlier apply, a reloaded page);
 * - `invalid-request` — a kept index outside the snapshot;
 * - `no-document` — the page has no element to inject into;
 * - `css-blocked` — the page did not take the injected CSS (its Content
 *   Security Policy blocks inline styles, or the page made the style inert —
 *   no style sheet); the injected style was removed again and no page style
 *   was touched.
 */
export const RUCSS_APPLY_FAILURES = [
  'stale-run',
  'invalid-request',
  'no-document',
  'css-blocked'
] as const;

/** One apply failure (see {@link RUCSS_APPLY_FAILURES}). */
export type RucssApplyFailure = (typeof RUCSS_APPLY_FAILURES)[number];

/** An apply's answer. */
export type RucssApplyReply =
  | { readonly ok: true; readonly summary: RucssApplySummary }
  | { readonly ok: false; readonly failure: RucssApplyFailure };

/**
 * A list of non-empty strings whose characters together stay within `maxChars`.
 *
 * @param value The boundary value.
 * @param maxChars The cap on all entries' characters together.
 * @returns A fresh copy, or null.
 */
function parseStringList(value: unknown, maxChars: number): string[] | null {
  if (!Array.isArray(value)) return null;
  const list: string[] = [];
  let chars = 0;
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'string' || entry === '') return null;
    chars += entry.length;
    if (chars > maxChars) return null;
    list.push(entry);
  }
  return list;
}

/**
 * A list of distinct non-negative safe integers, at most `maxCount` long.
 *
 * @param value The boundary value.
 * @param maxCount The entry cap.
 * @returns A fresh copy, or null.
 */
function parseIndexList(value: unknown, maxCount: number): number[] | null {
  if (!Array.isArray(value) || value.length > maxCount) return null;
  const seen = new Set<number>();
  for (const entry of value as unknown[]) {
    if (typeof entry !== 'number' || !Number.isSafeInteger(entry) || entry < 0) return null;
    if (seen.has(entry)) return null;
    seen.add(entry);
  }
  return [...seen];
}

/**
 * An HTTP status as `fetch` reports it (an integer from 0 to 999).
 *
 * @param value The boundary value.
 */
function isHttpStatus(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0 && value <= 999;
}

/** Failure kinds that carry no field. */
const BARE_FETCH_FAILURES = [
  'network-error',
  'timeout',
  'cancelled',
  'oversize',
  'not-utf8'
] as const;

/**
 * Guard a service-request failure.
 *
 * @param input The boundary value.
 * @returns The failure, rebuilt, or null.
 */
export function parseRucssFetchFailure(input: unknown): RucssFetchFailure | null {
  if (!isRecord(input)) return null;
  const kind = ownValue(input, 'kind');
  const bare = BARE_FETCH_FAILURES.find((name) => name === kind);
  if (bare !== undefined) return hasOnlyKeys(input, ['kind']) ? { kind: bare } : null;
  const httpStatus = ownValue(input, 'httpStatus');
  if (!isHttpStatus(httpStatus)) return null;
  if (kind === 'http-status' || kind === 'malformed') {
    return hasOnlyKeys(input, ['kind', 'httpStatus']) ? { kind, httpStatus } : null;
  }
  const serviceCode = ownValue(input, 'serviceCode');
  if (kind !== 'service-code' || typeof serviceCode !== 'number') return null;
  if (!Number.isFinite(serviceCode)) return null;
  return hasOnlyKeys(input, ['kind', 'httpStatus', 'serviceCode'])
    ? { kind, httpStatus, serviceCode }
    : null;
}

/**
 * Guard a request's two flags.
 *
 * @param input The record.
 * @returns The flags, or null.
 */
function parseFlags(
  input: Record<string, unknown>
): { readonly mobile: boolean; readonly home: boolean } | null {
  const mobile = ownValue(input, 'mobile');
  const home = ownValue(input, 'home');
  return typeof mobile === 'boolean' && typeof home === 'boolean' ? { mobile, home } : null;
}

/**
 * Guard a service request (received by the background).
 *
 * @param input The boundary value.
 * @returns The request, rebuilt, or null.
 */
export function parseRucssFetchRequest(input: unknown): RucssFetchRequest | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['pageUrl', 'safelist', 'mobile', 'home'])) {
    return null;
  }
  const pageUrl = ownValue(input, 'pageUrl');
  const safelist = parseStringList(ownValue(input, 'safelist'), RUCSS_TEST_LIMITS.listChars);
  const flags = parseFlags(input);
  if (!boundedString(pageUrl, RUCSS_TEST_LIMITS.urlChars) || safelist === null) return null;
  return flags === null ? null : { pageUrl, safelist, ...flags };
}

/**
 * Guard a service request's outcome.
 *
 * @param input The boundary value.
 * @returns The outcome, rebuilt, or null.
 */
function parseRucssFetchOutcome(input: unknown): RucssFetchOutcome | null {
  if (!isRecord(input)) return null;
  const ok = ownValue(input, 'ok');
  if (ok === true) {
    const shakenCss = ownValue(input, 'shakenCss');
    return hasOnlyKeys(input, ['ok', 'shakenCss']) &&
      boundedString(shakenCss, RUCSS_TEST_LIMITS.shakenCssChars)
      ? { ok, shakenCss }
      : null;
  }
  const failure = parseRucssFetchFailure(ownValue(input, 'failure'));
  return ok === false && failure !== null && hasOnlyKeys(input, ['ok', 'failure'])
    ? { ok, failure }
    : null;
}

/**
 * Guard the background's answer (received by the content script).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null.
 */
export function parseRucssFetchReply(input: unknown): RucssFetchReply | null {
  if (!isRecord(input)) return null;
  const kind = ownValue(input, 'kind');
  if (kind === 'refused') return hasOnlyKeys(input, ['kind']) ? { kind } : null;
  const requestUrl = ownValue(input, 'requestUrl');
  const outcome = parseRucssFetchOutcome(ownValue(input, 'outcome'));
  if (kind !== 'answered' || outcome === null) return null;
  if (!hasOnlyKeys(input, ['kind', 'requestUrl', 'outcome'])) return null;
  return boundedString(requestUrl, RUCSS_TEST_LIMITS.requestUrlChars)
    ? { kind, requestUrl, outcome }
    : null;
}

/**
 * Guard a start request (received by the content script, or the relay).
 *
 * @param input The boundary value.
 * @returns The request, rebuilt, or null.
 */
export function parseRucssStartRequest(input: unknown): RucssStartRequest | null {
  if (!isRecord(input)) return null;
  if (!hasOnlyKeys(input, ['safelist', 'inlinePreserves', 'mobile', 'home'])) return null;
  const safelist = parseStringList(ownValue(input, 'safelist'), RUCSS_TEST_LIMITS.listChars);
  const inlinePreserves = parseStringList(
    ownValue(input, 'inlinePreserves'),
    RUCSS_TEST_LIMITS.listChars
  );
  const flags = parseFlags(input);
  if (safelist === null || inlinePreserves === null || flags === null) return null;
  return { safelist, inlinePreserves, ...flags };
}

/**
 * Guard a start failure.
 *
 * @param input The boundary value.
 * @returns The failure, rebuilt, or null.
 */
function parseRucssStartFailure(input: unknown): RucssStartFailure | null {
  if (!isRecord(input)) return null;
  const kind = ownValue(input, 'kind');
  if (
    kind === 'refused' ||
    kind === 'background-unreachable' ||
    kind === 'superseded' ||
    kind === 'too-many-styles'
  ) {
    return hasOnlyKeys(input, ['kind']) ? { kind } : null;
  }
  const requestUrl = ownValue(input, 'requestUrl');
  const failure = parseRucssFetchFailure(ownValue(input, 'failure'));
  if (kind !== 'fetch' || failure === null) return null;
  if (!hasOnlyKeys(input, ['kind', 'requestUrl', 'failure'])) return null;
  return boundedString(requestUrl, RUCSS_TEST_LIMITS.requestUrlChars)
    ? { kind, requestUrl, failure }
    : null;
}

/**
 * Guard the stylesheet URLs of a start's answer.
 *
 * @param value The boundary value.
 * @returns A fresh copy, or null.
 */
function parseLinks(value: unknown): string[] | null {
  if (!Array.isArray(value) || value.length > RUCSS_TEST_LIMITS.links) return null;
  let chars = 0;
  const links: string[] = [];
  for (const href of value as unknown[]) {
    if (typeof href !== 'string') return null;
    chars += href.length;
    if (chars > RUCSS_TEST_LIMITS.linkChars) return null;
    links.push(href);
  }
  return links;
}

/**
 * Guard a start's answer (received by the panel).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null.
 */
export function parseRucssStartReply(input: unknown): RucssStartReply | null {
  if (!isRecord(input)) return null;
  const ok = ownValue(input, 'ok');
  if (ok === false) {
    const failure = parseRucssStartFailure(ownValue(input, 'failure'));
    return failure !== null && hasOnlyKeys(input, ['ok', 'failure']) ? { ok, failure } : null;
  }
  if (ok !== true) return null;
  if (!hasOnlyKeys(input, ['ok', 'runId', 'requestUrl', 'shakenCss', 'links'])) return null;
  const runId = ownValue(input, 'runId');
  const requestUrl = ownValue(input, 'requestUrl');
  const shakenCss = ownValue(input, 'shakenCss');
  const links = parseLinks(ownValue(input, 'links'));
  if (!isRandomId(runId) || links === null) return null;
  if (!boundedString(requestUrl, RUCSS_TEST_LIMITS.requestUrlChars)) return null;
  return boundedString(shakenCss, RUCSS_TEST_LIMITS.shakenCssChars)
    ? { ok, runId, requestUrl, shakenCss, links }
    : null;
}

/**
 * Guard an apply request (received by the content script, or the relay).
 *
 * @param input The boundary value.
 * @returns The request, rebuilt, or null.
 */
export function parseRucssApplyRequest(input: unknown): RucssApplyRequest | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['runId', 'css', 'keepLinks'])) return null;
  const runId = ownValue(input, 'runId');
  const css = ownValue(input, 'css');
  const keepLinks = parseIndexList(ownValue(input, 'keepLinks'), RUCSS_TEST_LIMITS.links);
  if (!isRandomId(runId) || keepLinks === null) return null;
  return boundedString(css, RUCSS_TEST_LIMITS.cssChars) ? { runId, css, keepLinks } : null;
}

/** The summary's counters, in order. */
const SUMMARY_KEYS = ['removed', 'preserved', 'excluded', 'gone', 'cssChars'] as const;

/**
 * Guard an apply summary.
 *
 * @param input The boundary value.
 * @returns The summary, rebuilt, or null.
 */
function parseRucssApplySummary(input: unknown): RucssApplySummary | null {
  if (!isRecord(input) || !hasOnlyKeys(input, SUMMARY_KEYS)) return null;
  const summary: Partial<Record<(typeof SUMMARY_KEYS)[number], number>> = {};
  for (const key of SUMMARY_KEYS) {
    const count = ownValue(input, key);
    if (typeof count !== 'number' || !Number.isSafeInteger(count) || count < 0) return null;
    summary[key] = count;
  }
  return summary as RucssApplySummary;
}

/**
 * Guard an apply's answer (received by the panel).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null.
 */
export function parseRucssApplyReply(input: unknown): RucssApplyReply | null {
  if (!isRecord(input)) return null;
  const ok = ownValue(input, 'ok');
  if (ok === true) {
    const summary = parseRucssApplySummary(ownValue(input, 'summary'));
    return summary !== null && hasOnlyKeys(input, ['ok', 'summary']) ? { ok, summary } : null;
  }
  const failure = RUCSS_APPLY_FAILURES.find((name) => name === ownValue(input, 'failure'));
  return ok === false && failure !== undefined && hasOnlyKeys(input, ['ok', 'failure'])
    ? { ok, failure }
    : null;
}
