/**
 * Pins the overlay stylesheet's scroll containment (layout itself is proven
 * in the browser tier): the layer can never scroll, and the panel body is
 * the containing block of everything absolutely positioned inside it, so a
 * focus move reveals its target by scrolling the body, never by carrying
 * the panel off screen — and the banner's open session-notes disclosure,
 * which drops the accent fill on the tinted banners.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declaredValue } from '@/components/injected-ui/stylesheet-rules.testing';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'overlay.css'), 'utf8');

describe('overlay scroll containment', () => {
  it('clips the layer instead of hiding its overflow (a hidden box still scrolls on focus)', () => {
    expect(declaredValue(CSS, '.xo-layer', 'overflow')).toBe('clip');
  });

  it('makes the body the containing block of its absolutely positioned descendants', () => {
    expect(declaredValue(CSS, '.xo-body', 'position')).toBe('relative');
    expect(declaredValue(CSS, '.xo-body', 'overflow-y')).toBe('auto');
    expect(declaredValue(CSS, '.xo-body', 'min-height')).toBe('0');
  });
});

describe('the banner’s open session-notes disclosure', () => {
  /** The open toggle inside a (tinted) banner. */
  const OPEN = ".xo-banner-session .xo-note-disclosure.xo-disclosure[aria-expanded='true']";
  /** The generic open fill's pointer rule it must outrank. */
  const OPEN_FILL_HOVER = ".xo-disclosure[aria-expanded='true']:not([aria-disabled='true']):hover";

  it('drops the accent fill for the accent border on the resting surface', () => {
    // The pairs this rule relies on are pinned in assets/css/theme.test.ts.
    expect(declaredValue(CSS, OPEN, 'background')).toBe('var(--surface-2)');
    expect(declaredValue(CSS, OPEN, 'border-color')).toBe('var(--accent)');
    expect(declaredValue(CSS, OPEN, 'color')).toBe('var(--fg-primary)');
  });

  it('comes after the open fill’s pointer rule (same specificity), so hover keeps it', () => {
    expect(CSS.indexOf(`${OPEN} {`)).toBeGreaterThan(CSS.indexOf(`${OPEN_FILL_HOVER} {`));
    expect(CSS.indexOf(`${OPEN_FILL_HOVER} {`)).toBeGreaterThan(-1);
  });
});
