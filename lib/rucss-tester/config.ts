/**
 * The RUCSS tester's configuration: what the user typed, kept as typed (raw
 * field text, so a restored form looks exactly as it was left), plus the
 * two request flags. Interpretation (line splitting, pattern compiling)
 * happens per run in `./run-plan`.
 *
 * Every field is bounded so a stored or forged value can never grow without
 * limit. Two readers: {@link parseRucssTesterConfig} (tolerant — storage
 * reads: a junk field falls back to its default, unknown keys are dropped)
 * and {@link findRucssTesterConfigProblem} (strict — writers: names the
 * first offending field).
 */
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';

/** One ordered search/replace pair applied to the returned CSS. */
export interface RucssReplacement {
  /** Pattern source (no flags; applied globally). An empty one marks an unfinished row and is skipped. */
  readonly search: string;
  /** Replacement text (`$&`, `$1`… substitutions apply). Empty deletes the matches. */
  readonly replacement: string;
}

/** The whole tester configuration (one, shared by every site). */
export interface RucssTesterConfig {
  /** Safelist patterns sent to the service, one per line. */
  readonly safelist: string;
  /** Inline-style markers to keep (substring of the `style` markup), one per line; added to the defaults. */
  readonly inlinePreserve: string;
  /** Stylesheet URL patterns (raw regex) to keep, one per line. */
  readonly excludeFiles: string;
  /** CSS placed before the returned CSS. */
  readonly prepend: string;
  /** CSS placed after the returned CSS. */
  readonly append: string;
  /** Search/replace pairs, applied in order. */
  readonly replacements: readonly RucssReplacement[];
  /** Ask the service for the mobile variant. */
  readonly mobile: boolean;
  /** Ask the service to treat the page as the home page. */
  readonly home: boolean;
}

/**
 * Per-field size caps (UTF-16 units / entries), generous for hand-typed
 * config. Together they still allow ~1 M characters, which JSON can grow up
 * to 6× (control characters escape as `\uXXXX`), so the writer also holds the
 * whole item to {@link RUCSS_CONFIG_BYTE_BUDGET}.
 */
export const RUCSS_CONFIG_LIMITS = {
  /** Each one-per-line list field. */
  listChars: 32_768,
  /** Each of the prepend/append CSS fields. */
  cssChars: 131_072,
  /** Replacement pairs kept. */
  replacements: 50,
  /** A pair's search pattern. */
  searchChars: 4_096,
  /** A pair's replacement text. */
  replacementChars: 8_192
} as const;

/**
 * The stored item's budget: UTF-8 bytes of its JSON. The `local` area holds
 * 10 MiB of JSON for every item together (no unlimited-storage permission),
 * shared with the 4 MiB saved exclusion sets and the Known Conflicts cache;
 * 1 MiB keeps this item a small tenant while fitting every field at its cap
 * in plain ASCII — real configurations are a few KiB.
 */
export const RUCSS_CONFIG_BYTE_BUDGET = 1024 * 1024;

/** Measures the stored JSON's UTF-8 size. */
const encoder = new TextEncoder();

/** The configuration a fresh install (or an unreadable store) starts from. */
export const DEFAULT_RUCSS_TESTER_CONFIG: RucssTesterConfig = Object.freeze({
  safelist: '',
  inlinePreserve: '',
  excludeFiles: '',
  prepend: '',
  append: '',
  replacements: Object.freeze([]),
  mobile: false,
  home: false
});

/** The text fields and their caps — the one table both readers walk. */
const TEXT_FIELDS = {
  safelist: RUCSS_CONFIG_LIMITS.listChars,
  inlinePreserve: RUCSS_CONFIG_LIMITS.listChars,
  excludeFiles: RUCSS_CONFIG_LIMITS.listChars,
  prepend: RUCSS_CONFIG_LIMITS.cssChars,
  append: RUCSS_CONFIG_LIMITS.cssChars
} as const satisfies Partial<Record<keyof RucssTesterConfig, number>>;

/** The text field names. */
type TextField = keyof typeof TEXT_FIELDS;

/** The boolean flag field names. */
const FLAG_FIELDS = ['mobile', 'home'] as const satisfies readonly (keyof RucssTesterConfig)[];

/** Every key a configuration may hold. */
const CONFIG_KEYS: readonly string[] = [
  ...Object.keys(TEXT_FIELDS),
  ...FLAG_FIELDS,
  'replacements'
];

/** Every key a replacement pair may hold. */
const PAIR_KEYS: readonly string[] = ['search', 'replacement'];

