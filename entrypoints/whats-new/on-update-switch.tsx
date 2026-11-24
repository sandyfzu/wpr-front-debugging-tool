/**
 * The page footer's "Show what's new after updates" switch over its instant
 * setting (`lib/options/instant-setting`): loading (a skeleton the switch's
 * shape), failed / retrying (the reason + Retry), ready (the switch; a
 * failed write says so beside it and shows the confirmed value again). The
 * options row writes the same synced item, so both follow each other live.
 */
import type { JSX } from 'solid-js';
import { createSignal, Match, onCleanup, Show, Switch as Branch } from 'solid-js';
import { Button } from '../../components/ui/button';
import { Skeleton } from '../../components/ui/skeleton';
import { Switch } from '../../components/ui/switch';
import {
  createInstantSettingModel,
  type InstantSettingIO,
  type InstantSettingSnapshot
} from '../../lib/options/instant-setting';
import { WHATS_NEW_ON_UPDATE_LABEL } from '../../lib/release-notes/words';

/** The switch's words. */
export const ON_UPDATE_WORDS = {
  description: 'Opens this page once after an update that brings something new.',
  readFailed: 'This setting could not be read.',
  rereading: 'Reading the setting again…',
  writeFailed: 'Not saved — check that the extension is still enabled, then try again.',
  retry: 'Retry'
} as const;

/** The description's element id (the switch's `aria-describedby`). */
const DESCRIPTION_ID = 'whats-new-on-update-description';

/**
 * Render the switch.
 *
 * @param props.io The setting's seams (storage-backed in production).
 */
export function OnUpdateSwitch(props: { io: InstantSettingIO<boolean> }): JSX.Element {
  const [snapshot, setSnapshot] = createSignal<InstantSettingSnapshot<boolean>>({
    status: 'loading'
  });
  const [writeFailed, setWriteFailed] = createSignal(false);
  // One-shot seam: the page mounts once over fixed IO.
  // eslint-disable-next-line solid/reactivity
  const model = createInstantSettingModel(props.io, Object.is, (next) => {
    setSnapshot(() => next);
  });
  onCleanup(() => {
    model.dispose();
  });
  void model.load();

  const ready = (): Extract<InstantSettingSnapshot<boolean>, { status: 'ready' }> | null => {
    const current = snapshot();
    return current.status === 'ready' ? current : null;
  };
  /** Apply a flip; a failed write shows its line until the next flip. */
  const set = (next: boolean): void => {
    setWriteFailed(false);
    void model
      .set(next)
      .then((outcome) => {
        if (outcome === 'failed') setWriteFailed(true);
      })
      .catch((cause: unknown) => {
        props.io.log.error('Applying the What’s new setting failed unexpectedly', cause);
        setWriteFailed(true);
      });
  };

  return (
    <div data-fdt="whats-new-on-update" class="flex flex-col gap-1">
      <Branch>
        <Match when={snapshot().status === 'failed' || snapshot().status === 'retrying'}>
          <div class="flex flex-wrap items-center gap-1.5">
            <span class="text-xs font-medium text-fg-primary">{WHATS_NEW_ON_UPDATE_LABEL}</span>
            <p class="text-2xs text-status-error">
              {snapshot().status === 'retrying'
                ? ON_UPDATE_WORDS.rereading
                : ON_UPDATE_WORDS.readFailed}
            </p>
            <Button
              size="sm"
              busy={snapshot().status === 'retrying'}
              onClick={() => {
                void model.load();
              }}
            >
              {ON_UPDATE_WORDS.retry}
            </Button>
          </div>
        </Match>
        <Match when={ready()}>
          {(current) => (
            <Switch
              label={WHATS_NEW_ON_UPDATE_LABEL}
              aria-describedby={DESCRIPTION_ID}
              checked={current().value}
              onChange={set}
            />
          )}
        </Match>
        <Match when={snapshot().status === 'loading'}>
          <div class="flex min-h-6 items-center gap-1.5">
            <span class="inline-flex w-9 shrink-0 justify-center">
              <Skeleton class="h-3.5 w-7 rounded-full" />
            </span>
            <span class="text-xs font-medium text-fg-primary">{WHATS_NEW_ON_UPDATE_LABEL}</span>
          </div>
        </Match>
      </Branch>
      <p id={DESCRIPTION_ID} class="ps-10.5 text-2xs text-fg-secondary">
        {ON_UPDATE_WORDS.description}
      </p>
      <Show when={writeFailed()}>
        <p data-fdt="whats-new-on-update-failed" class="ps-10.5 text-2xs text-status-error">
          {ON_UPDATE_WORDS.writeFailed}
        </p>
      </Show>
    </div>
  );
}
