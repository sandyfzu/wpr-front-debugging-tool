/**
 * The consent page's view: one centered card per state of the flow
 * (`./consent-flow`) — what is sent and why, Allow / Not now, the decline
 * or failure with Ask again, and the brief granted state before the tab
 * closes (or goes on to PageSpeed Insights). The page only reads the
 * appearance setting; it never writes one.
 */
import type { JSX } from 'solid-js';
import { Match, onCleanup, onMount, Show, Switch } from 'solid-js';
import ShieldCheck from 'lucide-solid/icons/shield-check';
import ShieldOff from 'lucide-solid/icons/shield-off';
import ShieldQuestion from 'lucide-solid/icons/shield-question-mark';
import { BrandMark } from '../../components/ui/brand-mark';
import { Button } from '../../components/ui/button';
import { Card } from '../../components/ui/card';
import { StateIcon } from '../../components/ui/state-icon';
import { DATA_CONSENT_FEATURES } from '../../lib/data-consent/consent';
import type { ConsentFlow } from './consent-flow';
import type { DataConsentPageQuery } from '../../lib/data-consent/consent-page-url';

/** The page's words, verbatim (sentence case). */
export const CONSENT_WORDS = {
  askTitle: 'Allow sending page addresses?',
  scope:
    'This covers the two tools that send a page address: the RUCSS Tester and PageSpeed Insights. Nothing else about your browsing leaves Firefox. You can turn it off any time in the Add-ons Manager (this extension → Permissions and data).',
  allow: 'Allow',
  notNow: 'Not now',
  requesting: 'Confirm in the Firefox prompt.',
  grantedTitle: 'Sending allowed',
  grantedRucss: 'Back to the RUCSS Tester: the test starts on its own.',
  grantedPagespeed: 'Opening PageSpeed Insights…',
  declinedTitle: 'Sending declined',
  failedTitle: "Couldn't ask Firefox",
  askAgain: 'Ask again',
  closeTab: 'Close tab',
  noToolTitle: 'Nothing to allow here',
  noTool: 'Open this page from the RUCSS Tester or from PageSpeed Insights.',
  nothingSent: 'Nothing was sent.'
} as const;

/**
 * The declined state's sentence for one tool.
 *
 * @param name The tool's name.
 */
export function declinedMessage(name: string): string {
  return `${CONSENT_WORDS.nothingSent} ${name} needs the page's address to work.`;
}

/**
 * The card frame every state shares: icon tile, title, body, actions.
 *
 * @param props.icon The state's icon tile.
 * @param props.title The state's heading.
 * @param props.children The body and the actions.
 */
function StateCard(props: {
  icon: JSX.Element;
  title: string;
  children: JSX.Element;
}): JSX.Element {
  return (
    <Card>
      <div class="flex flex-col gap-3 p-2">
        <div class="flex items-center gap-3">
          {props.icon}
          <h1 class="text-base font-semibold text-fg-primary">{props.title}</h1>
        </div>
        {props.children}
      </div>
    </Card>
  );
}

/** A body paragraph. */
function Text(props: { children: JSX.Element; data?: string }): JSX.Element {
  return (
    <p class="text-xs text-fg-secondary" data-fdt-consent-text={props.data}>
      {props.children}
    </p>
  );
}

/** The action row. */
function Actions(props: { children: JSX.Element }): JSX.Element {
  return <div class="flex flex-wrap gap-2 pt-1">{props.children}</div>;
}

/**
 * Render the page.
 *
 * @param props.query What the page was opened for (null: no known tool asked).
 * @param props.flow The page's controller (null with no query).
 * @param props.name The product name (from the manifest).
 */
