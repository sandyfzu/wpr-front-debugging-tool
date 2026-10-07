import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

/**
 * WCAG 2.1 AA gate for the token stylesheet.
 *
 * The palette in `theme.css` changes over the life of the project; this test keeps
 * it accessible mechanically. It reads the real file (never a copy), parses the
 * `light-dark(<light>, <dark>)` token values and enforces a committed pair table —
 * which text colors may sit on which backgrounds — at 4.5:1 for text and 3:1 for
 * the non-text focus indicator, in *both* palettes. Color edits that break
 * accessibility fail here instead of shipping.
 *
 * It also pins the token structure: every color token is a light-dark() pair and
 * every token is wired into the Tailwind namespace mapping.
 */

const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'theme.css'), 'utf8');

/**
 * Relative luminance per WCAG 2.1 (definition 2.2), on an opaque sRGB hex color.
 */
function luminance(hex: string): number {
  const digits = hex.replace('#', '');
  const encode = (channel: number): number =>
    channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4;
  const channel = (offset: number): number =>
    Number.parseInt(digits.slice(offset, offset + 2), 16) / 255;
  return 0.2126 * encode(channel(0)) + 0.7152 * encode(channel(2)) + 0.0722 * encode(channel(4));
}

/** WCAG 2.1 contrast ratio between two opaque colors. */
function contrastRatio(foreground: string, background: string): number {
  const first = luminance(foreground);
  const second = luminance(background);
  const [lighter, darker] = first >= second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}

interface PaletteValues {
  dark: string;
  light: string;
}

/** All `light-dark()` tokens in the stylesheet, keyed by plain token name. */
const tokens: Map<string, PaletteValues> = new Map();
for (const match of css.matchAll(
  /--([\w-]+):\s*light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)/g
)) {
  const [, name, lightValue, darkValue] = match;
  // `light-dark(lightValue, darkValue)` per CSS Color 5; groups are fixed, so a
  // full match always has them — skip defensively anyway.
  if (!name || !lightValue || !darkValue) continue;
  tokens.set(name, { light: lightValue, dark: darkValue });
}

function paletteValues(name: string): PaletteValues {
  const values = tokens.get(name);
  if (!values) throw new Error(`Palette token --${name} is not defined in theme.css`);
  return values;
}

const SURFACES = Array.from({ length: 5 }, (_, level) => `surface-${String(level)}`);
const STATUSES = ['ok', 'warn', 'error', 'info', 'neutral', 'attention'] as const;
const SOFT_BACKGROUNDS = STATUSES.map((status) => `status-${status}-soft`);
/** Surfaces host text directly; soft backgrounds host status text and body text. */
const BACKGROUNDS = [...SURFACES, ...SOFT_BACKGROUNDS];
/** Colors allowed as text (or icons/arrows conveying meaning) over any background. */
const FOREGROUNDS = [
  'fg-primary',
  'fg-secondary',
  'fg-muted',
  'accent',
  'accent-from',
  'accent-to',
  ...STATUSES.map((status) => `status-${status}`)
];

/** The committed pair table: foreground token, background token, required ratio. */
interface RequiredPair {
  foreground: string;
  background: string;
  min: number;
}
const REQUIRED_PAIRS: RequiredPair[] = [
  ...BACKGROUNDS.flatMap<RequiredPair>((background) =>
    FOREGROUNDS.map((foreground) => ({ foreground, background, min: 4.5 }))
  ),
  // Focus ring / accent indicator is non-text: 3:1 suffices (WCAG 1.4.11).
  ...SURFACES.map((background) => ({ foreground: 'accent', background, min: 3 })),
  // Text laid over accent fills (buttons, badges); deliberately NOT paired with
  // the decorative gradient endpoints — text on a gradient uses a solid fill.
  { foreground: 'on-accent', background: 'accent-strong', min: 4.5 }
];

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('token structure in theme.css', () => {
  it('defines every color token as a light-dark() pair', () => {
    expect(tokens.size).toBeGreaterThan(0);
    const colorTokens = [
      ...SURFACES,
      ...['line-0', 'line-1', 'line-2', 'line-3', 'line-4', 'line-strong'],
      ...FOREGROUNDS,
      'on-accent',
      'accent-strong',
      ...SOFT_BACKGROUNDS
    ];
    for (const name of colorTokens) {
      expect(tokens.has(name), `--${name} must be a light-dark() pair`).toBe(true);
    }
  });

  it('wires every color token into the Tailwind namespace mapping, and maps only defined tokens', () => {
    const mappings = [...css.matchAll(/--(color-[\w-]+):\s*var\(--([\w-]+)\)/g)];
    expect(mappings.length).toBeGreaterThan(0);
    const mappedTargets = new Set<string>();
    for (const [, source, target] of mappings) {
      if (!source || !target)
        throw new Error('A Tailwind mapping entry is missing one of its token names');
      expect(tokens.has(target), `--${source} points to --${target}, which is not defined`).toBe(
        true
      );
      mappedTargets.add(target);
    }
    const unmapped = [...tokens.keys()].filter((name) => !mappedTargets.has(name));
    expect(unmapped, 'color tokens must appear in the @theme inline mapping').toEqual([]);
  });

  it('gives every color token an AA role in the pair table (complete by construction)', () => {
    const pairedForegrounds = new Set(REQUIRED_PAIRS.map((pair) => pair.foreground));
    const pairedBackgrounds = new Set(REQUIRED_PAIRS.map((pair) => pair.background));
    const missing: string[] = [];
    for (const name of tokens.keys()) {
      // Decorative hairlines are excluded from the AA pair table by design; every
      // other token must appear as background or text.
      if (name.startsWith('line-')) continue;
      const isBackground =
        name.startsWith('surface-') || name.endsWith('-soft') || name === 'accent-strong';
      if (isBackground && !pairedBackgrounds.has(name)) missing.push(`--${name} (background)`);
      else if (!isBackground && !pairedForegrounds.has(name))
        missing.push(`--${name} (foreground)`);
    }
    expect(missing, 'tokens with no committed AA pair — add them to REQUIRED_PAIRS').toEqual([]);
  });
});

describe('WCAG AA pairs', () => {
  it('every required pair reaches its ratio in both palettes', () => {
    const failures: string[] = [];
    for (const palette of ['dark', 'light'] as const) {
      for (const { foreground, background, min } of REQUIRED_PAIRS) {
        const ratio = contrastRatio(
          paletteValues(foreground)[palette],
          paletteValues(background)[palette]
        );
        if (ratio < min) {
          failures.push(
            `${palette}: ${foreground} on ${background} = ${ratio.toFixed(2)} < ${String(min)}`
          );
        }
      }
    }
    expect(failures).toEqual([]);
  });
});
