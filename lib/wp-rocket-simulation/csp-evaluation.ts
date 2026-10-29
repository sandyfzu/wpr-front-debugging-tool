/**
 * The page-CSP check of a simulation step: given the page's Content
 * Security Policy inputs and the simulated document, whether the policy
 * blocks the injected runtime outright (the step then reports
 * `csp-blocked` and serves the page as is) and which of its work it limits.
 *
 * Inert slot: every policy is taken as allowing everything until the
 * evaluator is built here — the step and the pipeline call it already, so
 * the evaluator lands without touching them.
 */
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import type { SimulationCspLimit } from './spec';

/** The check's verdict. */
export type SimulationCspVerdict =
  | { readonly blocked: true }
  | {
      readonly blocked: false;
      /** Runtime work the policy limits, each once (empty: none). */
      readonly limits: readonly SimulationCspLimit[];
    };

/** The verdict that blocks and limits nothing. */
const ALLOWED: SimulationCspVerdict = { blocked: false, limits: [] };

/**
 * Evaluates a page's CSP against a simulated document.
 *
 * @param csp The page's policy inputs (absent: none known — allowed).
 * @param html The simulated document.
 * @returns The verdict.
 */
export type SimulationCspEvaluator = (
  csp: SimulationCspInput | undefined,
  html: string
) => SimulationCspVerdict;

/** The evaluator the simulation step calls (today: always allowed, limiting nothing). */
export const evaluateSimulationCsp: SimulationCspEvaluator = () => ALLOWED;
