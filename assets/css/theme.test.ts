import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { contrastRatio } from '../../utils/contrast';
import { parseRules } from './css-rules.fixtures';

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

/** This test's directory: every relative path below resolves against it. */
const HERE = dirname(fileURLToPath(import.meta.url));

/**
 * Read a repo file.
 *
 * @param file The path, relative to this test's directory.
 * @returns The file's UTF-8 text.
 */
function read(file: string): string {
  return readFileSync(join(HERE, file), 'utf8');
}

/** The stylesheet text the gate reads: both defining files, in directory order.
 * Rules may move between the files (or new token files join them) without
 * weakening any check below. */
const css = ['tokens.css', 'theme.css'].map(read).join('\n');

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
  const entry = join(HERE, file);
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

/** Token name → its `light-dark()` pair. */
type PaletteMap = ReadonlyMap<string, PaletteValues>;

/** One `light-dark(#rrggbb, #rrggbb)` value (light first, per CSS Color 5). */
const HEX_PAIR = /^light-dark\(\s*(#[0-9a-f]{6})\s*,\s*(#[0-9a-f]{6})\s*\)$/;

/** The shared token block's selectors: page roots, shadow hosts, in-shadow re-declarations. */
const SHARED_SELECTORS = [':root', ':host', '[data-fdt-tokens]'] as const;

/** The extension-page block's selector: `<html>` of the panel + options documents. */
const EXTENSION_PAGE_SELECTOR = ":root[data-fdt-surface='extension-page']";

/** Every style rule of the token files, at-rule-wrapped ones included. */
const allRules = parseRules(css);

/** Every top-level style rule of the token files (at-rule contents excluded). */
const topLevelRules = allRules.filter((rule) => rule.within.length === 0);

/** The token files' text without comments (which quote declarations as prose). */
const cssText = css.replace(/\/\*[\s\S]*?\*\//g, '');

/** Sources rendered in the panel + options documents (the extension-page palette). */
const EXTENSION_PAGE_SOURCES = [
  '../../entrypoints/panel',
  '../../entrypoints/options',
  '../../components/ui'
] as const;

/**
 * The palette pairs one top-level selector declares, plus its custom
 * properties that are not hex pairs (the gate cannot check those).
 *
 * @param selector The exact (whitespace-normalized) selector.
 * @returns The pairs by token name and the unparsed custom-property names.
 */
function blockTokens(selector: string): { pairs: PaletteMap; unparsed: string[] } {
  const pairs = new Map<string, PaletteValues>();
  const unparsed: string[] = [];
  for (const rule of topLevelRules.filter((candidate) => candidate.selector === selector)) {
    for (const [property, value] of rule.declarations) {
      if (!property.startsWith('--')) continue;
      const [, light, dark] = HEX_PAIR.exec(value) ?? [];
      if (light === undefined || dark === undefined) unparsed.push(property);
      else pairs.set(property.slice(2), { light, dark });
    }
  }
  return { pairs, unparsed };
}

/** The shared palette: what every surface (injected UIs included) resolves. */
const shared: PaletteMap = blockTokens('[data-fdt-tokens]').pairs;

/** The extension-page block's own declarations (overrides only). */
const pageBlock = blockTokens(EXTENSION_PAGE_SELECTOR);

/** The extension pages' palette: the shared values overridden by the page block. */
const extensionPage: PaletteMap = new Map([...shared, ...pageBlock.pairs]);

/** Both resolved palettes, named for failure messages. */
const PALETTE_MAPS = [
  { scope: 'shared', map: shared },
  { scope: 'extension-page', map: extensionPage }
] as const;

/**
 * One token's pair in a resolved palette.
 *
 * @param map The resolved palette.
 * @param name The token name, without `--`.
 * @throws {@link Error} naming the token when the palette lacks it.
 */
function paletteValues(map: PaletteMap, name: string): PaletteValues {
  const values = map.get(name);
  if (!values) throw new Error(`Palette token --${name} is not defined in the token files`);
  return values;
}

const SURFACES = Array.from({ length: 5 }, (_, level) => `surface-${String(level)}`);
/**
 * The surface levels an `accent-strong` fill may sit on — at rest and in
 * every hover/press state (a hover halo drawn under it included): page,
 * card, injected panel. Levels 3–4 are the raised hover surfaces, where the
 * dark fill cannot reach 3:1; the source scans below fail any hover
 * background under an accent fill that leaves this set.
 */
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
  { foreground: 'surface-0', background: 'accent-strong', min: 3 },
  // The open session-notes disclosure on a tinted banner (the accent fill
  // misses 3:1 on the dark soft tints): its `accent` border is the non-text
  // indicator, on each banner tint and on its own `surface-2` fill.
  ...['ok', 'warn', 'error', 'info'].map((status) => ({
    foreground: 'accent',
    background: `status-${status}-soft`,
    min: 3
  })),
  { foreground: 'accent', background: 'surface-2', min: 3 },
  // The selected-state tint (selected nav/list row, icon tile) hosts the
  // row's name, meta and count text and its accent icon.
  ...['fg-primary', 'fg-secondary', 'fg-muted', 'accent'].map((foreground) => ({
    foreground,
    background: 'accent-soft',
    min: 4.5
  }))
];

describe('contrast math', () => {
  it('matches the WCAG reference values', () => {
    expect(contrastRatio('#ffffff', '#000000')).toBe(21);
    expect(contrastRatio('#777777', '#ffffff')).toBeCloseTo(4.48, 2);
  });
});

describe('token structure in the token files', () => {
  it('defines every color token as a light-dark() pair', () => {
    expect(shared.size).toBeGreaterThan(0);
    const colorTokens = [
      ...SURFACES,
      ...['line-0', 'line-1', 'line-2', 'line-3', 'line-4', 'line-strong'],
      ...FOREGROUNDS,
      'on-accent',
      'accent-strong',
      'accent-soft',
      ...SOFT_BACKGROUNDS
    ];
    for (const name of colorTokens) {
      expect(shared.has(name), `--${name} must be a light-dark() pair`).toBe(true);
    }
  });

  it('wires every color token into the Tailwind namespace mapping, and maps only defined tokens', () => {
    const mappings = [...css.matchAll(/--(color-[\w-]+):\s*var\(--([\w-]+)\)/g)];
    expect(mappings.length).toBeGreaterThan(0);
    const mappedTargets = new Set<string>();
    for (const [, source, target] of mappings) {
      if (!source || !target)
        throw new Error('A Tailwind mapping entry is missing one of its token names');
      expect(shared.has(target), `--${source} points to --${target}, which is not defined`).toBe(
        true
      );
      mappedTargets.add(target);
    }
    const unmapped = [...shared.keys()].filter((name) => !mappedTargets.has(name));
    expect(unmapped, 'color tokens must appear in the @theme inline mapping').toEqual([]);
  });

  it('gives every color token an AA role in the pair table (complete by construction)', () => {
    const pairedForegrounds = new Set(REQUIRED_PAIRS.map((pair) => pair.foreground));
    const pairedBackgrounds = new Set(REQUIRED_PAIRS.map((pair) => pair.background));
    const missing: string[] = [];
    for (const name of shared.keys()) {
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

describe('palette blocks (shared + extension-page)', () => {
  it('declares the same shared palette on every shared selector', () => {
    // One rule written for page roots, shadow hosts and in-shadow
    // re-declarations: a selector that drifted out of it would leave that
    // context on a different (untested) palette.
    for (const selector of SHARED_SELECTORS) {
      expect(blockTokens(selector).pairs, selector).toEqual(shared);
    }
  });

  it('declares shared tokens only under the shared or extension-page selectors', () => {
    // Any other rule — another selector, or either block wrapped in an
    // at-rule — would set a value the maps never see, so the AA gate would
    // keep testing the old one.
    const allowed = new Set<string>([...SHARED_SELECTORS, EXTENSION_PAGE_SELECTOR]);
    const strays = allRules
      .filter((rule) => rule.within.length > 0 || !allowed.has(rule.selector))
      .flatMap((rule) =>
        rule.declarations
          .filter(([property]) => property.startsWith('--') && shared.has(property.slice(2)))
          .map(([property]) => `${property} in ${[...rule.within, rule.selector].join(' > ')}`)
      );
    expect(strays).toEqual([]);
  });

  it('writes each shared token once in the shared block, at most once in the page block', () => {
    // Counted on the raw text so what the rule reader skips (a declaration
    // directly inside an at-rule such as `@theme`) or collapses (a name
    // repeated inside one block) still fails.
    const miscounted = [...shared.keys()].flatMap((name) => {
      const written = [...cssText.matchAll(new RegExp(`(?<![\\w-])--${name}\\s*:`, 'g'))].length;
      const expected = pageBlock.pairs.has(name) ? 2 : 1;
      return written === expected
        ? []
        : [`--${name}: written ${String(written)}, expected ${String(expected)}`];
    });
    expect(miscounted).toEqual([]);
  });

  it('declares hex light-dark() pairs only on shared token names', () => {
    // A new pair outside the shared block would hold a palette value no AA
    // pair covers.
    const unknown = [...cssText.matchAll(/(?<![\w-])--([\w-]+)\s*:\s*light-dark\(\s*#/g)]
      .map(([, name]) => name ?? '')
      .filter((name) => !shared.has(name));
    expect(unknown).toEqual([]);
  });

  it('re-declares only shared tokens in the extension-page block (typo guard)', () => {
    expect(pageBlock.pairs.size).toBeGreaterThan(0);
    const unknown = [...pageBlock.pairs.keys()].filter((name) => !shared.has(name));
    expect(unknown, 'extension-page tokens with no shared declaration').toEqual([]);
  });

  it('declares only hex light-dark() custom-property pairs in the extension-page block', () => {
    // Any other value would override a shared pair in the browser while the
    // AA gate kept testing the shared one; a plain property would restyle the
    // pages' `<html>` from a block meant to hold only palette overrides.
    expect(pageBlock.unparsed).toEqual([]);
    const plain = allRules
      .filter((rule) => rule.selector === EXTENSION_PAGE_SELECTOR)
      .flatMap((rule) => rule.declarations.map(([property]) => property))
      .filter((property) => !property.startsWith('--'));
    expect(plain).toEqual([]);
  });

  it('keeps data-fdt-tokens out of the extension documents', () => {
    const offenders = EXTENSION_PAGE_SOURCES.flatMap((dir) =>
      readdirSync(join(HERE, dir), { recursive: true, encoding: 'utf8' })
        // Shipped sources only: a test may name the attribute to assert its absence.
        .filter((file) => /\.(tsx?|html|css)$/.test(file) && !/\.test\.tsx?$/.test(file))
        .filter((file) => /data-fdt-tokens|fdtTokens/.test(read(`${dir}/${file}`)))
        .map((file) => `${dir}/${file}`)
    );
    expect(
      offenders,
      'data-fdt-tokens re-declares the shared palette on its subtree, undoing the extension-page ' +
        'palette there: set it only on shadow-root containers in content-script entrypoints. A ' +
        'components/ui primitive that also renders in an injected UI never hard-codes it — the ' +
        'injected caller sets it on its own container.'
    ).toEqual([]);
  });

  it('pins the extension-page attribute statically on both extension documents', () => {
    const [, attribute, value] =
      /^:root\[([\w-]+)='([\w-]+)'\]$/.exec(EXTENSION_PAGE_SELECTOR) ?? [];
    if (attribute === undefined || value === undefined)
      throw new Error(`Unexpected extension-page selector: ${EXTENSION_PAGE_SELECTOR}`);
    for (const page of ['panel', 'options']) {
      // On `<html>` itself, in the static markup: present before the first
      // paint, with no script involved.
      expect(read(`../../entrypoints/${page}/index.html`), page).toMatch(
        new RegExp(`<html\\b[^>]*\\s${attribute}="${value}"[^>]*>`)
      );
    }
  });
});

describe('WCAG AA pairs', () => {
  it('every required pair reaches its ratio in both palettes, shared and extension-page', () => {
    const failures: string[] = [];
    for (const { scope, map } of PALETTE_MAPS) {
      for (const palette of ['dark', 'light'] as const) {
        for (const { foreground, background, min } of REQUIRED_PAIRS) {
          const ratio = contrastRatio(
            paletteValues(map, foreground)[palette],
            paletteValues(map, background)[palette]
          );
          if (ratio < min) {
            failures.push(
              `${scope} ${palette}: ${foreground} on ${background} = ${ratio.toFixed(2)} < ${String(min)}`
            );
          }
        }
      }
    }
    expect(failures).toEqual([]);
  });
});

describe('accent fill hover/press states', () => {
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

  /** One resolved palette the derivations run against. */
  type PaletteScope = (typeof PALETTE_MAPS)[number];

  /** Injected stylesheets render only inside shadow roots: the shared palette. */
  const SHADOW_SCOPES: readonly PaletteScope[] = PALETTE_MAPS.filter(
    ({ scope }) => scope === 'shared'
  );

  /** One derived fill: how it is computed from `accent-strong` in a palette. */
  interface DerivedFill {
    name: string;
    color: (map: PaletteMap, palette: 'dark' | 'light') => string;
    /** The palettes the fill renders in (primitives: both; injected sheets: shared). */
    scopes: readonly PaletteScope[];
    /** A press flash (`:active`): held only while the pointer is down, so it
     * is never what identifies the control — its text still must read. */
    momentary: boolean;
  }

  /** The injected stylesheets that paint the accent fill. */
  const SHEETS = [
    'entrypoints/exclusion-overlay.content/overlay.css',
    'entrypoints/isolated.content/side-by-side/side-by-side.css'
  ];

  /**
   * The one `color-mix()` form the derivation models — a per-channel sRGB mix
   * of the accent with one opaque token — matched on the call with its
   * whitespace collapsed (see {@link compact}), so formatting never matters.
   */
  const MIX = /^color-mix\(in srgb,var\(--accent-strong\)(\d+)%,var\(--([\w-]+)\)\)$/;

  /**
   * A CSS value with whitespace removed around `(`, `)` and `,` and collapsed
   * elsewhere — one spelling per value, however it is line-wrapped.
   *
   * @param value The CSS value.
   * @returns The compact form.
   */
  const compact = (value: string): string =>
    value
      .replace(/\s+/g, ' ')
      .replace(/\s*([(),])\s*/g, '$1')
      .trim();

  /**
   * The fill a modeled accent mix paints.
   *
   * @param percent The accent's share, 0–100.
   * @param other The token mixed in.
   * @returns The (palette map, palette) → `#rrggbb` resolver.
   */
  const mixFill =
    (percent: number, other: string) =>
    (map: PaletteMap, palette: 'dark' | 'light'): string => {
      const weight = percent / 100;
      const accent = channelsOf(paletteValues(map, 'accent-strong')[palette]);
      const mixed = channelsOf(paletteValues(map, other)[palette]);
      return toHex(
        accent.map((value, index) => value * weight + (mixed[index] ?? 0) * (1 - weight))
      );
    };

  /**
   * The fill `brightness()` paints over the accent (each sRGB channel scaled, clamped).
   *
   * @param factor The brightness factor (1 = unchanged).
   * @returns The (palette map, palette) → `#rrggbb` resolver.
   */
  const brightnessFill =
    (factor: number) =>
    (map: PaletteMap, palette: 'dark' | 'light'): string =>
      toHex(
        channelsOf(paletteValues(map, 'accent-strong')[palette]).map((value) => value * factor)
      );

  /**
   * Every `color-mix(…)` call in a stylesheet, parentheses balanced.
   *
   * @param source The stylesheet text.
   * @returns The calls, verbatim.
   */
  function colorMixCalls(source: string): string[] {
    const calls: string[] = [];
    for (let start = source.indexOf('color-mix('); start >= 0;) {
      let depth = 0;
      let end = start;
      for (; end < source.length; end += 1) {
        if (source[end] === '(') depth += 1;
        else if (source[end] === ')' && --depth === 0) break;
      }
      calls.push(source.slice(start, end + 1));
      start = source.indexOf('color-mix(', end);
    }
    return calls;
  }

  /** Accent mixes in a form the derivation cannot model — each must fail loudly. */
  const unmodeledMixes: string[] = [];

  // The injected stylesheets' hover fills mixed from the accent.
  const mixes: DerivedFill[] = SHEETS.flatMap((file) =>
    colorMixCalls(read(`../../${file}`))
      .filter((call) => call.includes('accent-strong'))
      .flatMap((call) => {
        const [, percent, other] = MIX.exec(compact(call)) ?? [];
        if (percent === undefined || other === undefined) {
          unmodeledMixes.push(`${file}: ${call}`);
          return [];
        }
        return [
          {
            name: `${file}: ${call}`,
            momentary: false,
            color: mixFill(Number(percent), other),
            scopes: SHADOW_SCOPES
          }
        ];
      })
  );

  /** A selector for a control in its accent ("on") state. */
  const ACCENT_SELECTOR =
    /\[aria-(pressed|checked|expanded|selected)='true'\]|:checked|\[data-variant='primary'\]/;

  /** Properties that change what a fill or its text looks like. */
  const FILL_PROPERTIES =
    /^(background(-color|-image)?|border(-(top|right|bottom|left))?-color|color|filter|opacity|mix-blend-mode|backdrop-filter)$/;

  /** Accent-state pointer declarations in the injected sheets that the derivation cannot model. */
  const unmodeledSheetRules: string[] = [];

  // Pointer (`:hover`/`:active`) rules on an accent-state control in the
  // injected sheets: the fill/border stays the accent or a modeled mix (gated
  // above), the text stays `on-accent`, a `filter` is a modeled
  // `brightness()` (gated below); any other fill-changing declaration fails.
  const sheetBrightened: DerivedFill[] = SHEETS.flatMap((file) =>
    parseRules(read(`../../${file}`))
      .filter(
        (rule) => /:(hover|active)\b/.test(rule.selector) && ACCENT_SELECTOR.test(rule.selector)
      )
      .flatMap((rule) =>
        rule.declarations.flatMap(([property, value]): DerivedFill[] => {
          if (!FILL_PROPERTIES.test(property)) return [];
          const name = `${file}: ${rule.selector} { ${property}: ${value} }`;
          const fill = compact(value);
          if (/^(background(-color)?|border(-(top|right|bottom|left))?-color)$/.test(property)) {
            if (fill !== 'var(--accent-strong)' && !MIX.test(fill)) unmodeledSheetRules.push(name);
            return [];
          }
          if (property === 'color') {
            if (fill !== 'var(--on-accent)') unmodeledSheetRules.push(name);
            return [];
          }
          const [, amount, unit] = /^brightness\((\d*\.?\d+)(%?)\)$/.exec(fill) ?? [];
          if (property !== 'filter' || amount === undefined) {
            unmodeledSheetRules.push(name);
            return [];
          }
          const factor = unit === '%' ? Number(amount) / 100 : Number(amount);
          return [
            {
              name,
              momentary: rule.selector.includes(':active'),
              color: brightnessFill(factor),
              scopes: SHADOW_SCOPES
            }
          ];
        })
      )
  );

  /** Accent-state pointer rules found per sheet (the scan must see the overlay's). */
  const accentPointerRules = SHEETS.map(
    (file) =>
      parseRules(read(`../../${file}`)).filter(
        (rule) => /:(hover|active)\b/.test(rule.selector) && ACCENT_SELECTOR.test(rule.selector)
      ).length
  );

  /** The `components/ui` primitives that paint the accent fill (found, never listed). */
  const primitiveDir = '../../components/ui';
  const accentPrimitives = readdirSync(join(HERE, primitiveDir))
    .filter((file) => file.endsWith('.tsx') && !file.includes('.test.'))
    .filter((file) => read(`${primitiveDir}/${file}`).includes('bg-accent-strong'));

  /** Variants that scope a utility to the accent ("on") state of its control. */
  const ACCENT_STATE =
    /^(data-checked|data-selected|data-pressed|aria-checked|aria-pressed|aria-selected|aria-expanded)$/;

  /** Fill-changing pointer-state utilities the primitives' classification left unmodeled. */
  const unmodeledUtilities: string[] = [];

  /** Hover backgrounds scoped to the accent state, i.e. drawn under or around the fill. */
  const accentStateHovers: { name: string; surface: string }[] = [];

  /** Unscoped pointer surface backgrounds found, `file: token` → occurrences. */
  const neutralPointerSurfaces: Record<string, number> = {};

  /**
   * The unscoped pointer surface backgrounds the accent primitives may carry,
   * each with its exact count and why it never lands under the accent fill.
   * A class string decides at runtime (variant, `checked()`), invisible to a
   * token scan, so any new one — e.g. a hover surface on the primary button
   * or the selected chip — fails here until it is reviewed and listed.
   */
  const NEUTRAL_POINTER_SURFACES: Record<string, { count: number; why: string }> = {
    'button.tsx: hover:bg-surface-3': {
      count: 2,
      why: 'the secondary and ghost variants; the primary lifts with brightness instead'
    },
    'choice-group.tsx: hover:bg-surface-3': {
      count: 1,
      why: 'unchecked tiles only; the checked (accent) tile takes no hover'
    },
    'switch.tsx: hover:bg-surface-3': {
      count: 1,
      why: 'the unchecked halo; checked, data-checked:hover:bg-surface-2 overrides it'
    }
  };

  // Every pointer-state (`hover`, `active`, `group-hover…`) utility that changes
  // a fill in those files: a `brightness-N` derives the accent (CSS
  // `brightness()` scales each sRGB channel, clamped); a surface background
  // scoped to an accent state is gated as drawn under the fill, an unscoped
  // one must be a reviewed entry of NEUTRAL_POINTER_SURFACES; anything else
  // is unmodeled and fails.
  const brightened: DerivedFill[] = accentPrimitives.flatMap((file) =>
    read(`${primitiveDir}/${file}`)
      .split(/[\s'"`]+/)
      .flatMap((token) => {
        const parts = token.split(':');
        const utility = parts.pop() ?? '';
        const variants = parts;
        const pointer = variants.some((variant) =>
          /^(hover|active|group-hover|peer-hover)\b/.test(variant)
        );
        if (
          !pointer ||
          !/^(bg-|brightness-|contrast-|saturate-|opacity-|invert|grayscale|sepia|hue-rotate-)/.test(
            utility
          )
        )
          return [];
        const name = `${file}: ${token}`;
        const percent = /^brightness-(\d+)$/.exec(utility)?.[1];
        if (percent !== undefined) {
          return [
            {
              name,
              momentary: variants.includes('active'),
              color: brightnessFill(Number(percent) / 100),
              // Primitives render on the extension pages and (some) in shadow roots.
              scopes: PALETTE_MAPS
            }
          ];
        }
        const surface = /^bg-(surface-\d)$/.exec(utility)?.[1];
        if (surface === undefined) unmodeledUtilities.push(name);
        else if (variants.some((variant) => ACCENT_STATE.test(variant)))
          accentStateHovers.push({ name, surface });
        else neutralPointerSurfaces[name] = (neutralPointerSurfaces[name] ?? 0) + 1;
        return [];
      })
  );

  it('finds the derived fills it gates, and models every accent-derived form it meets', () => {
    expect(mixes.length).toBeGreaterThanOrEqual(2);
    expect(brightened.length).toBeGreaterThanOrEqual(3);
    expect(accentPrimitives).toEqual(
      expect.arrayContaining(['button.tsx', 'filter-bar.tsx', 'choice-group.tsx'])
    );
    expect(unmodeledMixes, 'accent color-mix() forms the derivation cannot read').toEqual([]);
    expect(unmodeledUtilities, 'fill-changing pointer utilities with no model').toEqual([]);
    expect(
      accentPointerRules[0],
      'the overlay has accent-state hover rules'
    ).toBeGreaterThanOrEqual(2);
    expect(unmodeledSheetRules, 'accent-state pointer declarations with no model').toEqual([]);
  });

  it('allows an unscoped pointer surface in an accent primitive only where reviewed', () => {
    expect(neutralPointerSurfaces).toEqual(
      Object.fromEntries(
        Object.entries(NEUTRAL_POINTER_SURFACES).map(([name, { count }]) => [name, count])
      )
    );
  });

  it('draws a hover background under an accent fill only on a gated surface', () => {
    expect(accentStateHovers.length).toBeGreaterThan(0);
    const failures: string[] = [];
    for (const { name, surface } of accentStateHovers) {
      if (!FILL_SURFACES.includes(surface))
        failures.push(`${name}: ${surface} is not a fill surface`);
      // Primitives render on the extension pages and (some) in shadow roots.
      for (const { scope, map } of PALETTE_MAPS) {
        for (const palette of ['dark', 'light'] as const) {
          const edge = contrastRatio(
            paletteValues(map, 'accent-strong')[palette],
            paletteValues(map, surface)[palette]
          );
          if (edge < 3) failures.push(`${scope} ${palette}: ${name} = ${edge.toFixed(2)}`);
        }
      }
    }
    expect(failures).toEqual([]);
  });

  it('keeps on-accent text at 4.5:1 and a hover fill at 3:1 on its surfaces, both palettes', () => {
    const failures: string[] = [];
    for (const derived of [...mixes, ...brightened, ...sheetBrightened]) {
      for (const { scope, map } of derived.scopes) {
        for (const palette of ['dark', 'light'] as const) {
          const where = `${scope} ${palette}`;
          const fill = derived.color(map, palette);
          const text = contrastRatio(paletteValues(map, 'on-accent')[palette], fill);
          if (text < 4.5)
            failures.push(`${where}: on-accent on ${derived.name} = ${text.toFixed(2)}`);
          if (derived.momentary) continue;
          for (const surface of FILL_SURFACES) {
            const edge = contrastRatio(fill, paletteValues(map, surface)[palette]);
            if (edge < 3)
              failures.push(`${where}: ${derived.name} on ${surface} = ${edge.toFixed(2)}`);
          }
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