/** Whether a value is a string within `max` UTF-16 units. */
function isBoundedString(value: unknown, max: number): value is string {
  return typeof value === 'string' && value.length <= max;
}

/**
 * One value as a replacement pair (own `search`/`replacement` strings within
 * their caps; extra keys ignored).
 *
 * @param value Any value.
 * @returns A fresh pair, or null when the value is not one.
 */
function parsePair(value: unknown): RucssReplacement | null {
  if (!isRecord(value)) return null;
  const search = ownValue(value, 'search');
  const replacement = ownValue(value, 'replacement');
  return isBoundedString(search, RUCSS_CONFIG_LIMITS.searchChars) &&
    isBoundedString(replacement, RUCSS_CONFIG_LIMITS.replacementChars)
    ? { search, replacement }
    : null;
}

/**
 * Read any (possibly corrupt, foreign or newer) stored value as a
 * configuration. Each field is judged alone: a junk field reads as its
 * default while the valid ones survive; invalid pairs are dropped and at
 * most {@link RUCSS_CONFIG_LIMITS}`.replacements` kept (first ones);
 * inherited and unknown keys are never read.
 *
 * @param input Any storage-delivered value.
 * @returns A fresh, fully valid configuration.
 */
export function parseRucssTesterConfig(input: unknown): RucssTesterConfig {
  if (!isRecord(input)) return DEFAULT_RUCSS_TESTER_CONFIG;
  const text = {} as Record<TextField, string>;
  for (const [field, max] of Object.entries(TEXT_FIELDS) as [TextField, number][]) {
    const value = ownValue(input, field);
    text[field] = isBoundedString(value, max) ? value : DEFAULT_RUCSS_TESTER_CONFIG[field];
  }
  const rawPairs = ownValue(input, 'replacements');
  const replacements = Array.isArray(rawPairs)
    ? rawPairs
        .map(parsePair)
        .filter((pair): pair is RucssReplacement => pair !== null)
        .slice(0, RUCSS_CONFIG_LIMITS.replacements)
    : [];
  const mobile = ownValue(input, 'mobile');
  const home = ownValue(input, 'home');
  return {
    ...text,
    replacements,
    mobile: typeof mobile === 'boolean' ? mobile : DEFAULT_RUCSS_TESTER_CONFIG.mobile,
    home: typeof home === 'boolean' ? home : DEFAULT_RUCSS_TESTER_CONFIG.home
  };
}

/**
 * Check a value against the exact configuration shape and the
 * {@link RUCSS_CONFIG_BYTE_BUDGET} (the writer's gate: a value that fails
 * here is never stored).
 *
 * @param input The candidate configuration.
 * @returns Null when valid, else a short description naming the offending field.
 */
export function findRucssTesterConfigProblem(input: unknown): string | null {
  if (!isRecord(input)) return 'the configuration is not an object';
  if (!hasOnlyKeys(input, CONFIG_KEYS)) {
    const unknown = Object.keys(input).filter((key) => !CONFIG_KEYS.includes(key));
    return `unknown field(s): ${unknown.join(', ')}`;
  }
  for (const [field, max] of Object.entries(TEXT_FIELDS)) {
    if (!isBoundedString(ownValue(input, field), max)) {
      return `${field} must be a string of at most ${String(max)} characters`;
    }
  }
  for (const field of FLAG_FIELDS) {
    if (typeof ownValue(input, field) !== 'boolean') return `${field} must be a boolean`;
  }
  const pairs = ownValue(input, 'replacements');
  if (!Array.isArray(pairs) || pairs.length > RUCSS_CONFIG_LIMITS.replacements) {
    return `replacements must be an array of at most ${String(RUCSS_CONFIG_LIMITS.replacements)} pairs`;
  }
  const badPair = pairs.findIndex(
    (pair) => parsePair(pair) === null || !hasOnlyKeys(pair as Record<string, unknown>, PAIR_KEYS)
  );
  if (badPair !== -1) {
    return `replacements[${String(badPair)}] must be { search, replacement } strings within their caps`;
  }
  // Shape checked: the input holds only known fields, so its JSON is what would be stored.
  const bytes = encoder.encode(JSON.stringify(input)).length;
  return bytes > RUCSS_CONFIG_BYTE_BUDGET
    ? `the configuration takes ${String(bytes)} bytes as stored JSON, over the ${String(RUCSS_CONFIG_BYTE_BUDGET)}-byte budget`
    : null;
}
