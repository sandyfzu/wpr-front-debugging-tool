/**
 * The Detections page's presentation rules, kept pure so every one is
 * unit-testable without rendering: the row → owning-page link table, the
 * verdict → vocabulary mapping (tone + state word) and the relative cache-age line.
 */
import type { StatusKind as Tone } from '../../../../components/ui/status-badge';
import { detectionFilterLabel } from '../../../../lib/panel/detections-filter';
import { STATUS_LABELS } from '../../../../lib/panel/detections-summary';
import type { StatusItemId, StatusKind } from '../../../../lib/panel/detections-view-model';
import { relativeAge } from '../../../../utils/relative-age';
import type { RouteId } from '../../routes';

/**
 * Rows whose feature owns a panel page: the row carries a link there. A
 * table, not branches — a future page that explains a detection adds one
 * row here and its entry gains the link with no other edit.
 */
export const CARD_PAGE_LINKS: ReadonlyMap<StatusItemId, RouteId> = new Map<StatusItemId, RouteId>([
  ['delay_js', 'javascript'],
  ['defer_all_js', 'javascript'],
  ['lazyload', 'lazyload']
]);

/**
 * The vocabulary tone of a verdict. An optional feature being off is not a
 * failure, so "not active" is `neutral` — never the error red; the two
 * unsure verdicts are the amber `warn` pair (present but unproven).
 */
export const STATUS_TONES: Readonly<Record<StatusKind, Tone>> = {
  active: 'ok',
  collecting: 'warn',
  unknown: 'warn',
  'not-active': 'neutral'
};

/**
 * The Cached card's relative line, aged against the page's clock.
 *
 * @param seconds The cache stamp in epoch seconds (representable by contract).
 * @param nowMs The clock reading (epoch ms).
 * @returns e.g. "Generated 3 h ago" (a future stamp reads "just now").
 */
export function cacheAgeText(seconds: number, nowMs: number): string {
  return `Generated ${relativeAge(nowMs - seconds * 1000)}`;
}

/**
 * The state word each verdict shows on a row: the summary's words, except a
 * feature that is not active reads the quiet "Off" — the Off segment's own
 * word, the bucket most of its rows fall under. The word names the served
 * verdict, not the bucket: a row the Exclusion Builder turned off in this
 * tab still reads "Active" (its modifier line says the rest) and an unknown
 * row "Unknown", both counted under Off. The support report keeps
 * {@link STATUS_LABELS}.
 */
export const ENTRY_STATE_LABELS: Readonly<Record<StatusKind, string>> = {
  ...STATUS_LABELS,
  'not-active': detectionFilterLabel('off')
};
