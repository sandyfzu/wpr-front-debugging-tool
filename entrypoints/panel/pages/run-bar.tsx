/**
 * The run bar of a tool page's result side: the Run control with a short
 * note beside it on what a run does or sends (wrapping under the button
 * when the column is narrow). Run is held until the tool's settings are
 * ready and shows its busy state while a run is in the air (focus kept).
 */
import type { JSX } from 'solid-js';
import { Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';
import type { LucideIcon } from 'lucide-solid';
import Play from 'lucide-solid/icons/play';
import { Button } from '../../../components/ui/button';
import { Card } from '../../../components/ui/card';
import { pageHook } from './tool-column';

/** The Run control's words, at rest and while a run is in the air. */
export const RUN_LABELS = { idle: 'Run test', running: 'Running test…' } as const;

/** Props of {@link RunBar}. */
export interface RunBarProps {
  /** The page's hook prefix: bar `data-fdt="<page>-run"`, button `data-fdt-<page>-run`, note `data-fdt-<page>-disclosure`. */
  page: string;
  /** A run is in the air. */
  running: boolean;
  /** Run is held (the settings are not ready). */
  held: boolean;
  onRun: () => void;
  /** What a run does or sends. */
  note: string;
  /** The note's icon (muted, decorative). */
  noteIcon: LucideIcon;
}

/**
 * Render the bar.
 *
 * @param props See {@link RunBarProps}.
 */
export function RunBar(props: RunBarProps): JSX.Element {
  return (
    <Card>
      <div data-fdt={`${props.page}-run`} class="flex flex-wrap items-center gap-x-3.5 gap-y-2">
        <Button
          variant="primary"
          busy={props.running}
          disabled={props.held}
          {...pageHook(props.page, 'run')}
          onClick={() => {
            props.onRun();
          }}
        >
          <Show when={!props.running}>
            <Play size={12} aria-hidden="true" />
          </Show>
          {props.running ? RUN_LABELS.running : RUN_LABELS.idle}
        </Button>
        <p
          {...pageHook(props.page, 'disclosure')}
          class="flex min-w-0 flex-1 basis-60 items-start gap-1.5 text-2xs text-fg-secondary"
        >
          <Dynamic
            component={props.noteIcon}
            size={12}
            class="mt-px shrink-0 text-fg-muted"
            aria-hidden="true"
          />
          <span>{props.note}</span>
        </p>
      </div>
    </Card>
  );
}
