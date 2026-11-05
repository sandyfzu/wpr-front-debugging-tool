/**
 * The RUCSS test's pattern work in one pure step: judge the page's
 * stylesheet URLs against the exclusion patterns and build the CSS with the
 * replacement pairs. Both run the user's patterns, whose cost is unbounded
 * (catastrophic backtracking), so this step runs in a worker that is
 * terminated past its budget (`./build-client`) — never on a page's thread.
 *
 * The input is plain data (the configuration, not a compiled plan:
 * patterns are compiled here, in the context that runs them).
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import { parseRucssTesterConfig, type RucssTesterConfig } from './config';
import {
  buildRucssCss,
  decideLinkStyle,
  prepareRucssRun,
  type ReplacementCount,
  type RucssCssFailure,
  type RucssExclusionFailure
} from './run-plan';

/** What one build needs. */
export interface RucssBuildInput {
  /** The run's configuration (validated before the run started). */
  readonly config: RucssTesterConfig;
  /** The service's CSS. */
  readonly shakenCss: string;
  /** The page's stylesheet URLs, in snapshot order. */
  readonly links: readonly string[];
}

/** Why a build produced nothing (the page stays untouched). */
export type RucssBuildFailure =
  | RucssCssFailure
  | RucssExclusionFailure
  /** A pattern no longer compiles (the configuration was not validated first — a defect). */
  | { readonly ok: false; readonly problem: 'invalid-config' };

/** A build's result. */
export type RucssBuildResult =
  | {
      readonly ok: true;
      /** The CSS to inject. */
      readonly css: string;
      /** Matches per applied pair, in order. */
      readonly applied: readonly ReplacementCount[];
      /** Indexes of the links an exclusion pattern keeps. */
      readonly keepLinks: readonly number[];
    }
  | RucssBuildFailure;

/**
 * Run the build.
 *
 * @param input See {@link RucssBuildInput}.
 * @returns The CSS, the pair counts and the kept links, or the failure.
 */
export function buildRucssResult(input: RucssBuildInput): RucssBuildResult {
  const prepared = prepareRucssRun(input.config);
  if (!prepared.ok) return { ok: false, problem: 'invalid-config' };
  const { plan } = prepared;
  const keepLinks: number[] = [];
  for (const [index, href] of input.links.entries()) {
    const decision = decideLinkStyle(href, plan.excludeFilePatterns);
    if (typeof decision === 'object') return decision;
    if (decision === 'excluded') keepLinks.push(index);
  }
  const built = buildRucssCss(input.shakenCss, plan);
  if (!built.ok) return built;
  return { ok: true, css: built.css, applied: built.applied, keepLinks };
}

/**
 * Guard a build input received by the worker (a structured clone).
 *
 * @param input The message data.
 * @returns The input with a tolerant-read configuration, or null.
 */
export function parseRucssBuildInput(input: unknown): RucssBuildInput | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['config', 'shakenCss', 'links'])) return null;
  const shakenCss = ownValue(input, 'shakenCss');
  const links = ownValue(input, 'links');
  if (typeof shakenCss !== 'string' || !Array.isArray(links)) return null;
  if (!links.every((href): href is string => typeof href === 'string')) return null;
  return { config: parseRucssTesterConfig(ownValue(input, 'config')), shakenCss, links };
}
