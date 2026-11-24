/**
 * The What's new page's view: the mark, product name and running version
 * as the headline; how to start (the DevTools shortcut — no browser lets an
 * extension open DevTools — and the options page); the featured releases in
 * full; earlier releases as collapsed history; and the footer's opt-out.
 *
 * State matrix: one featured release renders under the page's headline;
 * several (an update across announced releases) each get their version
 * heading and headline, newest first; none (an empty registry) says so and
 * keeps the actions and the footer. The page reads the appearance; it never writes it.
 */
import type { Accessor, JSX } from 'solid-js';
import { createMemo, For, Show } from 'solid-js';
import ChevronRight from 'lucide-solid/icons/chevron-right';
import Settings from 'lucide-solid/icons/settings';
import { Badge } from '../../components/ui/badge';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { FOCUS_RING, MOTION_TURN } from '../../components/ui/classes';
import { createSystemDark, type ColorSchemeQuery } from '../../components/system-dark';
import { iconOfSize } from '../../lib/branding/icons';
import type { InstantSettingIO } from '../../lib/options/instant-setting';
import { fillTokens, type CopyTokenValues } from '../../lib/release-notes/copy-tokens';
import type { ReleaseNote } from '../../lib/release-notes/notes';
import type { WhatsNewView } from '../../lib/release-notes/page-view';
import type { ScreenshotPalette } from '../../lib/release-notes/screenshots';
import { WHATS_NEW_NAME } from '../../lib/release-notes/words';
import { cn } from '../../utils/cn';
import type { Appearance } from '../../utils/theme';
import { OnUpdateSwitch } from './on-update-switch';
import { ReleaseBody, type ReleaseScope } from './release';

/** The page's own words. */
export const PAGE_WORDS = {
  startTitle: 'Get started',
  panel: 'Open DevTools ({devtoolsShortcut}) on any page, then choose the WPR FDT tab.',
  palette: 'On a page, press {paletteShortcut} or click the toolbar icon for the command palette.',
  openOptions: 'Open options',
  history: 'Earlier versions',
  /** A featured release's heading, when several are shown. */
  release: (version: string): string => `Version ${version}`,
  empty: 'No release notes ship with this version.'
} as const;

/** The mark the header shows (the padded store art, drawn at 48 px). */
const PAGE_MARK = iconOfSize(96);

export interface WhatsNewPageProps {
  /** The product name (from the manifest). */
  name: string;
  /** The running version (from the manifest). */
  version: string;
  /** The releases to show. */
  view: WhatsNewView;
  /** The filled copy placeholders. */
  tokens: CopyTokenValues;
  /** The stored appearance the document follows (the boot's follow). */
  appearance: Accessor<Appearance>;
  /** The opt-out setting's seams. */
  settingIO: InstantSettingIO<boolean>;
  /** Open the options page; rejections are logged by the caller's IO. */
  openOptions: () => Promise<void>;
  /** The OS dark preference query (tests pass a fake). */
  colorScheme?: ColorSchemeQuery | null;
}

/**
 * One earlier release, collapsed under its version and headline.
 *
 * @param props.version The release's version.
 * @param props.headline Its one-line summary.
 * @param props.children Its body.
 */
function HistoryEntry(props: {
  version: string;
  headline: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Card>
      <details data-fdt-history={props.version} class="group">
        <summary
          class={cn(
            'flex cursor-pointer list-none items-start gap-1.5 rounded-lg p-2.5 [&::-webkit-details-marker]:hidden',
            FOCUS_RING
          )}
        >
          <ChevronRight
            size={14}
            aria-hidden="true"
            class={cn('mt-0.5 shrink-0 text-fg-muted group-open:rotate-90', MOTION_TURN)}
          />
          <span class="flex min-w-0 flex-col gap-0.5">
            <span class="font-mono text-xs font-semibold text-fg-primary">{props.version}</span>
            <span class="text-xs text-fg-secondary">{props.headline}</span>
          </span>
        </summary>
        <div class="px-2.5 pb-2.5">{props.children}</div>
      </details>
    </Card>
  );
}

/**
 * One of several featured releases: its version heading and headline, then
 * its body one heading level lower.
 *
 * @param props.note The release.
 * @param props.scope The page's tokens and palette.
 * @param props.fill Fills a copy line's placeholders.
 */
