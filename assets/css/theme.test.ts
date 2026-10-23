import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../utils/contrast';

/**
 * WCAG 2.1 AA gate for the design tokens.
 *
 * The palette changes over the life of the project; this test keeps it
 * accessible mechanically. It reads the real files (never a copy) — the token
 * definitions in `tokens.css` and the Tailwind mapping layer in `theme.css`
 * — parses the `light-dark(<light>, <dark>)` token values and enforces a
 * committed pair table — which text colors may sit on which backgrounds — at
 * 4.5:1 for text and 3:1 for the non-text focus indicator, in *both* palettes.
 * Color edits that break accessibility fail here instead of shipping.
 *
 * It also pins the token structure: every color token is a light-dark() pair,
 * every token is wired into the Tailwind namespace mapping, and the injected
 * (shadow-root) stylesheet defines every custom property it consumes — no
 * token may leak through host-page inheritance or silently lose its value.
 */

/** The stylesheet text the gate reads: both defining files, in directory order.
 * Rules may move between the files (or new token files join them) without
 * weakening any check below. */
const css = ['tokens.css', 'theme.css']
  .map((file) => readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8'))
  .join('\n');

/** A stylesheet `@import` of a local (relative) file — the only graph edges
 * injected stylesheets have. */
const LOCAL_IMPORT = /@import\s+['"](\.[^'"]+)['"]\s*;/g;

/**
 * The injected (shadow-root) stylesheet chain: the content-script entry
 * stylesheet plus every local file it imports, recursively — the closed
 * graph a consumed token must be defined within.
 *
 * @param file The entry stylesheet, relative to this test's directory.
 * @returns One string: the chain's concatenated sources.
 */
function readInjectedChain(file: string): string {
  const entry = join(dirname(fileURLToPath(import.meta.url)), file);
  const visited = new Set<string>();
  const sources: string[] = [];
  const visit = (path: string): void => {
    if (visited.has(path)) return;
    visited.add(path);
    const source = readFileSync(path, 'utf8');
    sources.push(source);
    for (const match of source.matchAll(LOCAL_IMPORT)) {
      const specifier = match[1];
      if (specifier !== undefined) visit(resolve(dirname(path), specifier));
    }
  };
  visit(entry);
  return sources.join('\n');
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
  if (!values) throw new Error(`Palette token --${name} is not defined in the token files`);
  return values;
}

const SURFACES = Array.from({ length: 5 }, (_, level) => `surface-${String(level)}`);
/** The surface levels an `accent-strong` fill is laid on (page, card, injected panel). */
const FILL_SURFACES = SURFACES.slice(0, 3);
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
  { foreground: 'on-accent', background: 'accent-strong', min: 4.5 },
  // The inverted pair: an `on-accent` pill inside an accent fill (the
  // selected filter chip's count) — same ratio by symmetry, pinned by name.
  { foreground: 'accent-strong', background: 'on-accent', min: 4.5 },
  // The accent fill itself is a non-text state indicator (pressed chip,
  // checked switch, open disclosure, primary action): 3:1 against every
  // surface it is laid on — pages, cards and the injected panels use levels
  // 0–2; nothing places it on the raised hover levels 3–4.
  ...FILL_SURFACES.map((background) => ({ foreground: 'accent-strong', background, min: 3 })),
  // A checked switch's thumb: a `surface-0` dot on the accent track (non-text).
  { foreground: 'surface-0', background: 'accent-strong', min: 3 }
];

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('token structure in the token files', () => {
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

describe('accent fill hover/press states', () => {
  /** Read a repo file relative to this test's directory. */
  const read = (file: string): string =>
    readFileSync(join(dirname(fileURLToPath(import.meta.url)), file), 'utf8');

  /** `#rrggbb` from 0–255 channels (rounded, clamped — what the browser paints). */
  const toHex = (channels: readonly number[]): string =>
    `#${channels
      .map((value) =>
        Math.min(255, Math.max(0, Math.round(value)))
          .toString(16)
          .padStart(2, '0')
      )
      .join('')}`;

  /** 0–255 channels of an opaque `#rrggbb`. */
  const channelsOf = (hex: string): number[] =>
    [1, 3, 5].map((offset) => Number.parseInt(hex.slice(offset, offset + 2), 16));

  /** One derived fill: how it is computed from `accent-strong` in a palette. */
  interface DerivedFill {
    name: string;
    color: (palette: 'dark' | 'light') => string;
    /** A press flash (`:active`): held only while the pointer is down, so it
     * is never what identifies the control — its text still must read. */
    momentary: boolean;
  }

  // `color-mix(in srgb, var(--accent-strong) N%, var(--token))` — the injected
  // stylesheets' hover fills (a plain per-channel mix of opaque colors).
  const mixes: DerivedFill[] = [
    'entrypoints/exclusion-overlay.content/overlay.css',
    'entrypoints/isolated.content/side-by-side/side-by-side.css'
  ].flatMap((file) =>
    [
      ...read(`../../${file}`).matchAll(
        /color-mix\(in srgb, var\(--accent-strong\) (\d+)%, var\(--([\w-]+)\)\)/g
      )
    ].map(([source, percent, other]) => ({
      name: `${file}: ${source}`,
      momentary: false,
      color: (palette: 'dark' | 'light'): string => {
        const weight = Number(percent) / 100;
        const accent = channelsOf(paletteValues('accent-strong')[palette]);
        const mixed = channelsOf(paletteValues(other ?? '')[palette]);
        return toHex(
          accent.map((value, index) => value * weight + (mixed[index] ?? 0) * (1 - weight))
        );
      }
    }))
  );

  // `brightness-N` utilities in the primitives that paint `bg-accent-strong`
  // (hover lift / press): CSS `brightness()` scales each sRGB channel, clamped.
  const brightened: DerivedFill[] = ['button.tsx', 'filter-bar.tsx'].flatMap((file) => {
    const source = read(`../../components/ui/${file}`);
    expect(source, `${file} paints the accent fill`).toContain('bg-accent-strong');
    return [...source.matchAll(/(hover|active):brightness-(\d+)/g)].map(
      ([utility, state, percent]) => ({
        name: `${file}: ${utility}`,
        momentary: state === 'active',
        color: (palette: 'dark' | 'light'): string =>
          toHex(
            channelsOf(paletteValues('accent-strong')[palette]).map(
              (value) => (value * Number(percent)) / 100
            )
          )
      })
    );
  });

  it('finds the derived fills it gates', () => {
    expect(mixes.length).toBeGreaterThanOrEqual(2);
    expect(brightened.length).toBeGreaterThanOrEqual(3);
  });

  it('keeps on-accent text at 4.5:1 and a hover fill at 3:1 on its surfaces, both palettes', () => {
    const failures: string[] = [];
    for (const palette of ['dark', 'light'] as const) {
      for (const derived of [...mixes, ...brightened]) {
        const fill = derived.color(palette);
        const text = contrastRatio(paletteValues('on-accent')[palette], fill);
        if (text < 4.5)
          failures.push(`${palette}: on-accent on ${derived.name} = ${text.toFixed(2)}`);
        if (derived.momentary) continue;
        for (const surface of FILL_SURFACES) {
          const edge = contrastRatio(fill, paletteValues(surface)[palette]);
          if (edge < 3)
            failures.push(`${palette}: ${derived.name} on ${surface} = ${edge.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('injected stylesheet token integrity', () => {
  /** First capture group of every match (`matchAll` groups are optional). */
  const captured = (matches: Iterable<RegExpMatchArray>): string[] =>
    [...matches].map((match) => match[1]).filter((name): name is string => name !== undefined);

  /** Custom properties declared (not referenced) anywhere in a stylesheet text. */
  function declaredIn(text: string): Set<string> {
    // A declaration is `--name:` — `var(--name)` never carries the colon and
    // no other `--name` occurrence in these files does either.
    return new Set(captured(text.matchAll(/--([\w-]+):/g)));
  }

  const injectedChain = readInjectedChain('../../entrypoints/isolated.content/styles.css');
  const injectedDefinitions = declaredIn(injectedChain);
  const usedInChain = new Set(captured(injectedChain.matchAll(/var\(\s*--([\w-]+)/g)));

  it('defines every consumed custom property inside the injected graph itself', () => {
    // Inside a shadow root the stylesheet is the whole world: anything it
    // references undeclared either falls through to host inheritance (a
    // page-controlled channel the injection isolation forbids) or silently
    // loses its value — e.g. a list whose elevation shadow never arrives.
    const missing = [...usedInChain].filter((name) => !injectedDefinitions.has(name));
    expect(missing).toEqual([]);
  });
});

describe('layout tiers (UI/UX bar L-1)', () => {
  it('declares the page tiers once, as literal named container sizes', () => {
    // Literal px, never var(): container conditions compile at build time, and
    // these generate the `@regular:` / `@wide:` variants pages write.
    expect(css).toMatch(/--container-regular:\s*480px;/);
    expect(css).toMatch(/--container-wide:\s*768px;/);
    expect(css.match(/--container-(regular|wide):/g)).toHaveLength(2);
  });
});
