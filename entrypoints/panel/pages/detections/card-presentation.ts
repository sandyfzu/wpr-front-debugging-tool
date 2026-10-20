/**
 * The Detections page's presentation rules, kept pure so every one is
 * unit-testable without rendering: the card → owning-page link table, the
 * verdict → vocabulary mapping and the relative cache-age line.
 */
import type { StatusKind as Tone } from '../../../../components/ui/status-badge';
import type { StatusItemId, StatusKind } from '../../../../lib/panel/detections-view-model';
import { relativeAge } from '../../../../utils/relative-age';
import type { RouteId } from '../../routes';

/**
 * Cards whose feature owns a panel page: the card becomes a whole-card link
 * there. A table, not branches — a future page that explains a detection
 * adds one row here and its card turns into a link with no other edit.
 */
export const CARD_PAGE_LINKS: ReadonlyMap<StatusItemId, RouteId> = new Map<StatusItemId, RouteId>([
  ['delay_js', 'javascript'],
  ['defer_all_js', 'javascript'],
  ['lazyload', 'lazyload']
]);

/**
 * The vocabulary tone of a verdict. An optional feature being off is not a
 * failure, so "not active" is `neutral` — never the error red.
 */
export const STATUS_TONES: Readonly<Record<StatusKind, Tone>> = {
  active: 'ok',
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
