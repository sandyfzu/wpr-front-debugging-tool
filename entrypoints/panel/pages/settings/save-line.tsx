/**
 * The save line of a tool's settings form: where the form stands against
 * the store, always in view (a tool form's card footer). A refused or
 * failed save shows its own message — never swallowed.
 */
import type { JSX } from 'solid-js';
import { Match, Switch } from 'solid-js';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import type { ConfigSaveState } from './config-writer';

/** The save line's words per state (failures carry their own message). */
export const SAVE_COPY: Readonly<Record<'saved' | 'pending' | 'saving', string>> = {
  saved: 'Settings saved for every site.',
  pending: 'Unsaved changes…',
  saving: 'Saving…'
};

/**
 * Render the save line (`data-fdt-save` carries the state for tests).
 *
 * @param props.state The writer's state.
 */
export function SaveLine(props: { state: ConfigSaveState }): JSX.Element {
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
          <p data-fdt-save={status()} class="text-2xs text-fg-muted">
            {SAVE_COPY[status()]}
          </p>
        )}
      </Match>
    </Switch>
  );
}
