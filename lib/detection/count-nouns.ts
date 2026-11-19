/**
 * The nouns detection counts are phrased with, each in its two count forms
 * (`countNoun` / `countLabel` pick the form) — the one declaring site for
 * the HUD readings, the strip, the panel's page badges and its lists.
 */
import type { CountNoun } from '../../utils/format-count';

/** Response headers (the Headers & Cookies page's sections, its nav count). */
export const HEADER_NOUN: CountNoun = { one: 'header', other: 'headers' };

/** Scripts (Delay JS, Defer JS, the JavaScript page's rows). */
export const SCRIPT_NOUN: CountNoun = { one: 'script', other: 'scripts' };

/** Images (LazyLoad, Optimize Critical Images, the LazyLoad page's rows). */
export const IMAGE_NOUN: CountNoun = { one: 'image', other: 'images' };

/** Converted elements (Automatic Lazy Rendering). */
export const ELEMENT_NOUN: CountNoun = { one: 'element', other: 'elements' };

/** Preloaded fonts. */
export const FONT_NOUN: CountNoun = { one: 'font', other: 'fonts' };

/** Hinted domains (Preconnect to External Domains). */
export const DOMAIN_NOUN: CountNoun = { one: 'domain', other: 'domains' };

/** Resource hints (the Preloaded Resources page's rows and badge). */
export const HINT_NOUN: CountNoun = { one: 'hint', other: 'hints' };
