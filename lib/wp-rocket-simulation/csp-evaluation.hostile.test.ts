/**
 * The CSP evaluator on hostile sizes: each policy is read once and each
 * script digested once per algorithm, so time grows linearly with the
 * scripts — never scripts × policies × tokens of re-tokenizing/re-hashing.
 */
import { createHash, randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { LINEAR_SCALING_TIMEOUT_MS, linearScaling } from '../../vitest.shared';
import type { SimulationCspInput } from '../messaging/exclusion-simulation';
import { evaluateSimulationCsp, type SimulationCspVerdict } from './csp-evaluation';
import type { SimulationCspBrowser } from './spec';

/** The injected runtime stand-in. */
const RUNTIME = 'window.rt=1;';

/** `'<algorithm>-<base64>'` of a text. */
function hash(algorithm: 'sha256' | 'sha512', text: string): string {
  return `'${algorithm}-${createHash(algorithm).update(text, 'utf8').digest('base64')}'`;
}

/** A simulated page: the runtime after `<head>`, then the delayed inline scripts. */
function page(scripts: readonly string[]): string {
  const body = scripts.map((text) => `<script type="rocketlazyloadscript">${text}</script>`);
  return `<html><head><script>${RUNTIME}</script></head><body>${body.join('')}</body></html>`;
}

/** One input: the policies and the page. */
interface Hostile {
  readonly headers: readonly string[];
  readonly html: string;
}

/** Evaluate one input for an engine. */
function evaluate(input: Hostile, browser: SimulationCspBrowser): SimulationCspVerdict {
  const csp: SimulationCspInput = {
    browser,
    headers: input.headers.map((value) => ({ name: 'Content-Security-Policy', value })),
    metas: []
  };
  const served = input.html.replace(`<script>${RUNTIME}</script>`, '');
  return evaluateSimulationCsp({ csp, served, simulated: input.html, runtime: RUNTIME });
}

describe('evaluateSimulationCsp — hostile sizes', () => {
  // ~32 KiB of unrelated hash sources beside the runtime's hash; 'strict-dynamic' allows
  // every delayed script, so each one is checked against all 32 policies (no early exit).
  const junk = Array.from({ length: 600 }, () => `'sha256-${randomBytes(32).toString('base64')}'`);
  const wide = `script-src ${hash('sha256', RUNTIME)} 'strict-dynamic' 'unsafe-eval' ${junk.join(' ')}`;

  for (const browser of ['chromium', 'firefox'] as const) {
    it(
      `32 policies of ~32 KiB × thousands of scripts stay linear (${browser})`,
      () => {
        const scaling = linearScaling(
          (bytes): Hostile => ({
            headers: Array.from({ length: 32 }, () => wide),
            html: page(
              Array.from({ length: Math.floor(bytes / 64) }, (_, at) => `f(${String(at)})`)
            )
          }),
          (input) => evaluate(input, browser)
        );
        expect(scaling.violation).toBeUndefined();
        expect(scaling.output).toEqual({ blocked: false, limits: [] });
      },
      LINEAR_SCALING_TIMEOUT_MS
    );

    it(
      `megabytes of SHA-512-matched inline scripts are digested once each (${browser})`,
      () => {
        const scaling = linearScaling(
          (bytes): Hostile => {
            const scripts = Array.from(
              { length: Math.floor(bytes / 10_000) },
              (_, at) => `var x${String(at)}="${'y'.repeat(10_000)}";`
            );
            const hashes = scripts.map((text) => hash('sha512', text)).join(' ');
            const policy = `script-src ${hash('sha256', RUNTIME)} 'unsafe-eval' ${hashes}`;
            return { headers: [policy, policy, policy], html: page(scripts) };
          },
          (input) => evaluate(input, browser)
        );
        expect(scaling.violation).toBeUndefined();
        // Chromium: no data: source, so each script is recreated — and its hash allows it.
        expect(scaling.output).toEqual({
          blocked: false,
          limits: browser === 'chromium' ? ['data'] : []
        });
      },
      LINEAR_SCALING_TIMEOUT_MS
    );
  }
});
