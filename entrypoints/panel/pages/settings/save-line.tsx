/**
 * The save state of a tool's settings form: a short indicator beside the
 * settings heading, always in view. A refused or failed save shows its own
 * message — never swallowed.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import type { ConfigSaveState } from './config-writer';

/** The writer states that carry no message of their own. */
type QuietSaveStatus = 'saved' | 'pending' | 'saving';

/** The indicator's words per state (failures carry their own message): short beside a heading. */
export const SAVE_COPY: Readonly<Record<QuietSaveStatus, string>> = {
  saved: 'Saved',
  pending: 'Unsaved changes…',
  saving: 'Saving…'
};

/** The saved indicator's title: the full sentence its one word stands for. */
export const SAVED_TITLE = 'Settings saved for every site.';

/** Props of {@link SaveLine}. */
export interface SaveLineProps {
  /** The writer's state. */
  state: ConfigSaveState;
}

/**
 * Render the save state (`data-fdt-save` carries the state for tests).
 *
 * @param props See {@link SaveLineProps}.
 */
export function SaveLine(props: SaveLineProps): JSX.Element {
  return (
    <Switch>
      <Match
        when={
          props.state.status === 'refused' || props.state.status === 'failed'
            ? props.state
            : undefined
        }
      >
        {(failure) => (
          <p data-fdt-save="failed" class={cn('text-2xs', STATUS_TEXT_CLASSES.error)}>
            {failure().message}
          </p>
        )}
      </Match>
      <Match
        when={
          props.state.status === 'saved' ||
          props.state.status === 'pending' ||
          props.state.status === 'saving'
            ? props.state.status
            : undefined
        }
      >
        {(status) => (
          <p
            data-fdt-save={status()}
            class="inline-flex items-center gap-1 text-2xs whitespace-nowrap text-fg-muted"
            title={status() === 'saved' ? SAVED_TITLE : undefined}
          >
            <Show when={status() === 'saved'}>
              <Check size={12} class={STATUS_TEXT_CLASSES.ok} aria-hidden="true" />
            </Show>
            {SAVE_COPY[status()]}
          </p>
        )}
      </Match>
    </Switch>
  );
}
