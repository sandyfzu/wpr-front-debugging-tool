/**
 * The page title block — every panel page opens with it, and the shell's
 * focus management can move focus to the title on route switches: it is
 * focusable with `tabindex="-1"` (focusable programmatically, never a tab
 * stop). Pages render exactly one `h1`; this component is its declaring site.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { cn } from '../../utils/cn';

export type PageHeaderProps = {
  /** The page title (`h1`); the shell focuses it on route switches. */
  title: string;
  /** The one-line "what am I looking at" beneath the title. */
  subtitle?: string;
  /** The actions cluster (buttons, copy controls) aligned to the title row. */
  actions?: JSX.Element;
  /** Extra classes on the block, merged last so callers win. */
  class?: string;
};

/**
 * Render a page title block: `h1` + subtitle line with the actions right.
 *
 * The heading carries `tabindex="-1"` — focusable by the shell's route-switch
 * handler, skipped in the tab order. Its focus styling stays the browser's
 * own: the appearance of the ring when focus is programmatic is the shell's
 * (P5E focus management) concern, not a decision to hardcode here.
 *
 * @param props.title The page title, rendered as the page's single `h1`.
 * @param props.subtitle The intro line under the title (optional).
 * @param props.actions The actions cluster for the title row (optional).
 * @param props.class Extra classes on the block.
 */
export function PageHeader(props: PageHeaderProps): JSX.Element {
  return (
    <div
      data-fdt="page-header"
      class={cn('flex flex-wrap items-center gap-x-3 gap-y-1', props.class)}
    >
      <h1 data-fdt-page-title tabindex="-1" class="text-base font-semibold text-fg-primary">
        {props.title}
      </h1>
      <Show when={props.subtitle}>
        <span data-fdt-page-subtitle class="text-xs text-fg-secondary">
          {props.subtitle}
        </span>
      </Show>
      <div class="ms-auto flex items-center gap-1.5">{props.actions}</div>
    </div>
  );
}
