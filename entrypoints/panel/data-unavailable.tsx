/**
 * The panel's "feature absent" view: this DevTools panel cannot message the
 * page at all (Firefox gives DevTools pages no `tabs` API), so no page data
 * can load here. A title, the one sentence naming what still works, and no
 * retry — nothing the panel could retry would change the answer.
 */
import type { JSX } from 'solid-js';
import Info from 'lucide-solid/icons/info';
import { PageHeader } from '../../components/ui/page-header';

/** The view's title (declared once; the panel's status line says the same). */
export const DATA_UNAVAILABLE_TITLE = 'Page data isn’t available in this panel';

/** Props of {@link DataUnavailable}. */
export interface DataUnavailableProps {
  /** The sentence naming why, and what still works. */
  readonly reason: string;
}

/**
 * The view (owns the page's h1, as the error view does when it replaces a page).
 *
 * @param props See {@link DataUnavailableProps}.
 */
export function DataUnavailable(props: DataUnavailableProps): JSX.Element {
  return (
    <div
      data-fdt="data-unavailable"
      role="status"
      class="flex flex-col items-center gap-1.5 py-6 text-center"
    >
      <Info size={16} class="shrink-0 text-fg-muted" aria-hidden="true" />
      <PageHeader title={DATA_UNAVAILABLE_TITLE} />
      <p class="max-w-72 text-2xs leading-snug text-fg-secondary">{props.reason}</p>
    </div>
  );
}
