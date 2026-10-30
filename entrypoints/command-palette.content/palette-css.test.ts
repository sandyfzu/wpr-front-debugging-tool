/**
 * Pins the palette stylesheet's layer containment (layout itself is proven
 * in the browser tier): the full-viewport layer clips instead of hiding its
 * overflow, so a focus move can never scroll it and carry the dialog off
 * screen.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

import { declaredValue } from '@/components/injected-ui/stylesheet-rules.testing';

const CSS = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'palette.css'), 'utf8');

describe('palette layer containment', () => {
  it('clips the layer instead of hiding its overflow (a hidden box still scrolls on focus)', () => {
    expect(declaredValue(CSS, '.cp-layer', 'overflow')).toBe('clip');
  });
});
