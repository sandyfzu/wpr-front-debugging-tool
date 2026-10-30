/**
 * LazyLoad's hook texts and where they land on a served page. With LazyLoad
 * on, WordPress prints WP Rocket's no-JS style at the end of `wp_head` and
 * its options script + runtime tag at the end of `wp_footer`; a theme closes
 * `<head>`/`<body>` right after each hook, and WP Rocket's buffer later
 * writes its generator meta before the first `</head>` and its beacon block
 * before the last `</body>` — after the hook texts. So a text goes before
 * that block when the page ends the element with it, else right before the
 * end tag (end tags matched ASCII-caselessly). Pages with exactly one
 * `</head>` then one `</body>` follow that rule exactly; a page with several
 * takes the first `</head>` and the last `</body>` (named fallbacks: which
 * one the theme printed is the theme's); a page missing either, or with
 * every `</body>` before the first `</head>`, is refused by name. The texts
 * come from the data file per version (never rebuilt); the runtime tag's URL
 * is the page's assets URL (see `lazyload-assets-url`).
 */
import { asciiLowerCase } from '../exclusion-builder/literal-rows';
import { LAZYLOAD_JS_DIR } from './simulation-data';
import type {
  LAZYLOAD_FOOTER_PLACEMENTS,
  LAZYLOAD_HEAD_PLACEMENTS,
  LazyloadPlacementFallback,
  LazyloadPlacementRefusal
} from './spec';

/** LazyLoad's two hook texts for one page. */
export interface LazyloadHookTexts {
  /** What `wp_head` prints: the no-JS style. */
  readonly head: string;
  /** What `wp_footer` prints: the options script, then the runtime tag. */
  readonly footer: string;
  /**
   * The runtime tag's URL (assets URL + `js/` + the runtime's path): with a
   * normalized assets URL, exactly the URL the browser requests — match it
   * exactly, never by a folder-name pattern (the plugin folder may be renamed).
   */
  readonly runtimeUrl: string;
}

/** One version's printed texts, as the data file holds them (the runtime tag split at its URL). */
export interface LazyloadTextParts {
  /** The no-JS style `wp_head` prints. */
  readonly noJsStyle: string;
  /** The inline options script `wp_footer` prints first. */
  readonly optionsScript: string;
  /** The runtime tag before its URL. */
  readonly runtimeTagBeforeUrl: string;
  /** The runtime tag after its URL. */
  readonly runtimeTagAfterUrl: string;
  /** The runtime's path under the assets URL's `js/` folder. */
  readonly runtimeJsPath: string;
}

/**
 * LazyLoad's hook texts from a version's parts and an assets URL.
 *
 * @param parts The version's texts.
 * @param assetsUrl WP Rocket's assets URL (absolute, ending in `/`).
 */
export function composeLazyloadHookTexts(
  parts: LazyloadTextParts,
  assetsUrl: string
): LazyloadHookTexts {
  const runtimeUrl = `${assetsUrl}${LAZYLOAD_JS_DIR}${parts.runtimeJsPath}`;
  return {
    head: parts.noJsStyle,
    footer: parts.optionsScript + parts.runtimeTagBeforeUrl + runtimeUrl + parts.runtimeTagAfterUrl,
    runtimeUrl
  };
}

/** Where the texts went. */
export interface LazyloadPlacement {
  readonly head: (typeof LAZYLOAD_HEAD_PLACEMENTS)[number];
  readonly footer: (typeof LAZYLOAD_FOOTER_PLACEMENTS)[number];
  /** Empty on pages with one end tag of each. */
  readonly fallbacks: readonly LazyloadPlacementFallback[];
}

/** The page with its texts placed, or the reason it was not. */
export type LazyloadPlaced =
  | { readonly ok: true; readonly html: string; readonly placement: LazyloadPlacement }
  | { readonly ok: false; readonly refused: LazyloadPlacementRefusal };

/** WP Rocket's generator meta, split around its two values (each holds no `"`). */
const GENERATOR_META = {
  start: '<meta name="generator" content="',
  /** The content value's required start. */
  content: 'WP Rocket',
  between: '" data-wpr-features="',
  end: '" />'
} as const;

/** WP Rocket's beacon block: data script, then the beacon tag around its URL (holds no `'`). */
const BEACON_BLOCK = {
  start: '<script>var rocket_beacon_data = ',
  /** Ends the data script (its JSON escapes `/`, so it never holds this) and opens the tag. */
  tag: `</script><script data-name="wpr-wpr-beacon" src='`,
  end: `' async></script>`
} as const;

/** The data script's end tag (the block's data holds none). */
const SCRIPT_END = '</script>';

/**
 * Place LazyLoad's hook texts on a served page (see the module doc).
 *
 * @param html The served page (decoded).
 * @param texts The texts.
 */
