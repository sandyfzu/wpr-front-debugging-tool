/**
 * One settings section of a tool page: a card whose heading (`h3`, under
 * the page's "Settings" `h2`) is the disclosure button — chevron, title and,
 * on the right, a summary of what the section holds plus its problem in the
 * error tone — so a folded section never hides a problem. The fields show
 * while it is open.
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import { Card } from '../../../../components/ui/card';
import { FOCUS_RING, MOTION_REVEAL, MOTION_TURN } from '../../../../components/ui/classes';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import type { SectionSummary } from '../../../../lib/panel/section-summary';
import { cn } from '../../../../utils/cn';
import { pageHook } from '../tool-column';

/**
 * The element id of a section's body (the disclosure button controls it).
 *
 * @param page The page's hook prefix.
 * @param section The section's id.
 */
export function sectionBodyId(page: string, section: string): string {
  return `${page}-section-${section}`;
}

/** Props of {@link DisclosureSection}. */
export interface DisclosureSectionProps {
  /** The page's hook prefix (`data-fdt-<page>-section…`, body id `<page>-section-<id>`). */
  page: string;
  /** The section's id. */
  section: string;
  title: string;
  summary: SectionSummary;
  open: boolean;
  onOpenChange: (open: boolean) => void;
  children: JSX.Element;
}

/**
 * Render the section.
 *
 * @param props See {@link DisclosureSectionProps}.
 */
export function DisclosureSection(props: DisclosureSectionProps): JSX.Element {
  const bodyId = (): string => sectionBodyId(props.page, props.section);
  return (
    <Card level={1}>
      <section
        {...pageHook(props.page, 'section', props.section)}
        class="flex min-w-0 flex-col gap-3"
      >
        <h3 class="-m-1">
          <button
            type="button"
            aria-expanded={props.open}
            aria-controls={bodyId()}
            {...pageHook(props.page, 'section-toggle')}
            class={cn(
              'flex min-h-8 w-full cursor-pointer items-center gap-2 rounded-md px-1.5 py-1 text-start hover:bg-surface-3',
              FOCUS_RING
            )}
            onClick={() => {
              props.onOpenChange(!props.open);
            }}
          >
            <ChevronRight
              size={14}
              aria-hidden="true"
              class={cn('shrink-0 text-fg-muted', MOTION_TURN, props.open && 'rotate-90')}
            />
            <span class="shrink-0 text-xs font-semibold text-fg-primary">{props.title}</span>
            <span class="ms-auto flex min-w-0 flex-wrap justify-end gap-x-1.5 text-end text-2xs font-normal text-fg-muted">
              <span {...pageHook(props.page, 'section-summary')} class="min-w-0 break-words">
                {props.summary.text}
              </span>
              <Show when={props.summary.problem}>
                {(problem) => (
                  <span
                    {...pageHook(props.page, 'section-problem')}
                    class={STATUS_TEXT_CLASSES.error}
                  >
                    {problem()}
                  </span>
                )}
              </Show>
            </span>
          </button>
        </h3>
        <Show when={props.open}>
          <div id={bodyId()} class={cn('flex min-w-0 flex-col gap-3', MOTION_REVEAL)}>
            {props.children}
          </div>
        </Show>
      </section>
    </Card>
  );
}
