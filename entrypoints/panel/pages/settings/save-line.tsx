/**
 * The save state of a tool's settings form: where the form stands against
 * the store, always in view — a sentence in a form card's footer (`line`,
 * the default) or a short indicator beside the settings heading
 * (`indicator`). A refused or failed save shows its own message in either
 * look — never swallowed.
 */
import type { JSX } from 'solid-js';
import { Match, Show, Switch } from 'solid-js';
import Check from 'lucide-solid/icons/check';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import { cn } from '../../../../utils/cn';
import type { ConfigSaveState } from './config-writer';

/** The writer states that carry no message of their own. */
type QuietSaveStatus = 'saved' | 'pending' | 'saving';

/** The save line's words per state (failures carry their own message). */
export const SAVE_COPY: Readonly<Record<QuietSaveStatus, string>> = {
  saved: 'Settings saved for every site.',
  pending: 'Unsaved changes…',
  saving: 'Saving…'
};

/** The indicator's words: short beside a heading; the saved one keeps the full sentence as its title. */
export const SAVE_INDICATOR_COPY: Readonly<Record<QuietSaveStatus, string>> = {
  ...SAVE_COPY,
  saved: 'Saved'
};

/** How the save state reads. */
export type SaveLineLook = 'line' | 'indicator';

/** Props of {@link SaveLine}. */
export interface SaveLineProps {
  /** The writer's state. */
  state: ConfigSaveState;
  /** The look (default `line`). */
  look?: SaveLineLook;
}

/**
 * Render the save state (`data-fdt-save` carries the state for tests).
 *
 * @param props See {@link SaveLineProps}.
 */
export function SaveLine(props: SaveLineProps): JSX.Element {
  const indicator = (): boolean => props.look === 'indicator';
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
            class={cn(
              'text-2xs text-fg-muted',
              indicator() && 'inline-flex items-center gap-1 whitespace-nowrap'
            )}
            title={indicator() && status() === 'saved' ? SAVE_COPY.saved : undefined}
          >
            <Show when={indicator() && status() === 'saved'}>
              <Check size={12} class={STATUS_TEXT_CLASSES.ok} aria-hidden="true" />
            </Show>
            {(indicator() ? SAVE_INDICATOR_COPY : SAVE_COPY)[status()]}
          </p>
        )}
      </Match>
    </Switch>
  );
}
