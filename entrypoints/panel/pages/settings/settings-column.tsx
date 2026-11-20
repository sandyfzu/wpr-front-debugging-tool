/**
 * A tool page's settings column: the "Settings" heading with the save state
 * beside it, then the settings by their load — a skeleton of the sections
 * while they load, the error state with Retry when the storage did not
 * answer (the tool's Run stays held), the form once ready. One declaring
 * site for every tool page's settings chrome.
 */
import type { JSX } from 'solid-js';
import { For, Match, Show, Switch } from 'solid-js';
import { ErrorState } from '../../../../components/ui/error-state';
import type { OverflowWatcher } from '../../../../components/ui/overflow-watch';
import { Skeleton } from '../../../../components/ui/skeleton';
import { pageHook, TOOL_AREAS, ToolColumn } from '../tool-column';
import type { ConfigSaveState } from './config-writer';
import { SaveLine } from './save-line';
import type { SettingsLoadState } from './stored-settings';

/** The heading's words. */
export const SETTINGS_TITLE = 'Settings';

/** The load failure's title. */
export const LOAD_FAILED_TITLE = "Couldn't load the test settings";

/** The load failure's words. */
export const LOAD_FAILED_COPY =
  "The extension's storage did not answer. Retry; if it persists, reload the DevTools panel.";

/** Props of {@link SettingsColumn}. */
export interface SettingsColumnProps {
  /** The page's hook prefix: the column is `<page>-settings`, the heading id `<page>-settings-title`, the skeleton `data-fdt-<page>-form-loading`. */
  page: string;
  load: SettingsLoadState['status'];
  save: ConfigSaveState;
  onRetry: () => void;
  /** How many section skeletons stand in for the form while it loads. */
  sections: number;
  /** Overflow seam (tests). */
  watchOverflow?: OverflowWatcher;
  /** The form (created only once the settings are ready). */
  children: JSX.Element;
}

/**
 * Render the column.
 *
 * @param props See {@link SettingsColumnProps}.
 */
export function SettingsColumn(props: SettingsColumnProps): JSX.Element {
  const titleId = (): string => `${props.page}-settings-title`;
  return (
    <ToolColumn
      hook={`${props.page}-settings`}
      area={TOOL_AREAS.settings}
      labelledBy={titleId()}
      watchOverflow={props.watchOverflow}
    >
      <div class="flex flex-wrap items-center gap-x-2 gap-y-1">
        <h2 id={titleId()} class="text-sm font-semibold text-fg-primary">
          {SETTINGS_TITLE}
        </h2>
        <Show when={props.load === 'ready'}>
          <div class="ms-auto min-w-0">
            <SaveLine state={props.save} />
          </div>
        </Show>
      </div>
      <Switch>
        <Match when={props.load === 'loading'}>
          <div class="grid grid-cols-1 gap-2" {...pageHook(props.page, 'form-loading')}>
            <For each={Array.from({ length: props.sections })}>
              {() => <Skeleton class="h-10 w-full rounded-md" />}
            </For>
          </div>
        </Match>
        <Match when={props.load === 'failed'}>
          <ErrorState
            title={LOAD_FAILED_TITLE}
            message={LOAD_FAILED_COPY}
            onRetry={() => {
              props.onRetry();
            }}
          />
        </Match>
        <Match when={props.load === 'ready'}>{props.children}</Match>
      </Switch>
    </ToolColumn>
  );
}
