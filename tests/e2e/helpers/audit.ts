/**
 * The browser tier's shared strict-axe runner over the panel document.
 *
 * An unresolved axe result is a miss, never a pass — `incomplete` is
 * asserted alongside `violations`. The one reviewed allowance (the
 * virtual-list clip disclosure): an `incomplete` is dismissed only when
 * every node is `color-contrast` with the `elmPartiallyObscured` key and
 * its target resolves inside a virtual list whose scroller owns the edge;
 * anything else — including a target that no longer resolves — stays
 * unresolved and fails.
 *
 * The accessibility engine is injected from the page's debugger into the
 * live document (kept out of the extension page's CSP); exactly one
 * double-RAF settle puts the audit behind the render's paint inputs.
 *
 * Palette rule: establish the palette BEFORE the panel page navigates
 * (`page.emulateMedia` before `goto` — `openPanelForFixture`'s `emulation`
 * option). Chromium applies a palette change made against an already
 * rendered document to its descendants with a ~2-frame lag, and an audit
 * walked inside that lag reads a palette mix that never renders (measured:
 * the root's `color-scheme` reads the new arm two frames before a plain
 * paragraph's resolved `light-dark()` does); the runner settles behind
 * paint only, never behind a flip it could not verify.
 *
 * Harness-only: no shipped module imports this file.
 */
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';

import type { Page } from '@playwright/test';

/** The dev-time axe source, read once per worker (outside extension CSP). */
const AXE_SOURCE = readFileSync(
  createRequire(import.meta.url).resolve('axe-core/axe.min.js'),
  'utf8'
);

/** The audited slice: violation ids, puzzles that stayed unresolved, and —
 * for each — the failing nodes' accessible summary (a named audit result). */
export interface PanelAxeAudit {
  readonly violations: readonly string[];
  readonly incomplete: readonly string[];
  /**
   * One line per failing rule: the id plus its nodes' failure summaries
   * (what the audit found, named — never a silent rule id).
   */
  readonly detail: readonly string[];
}

/**
 * Run axe over the whole panel document and answer the audited slice.
 *
 * Callers pick palettes and viewport before calling; the runner forces
 * nothing beyond the settle (an emulated reduced-motion/palette state is
 * the calling round's, not a hidden default here).
 *
 * @param panel The panel page to audit.
 * @returns `{ violations, incomplete }` — expected both empty; anything
 *   else names the failing rule by id.
 */
export async function runPanelAxe(panel: Page): Promise<PanelAxeAudit> {
  await panel.evaluate(AXE_SOURCE);
  return await panel.evaluate(async (): Promise<PanelAxeAudit> => {
    await document.fonts.ready;
    await new Promise<void>((done) => {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          done();
        });
      });
    });
    const result = await (
      window as unknown as {
        axe: {
          run: () => Promise<{
            violations: readonly {
              readonly id: string;
              readonly nodes: readonly {
                readonly failureSummary?: string;
                readonly target: unknown;
              }[];
            }[];
            incomplete: readonly {
              readonly id: string;
              readonly nodes: readonly {
                readonly target: unknown;
                readonly any: readonly { readonly data?: { readonly messageKey?: string } }[];
              }[];
            }[];
          }>;
        };
      }
    ).axe.run();
    const resolvesInsideVirtualList = (target: unknown): boolean => {
      if (!(target instanceof Array) || target.length === 0) return false;
      const selector = target.filter((part) => typeof part === 'string').join(' ');
      try {
        // Resolve explicitly: an unresolvable target (a row unmounted, a
        // drifted selector) stays unresolved — it never classifies as
        // in-list and silently passes.
        const el = document.querySelector(selector);
        return el !== null && el.closest('[data-fdt="virtual-list"]') !== null;
      } catch {
        return false;
      }
    };
    const unresolved = result.incomplete.filter(
      (rule) =>
        !(
          rule.id === 'color-contrast' &&
          rule.nodes.length > 0 &&
          rule.nodes.every(
            (node) =>
              node.any.length > 0 &&
              node.any.every((check) => check.data?.messageKey === 'elmPartiallyObscured') &&
              resolvesInsideVirtualList(node.target)
          )
        )
    );
    return {
      violations: result.violations.map((rule) => rule.id),
      incomplete: unresolved.map((rule) => rule.id),
      detail: [
        ...result.violations.map((rule) => {
          const nodes = rule.nodes.map((node) => JSON.stringify(node.target)).join(' || ');
          return `${rule.id}: ${rule.nodes.map((node) => node.failureSummary ?? 'no summary').join(' | ')} @ ${nodes}`;
        }),
        ...unresolved.map((rule) => `incomplete ${rule.id}`)
      ]
    };
  });
}
