/**
 * Pins the overlay stylesheet's scroll containment (layout itself is proven
 * in the browser tier): the layer can never scroll, and the panel body is
 * the containing block of everything absolutely positioned inside it, so a
 * focus move reveals its target by scrolling the body, never by carrying
 * the panel off screen.
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
