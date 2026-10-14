/**
 * WCAG 2.x contrast math over hex sRGB colors — the one declaring site for
 * every contrast gate (design tokens, code-highlight themes).
 */

/** `#rrggbb` or `#rrggbbaa`, case-insensitive. */
const HEX_COLOR = /^#([0-9a-f]{6})([0-9a-f]{2})?$/i;

/** One opaque sRGB color as 0–255 channels. */
type Rgb = readonly [number, number, number];

/**
 * Parse `#rrggbb` / `#rrggbbaa`.
 *
 * @param hex The color.
 * @returns The channels and the alpha (0–1; 1 when absent).
 * @throws {@link Error} naming the input when it is not one of those forms.
 */
function parseHex(hex: string): { rgb: Rgb; alpha: number } {
  const match = HEX_COLOR.exec(hex);
  const digits = match?.[1];
  if (match === null || digits === undefined) {
    throw new Error(`contrast: "${hex}" is not a #rrggbb or #rrggbbaa color.`);
  }
  const channel = (offset: number): number => Number.parseInt(digits.slice(offset, offset + 2), 16);
  const alpha = match[2] === undefined ? 1 : Number.parseInt(match[2], 16) / 255;
  return { rgb: [channel(0), channel(2), channel(4)], alpha };
}

/**
 * Composite a possibly translucent color over an opaque background (source-over).
 *
 * @param foreground `#rrggbb` or `#rrggbbaa`.
 * @param background Opaque `#rrggbb`.
 * @returns The color as rendered over the background.
 * @throws {@link Error} for a malformed color or a translucent background.
 */
function composite(foreground: string, background: string): Rgb {
  const top = parseHex(foreground);
  const bottom = parseHex(background);
  if (bottom.alpha !== 1) {
    throw new Error(`contrast: background "${background}" must be opaque.`);
  }
  const mix = (index: 0 | 1 | 2): number =>
    top.rgb[index] * top.alpha + bottom.rgb[index] * (1 - top.alpha);
  return [mix(0), mix(1), mix(2)];
}

/**
 * Relative luminance per WCAG 2.x (definition of "relative luminance").
 *
 * @param rgb sRGB channels, 0–255.
 * @returns Luminance in 0–1.
 */
function luminance(rgb: Rgb): number {
  const linear = (channel: number): number => {
    const value = channel / 255;
    return value <= 0.04045 ? value / 12.92 : ((value + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * linear(rgb[0]) + 0.7152 * linear(rgb[1]) + 0.0722 * linear(rgb[2]);
}

/**
 * The WCAG contrast ratio of a text color over a background.
 *
 * A translucent foreground (`#rrggbbaa`) is first composited over the
 * background, as the browser renders it.
 *
 * @param foreground `#rrggbb` or `#rrggbbaa`.
 * @param background Opaque `#rrggbb`.
 * @returns The ratio, 1–21.
 * @throws {@link Error} for a malformed color or a translucent background.
 */
export function contrastRatio(foreground: string, background: string): number {
  const first = luminance(composite(foreground, background));
  const second = luminance(parseHex(background).rgb);
  const [lighter, darker] = first >= second ? [first, second] : [second, first];
  return (lighter + 0.05) / (darker + 0.05);
}