export function placeLazyloadHookTexts(
  html: string,
  texts: Pick<LazyloadHookTexts, 'head' | 'footer'>
): LazyloadPlaced {
  const ends = elementEnds(html);
  if (!('head' in ends)) return { ok: false, refused: ends.refused };
  const meta = generatorMetaBefore(html, ends.head);
  const headAt = meta ?? ends.head;
  const beacon = beaconBlockBefore(html, ends.body);
  // A block starting before the head text would need `</head>` inside its data: not WP Rocket's.
  const bodyAt = beacon !== null && beacon.start >= headAt ? beacon.start : ends.body;
  return {
    ok: true,
    html:
      html.slice(0, headAt) +
      texts.head +
      html.slice(headAt, bodyAt) +
      texts.footer +
      html.slice(bodyAt),
    placement: {
      head: meta === null ? 'before-end-tag' : 'before-generator-meta',
      footer: bodyAt === ends.body ? 'before-end-tag' : 'before-beacon-block',
      fallbacks: ends.fallbacks
    }
  };
}

/** The chosen `</head>` and `</body>` offsets, or why there are none. */
export type ElementEnds =
  | {
      readonly head: number;
      readonly body: number;
      readonly fallbacks: readonly LazyloadPlacementFallback[];
    }
  | { readonly refused: LazyloadPlacementRefusal };

/**
 * The first `</head>` and the last `</body>` (ASCII-caseless).
 *
 * @param html The page.
 */
export function elementEnds(html: string): ElementEnds {
  const lower = asciiLowerCase(html);
  const head = lower.indexOf('</head>');
  if (head < 0) return { refused: 'no-head-end' };
  const body = lower.lastIndexOf('</body>');
  if (body < 0) return { refused: 'no-body-end' };
  if (body < head) return { refused: 'body-end-before-head-end' };
  const fallbacks: LazyloadPlacementFallback[] = [];
  if (lower.indexOf('</head>', head + 1) >= 0) fallbacks.push('first-of-several-head-ends');
  if (lower.lastIndexOf('</body>', body - 1) >= 0) fallbacks.push('last-of-several-body-ends');
  return { head, body, fallbacks };
}

/**
 * Where WP Rocket's generator meta starts when it ends `html.slice(0, end)`
 * — `<meta name="generator" content="WP Rocket[^"]*" data-wpr-features="[^"]*" />`
 * (case-sensitive, as the buffer writes it) — else `null`. Neither value
 * holds `"`, so the match is read backwards from `end` (linear).
 *
 * @param html The page.
 * @param end The `</head>` offset.
 */
export function generatorMetaBefore(html: string, end: number): number | null {
  const featuresEnd = end - GENERATOR_META.end.length;
  if (featuresEnd < 0 || !html.startsWith(GENERATOR_META.end, featuresEnd)) return null;
  const betweenAt = html.lastIndexOf('"', featuresEnd - 1) + 1 - GENERATOR_META.between.length;
  if (betweenAt < 0 || !html.startsWith(GENERATOR_META.between, betweenAt)) return null;
  const contentAt = html.lastIndexOf('"', betweenAt - 1) + 1;
  const startAt = contentAt - GENERATOR_META.start.length;
  if (
    contentAt === 0 ||
    startAt < 0 ||
    !html.startsWith(GENERATOR_META.start, startAt) ||
    !html.startsWith(GENERATOR_META.content, contentAt) ||
    contentAt + GENERATOR_META.content.length > betweenAt
  ) {
    return null;
  }
  return startAt;
}

/** WP Rocket's beacon block on a page. */
export interface BeaconBlock {
  /** Where the block (its data script) starts. */
  readonly start: number;
  /** The beacon tag's raw `src` text (between its `'`s, undecoded). */
  readonly src: string;
}

/**
 * WP Rocket's beacon block when it ends `html.slice(0, end)` —
 * `<script>var rocket_beacon_data = ` + data holding no `</script>` +
 * `</script><script data-name="wpr-wpr-beacon" src='[^']*' async></script>`,
 * the leftmost such start — else `null`. Read backwards from `end` (linear).
 *
 * @param html The page.
 * @param end The `</body>` offset.
 */
export function beaconBlockBefore(html: string, end: number): BeaconBlock | null {
  const urlEnd = end - BEACON_BLOCK.end.length;
  if (urlEnd < 0 || !html.startsWith(BEACON_BLOCK.end, urlEnd)) return null;
  const urlAt = html.lastIndexOf("'", urlEnd - 1) + 1;
  const tagAt = urlAt - BEACON_BLOCK.tag.length;
  if (tagAt < 0 || !html.startsWith(BEACON_BLOCK.tag, tagAt)) return null;
  // The data runs from after the block's start to `tagAt` with no `</script>`:
  // the start is the first one after the last `</script>` before `tagAt`.
  const from = tagAt === 0 ? -1 : html.lastIndexOf(SCRIPT_END, tagAt - 1);
  const startAt = html.indexOf(BEACON_BLOCK.start, from + 1);
  return startAt >= 0 && startAt + BEACON_BLOCK.start.length <= tagAt
    ? { start: startAt, src: html.slice(urlAt, urlEnd) }
    : null;
}

/**
 * The beacon block abutting the page's last `</body>` (ASCII-caseless: the
 * end placement uses), else `null` — the one block that is WP Rocket's
 * (lookalikes elsewhere, e.g. in comments, are not).
 *
 * @param html The page.
 */
export function pageBeaconBlock(html: string): BeaconBlock | null {
  const end = asciiLowerCase(html).lastIndexOf('</body>');
  return end < 0 ? null : beaconBlockBefore(html, end);
}