export default function App(props: {
  query: DataConsentPageQuery | null;
  flow: ConsentFlow | null;
  name: string;
}): JSX.Element {
  onMount(() => {
    void props.flow?.start();
  });
  onCleanup(() => {
    props.flow?.dispose();
  });
  const words = () => (props.query === null ? null : DATA_CONSENT_FEATURES[props.query.feature]);
  const status = () => props.flow?.state().status ?? 'none';
  const closeButton = (variant: 'primary' | 'secondary'): JSX.Element => (
    <Button
      variant={variant}
      data-fdt-consent-action="close"
      onClick={() => void props.flow?.close()}
    >
      {CONSENT_WORDS.closeTab}
    </Button>
  );
  const askAgain = (): JSX.Element => (
    <Button
      variant="primary"
      data-fdt-consent-action="ask-again"
      onClick={() => void props.flow?.allow()}
    >
      {CONSENT_WORDS.askAgain}
    </Button>
  );
  return (
    <main class="@container min-h-dvh bg-surface-0" data-fdt-page="data-consent">
      <div class="mx-auto flex w-full min-w-0 max-w-lg flex-col gap-4 px-4 pb-8 pt-8">
        <div class="flex items-center gap-2 text-xs font-semibold text-fg-primary">
          <BrandMark />
          <span>{props.name}</span>
        </div>
        <Switch>
          <Match when={status() === 'none'}>
            <StateCard
              icon={
                <StateIcon>
                  <ShieldQuestion size={18} aria-hidden="true" />
                </StateIcon>
              }
              title={CONSENT_WORDS.noToolTitle}
            >
              <Text>{CONSENT_WORDS.noTool}</Text>
            </StateCard>
          </Match>
          <Match when={status() === 'asking' || status() === 'requesting'}>
            <StateCard
              icon={
                <StateIcon tone="accent">
                  <ShieldQuestion size={18} aria-hidden="true" />
                </StateIcon>
              }
              title={CONSENT_WORDS.askTitle}
            >
              <Text data="sends">{words()?.sends}</Text>
              <Text>{CONSENT_WORDS.scope}</Text>
              <Show when={status() === 'requesting'}>
                <Text data="requesting">{CONSENT_WORDS.requesting}</Text>
              </Show>
              <Actions>
                <Button
                  variant="primary"
                  busy={status() === 'requesting'}
                  data-fdt-consent-action="allow"
                  onClick={() => void props.flow?.allow()}
                >
                  {CONSENT_WORDS.allow}
                </Button>
                <Button
                  disabled={status() === 'requesting'}
                  data-fdt-consent-action="not-now"
                  onClick={() => void props.flow?.decline()}
                >
                  {CONSENT_WORDS.notNow}
                </Button>
              </Actions>
            </StateCard>
          </Match>
          <Match when={status() === 'granted'}>
            <StateCard
              icon={
                <StateIcon tone="accent">
                  <ShieldCheck size={18} aria-hidden="true" />
                </StateIcon>
              }
              title={CONSENT_WORDS.grantedTitle}
            >
              <Text>
                {props.query?.next == null
                  ? CONSENT_WORDS.grantedRucss
                  : CONSENT_WORDS.grantedPagespeed}
              </Text>
              <Show when={props.flow?.closeFailed() === true}>
                <Actions>{closeButton('primary')}</Actions>
              </Show>
            </StateCard>
          </Match>
          <Match when={status() === 'declined'}>
            <StateCard
              icon={
                <StateIcon>
                  <ShieldOff size={18} aria-hidden="true" />
                </StateIcon>
              }
              title={CONSENT_WORDS.declinedTitle}
            >
              <Text>{words()?.sends}</Text>
              <Text>{declinedMessage(words()?.name ?? '')}</Text>
              <Actions>
                {askAgain()}
                {closeButton('secondary')}
              </Actions>
            </StateCard>
          </Match>
          <Match when={status() === 'failed'}>
            <StateCard
              icon={
                <StateIcon tone="error">
                  <ShieldOff size={18} aria-hidden="true" />
                </StateIcon>
              }
              title={CONSENT_WORDS.failedTitle}
            >
              <Text data="failure">
                {(() => {
                  const state = props.flow?.state();
                  return state?.status === 'failed' ? state.message : '';
                })()}
              </Text>
              <Text>{CONSENT_WORDS.nothingSent}</Text>
              <Actions>
                {askAgain()}
                {closeButton('secondary')}
              </Actions>
            </StateCard>
          </Match>
        </Switch>
      </div>
    </main>
  );
}