function FeaturedRelease(props: {
  note: ReleaseNote;
  scope: ReleaseScope;
  fill: (text: string) => string;
}): JSX.Element {
  return (
    <section data-fdt-release={props.note.version} class="flex flex-col gap-3">
      <div class="flex flex-col gap-1 border-b border-line-1 pb-2">
        <h2 class="text-sm font-semibold text-fg-primary">
          {PAGE_WORDS.release(props.note.version)}
        </h2>
        <p class="text-sm text-fg-primary">{props.fill(props.note.headline)}</p>
      </div>
      <ReleaseBody note={props.note} scope={props.scope} level={3} />
    </section>
  );
}

/**
 * Render the page.
 *
 * @param props See {@link WhatsNewPageProps}.
 */
export default function App(props: WhatsNewPageProps): JSX.Element {
  // One-shot: the query is fixed for the document's lifetime.
  // eslint-disable-next-line solid/reactivity
  const systemDark = createSystemDark(props.colorScheme);
  const palette = createMemo<ScreenshotPalette>(() => {
    const choice = props.appearance();
    if (choice === 'system') return systemDark() ? 'dark' : 'light';
    return choice;
  });
  const scope: ReleaseScope = {
    get tokens() {
      return props.tokens;
    },
    palette
  };
  const fill = (text: string): string => fillTokens(text, props.tokens);
  /** The one featured release, when there is exactly one. */
  const single = (): ReleaseNote | undefined =>
    props.view.featured.length === 1 ? props.view.featured[0] : undefined;

  return (
    <main class="whats-new-page @container min-h-dvh bg-surface-0" data-fdt-page="whats-new">
      <div
        data-fdt="whats-new-body"
        class="mx-auto flex w-full min-w-0 max-w-3xl flex-col gap-6 px-4 pb-10 pt-8"
      >
        <header class="flex flex-col gap-3">
          <div class="flex min-w-0 items-center gap-3">
            <img
              src={`/${PAGE_MARK.path}`}
              width={48}
              height={48}
              alt=""
              class="size-12 shrink-0"
            />
            <div class="flex min-w-0 flex-col gap-0.5">
              <p class="text-2xs font-medium uppercase tracking-wide text-fg-muted">
                {WHATS_NEW_NAME}
              </p>
              <div class="flex min-w-0 flex-wrap items-baseline gap-x-2 gap-y-1">
                <h1 class="min-w-0 text-base font-semibold text-fg-primary">{props.name}</h1>
                <Badge kind="neutral" variant="outline" class="shrink-0 font-mono">
                  {`v${props.version}`}
                </Badge>
              </div>
            </div>
          </div>
          <Show when={single()}>
            {(note) => (
              <p data-fdt="whats-new-headline" class="text-sm text-fg-primary">
                {fill(note().headline)}
              </p>
            )}
          </Show>
        </header>

        <Card>
          <section data-fdt="whats-new-start" class="flex flex-col gap-2 p-2.5">
            <h2 class="text-sm font-semibold text-fg-primary">{PAGE_WORDS.startTitle}</h2>
            <ul class="flex list-disc flex-col gap-1 ps-4 text-xs text-fg-secondary">
              <li data-fdt="whats-new-panel-hint">{fill(PAGE_WORDS.panel)}</li>
              <li>{fill(PAGE_WORDS.palette)}</li>
            </ul>
            <div class="flex flex-wrap gap-2 pt-1">
              <Button
                data-fdt="whats-new-open-options"
                onClick={() => {
                  void props.openOptions();
                }}
              >
                <Settings size={14} aria-hidden="true" />
                {PAGE_WORDS.openOptions}
              </Button>
            </div>
          </section>
        </Card>

        <Show
          when={props.view.featured.length > 0}
          fallback={<p class="text-xs text-fg-secondary">{PAGE_WORDS.empty}</p>}
        >
          <Show
            when={single()}
            fallback={
              <For each={props.view.featured}>
                {(note) => <FeaturedRelease note={note} scope={scope} fill={fill} />}
              </For>
            }
          >
            {(note) => (
              <div data-fdt-release={note().version}>
                <ReleaseBody note={note()} scope={scope} level={2} />
              </div>
            )}
          </Show>
        </Show>

        <Show when={props.view.history.length > 0}>
          <section class="flex flex-col gap-2">
            <h2 class="text-sm font-semibold text-fg-primary">{PAGE_WORDS.history}</h2>
            <For each={props.view.history}>
              {(note) => (
                <HistoryEntry version={note.version} headline={fill(note.headline)}>
                  <ReleaseBody note={note} scope={scope} level={3} />
                </HistoryEntry>
              )}
            </For>
          </section>
        </Show>

        <footer class="border-t border-line-1 pt-4">
          <OnUpdateSwitch io={props.settingIO} />
        </footer>
      </div>
    </main>
  );
}
