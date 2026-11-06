/**
 * The LCP & Vitals page: break the inspected page's Largest Contentful Paint
 * into its four parts (with every candidate, and an opt-in frame around the
 * element on the page), and read this visit's Core Web Vitals. Loaded on
 * first visit (its own chunk).
 *
 * State matrix (the shell owns loading, fetch errors and render crashes —
 * this body renders on `ready`/`refreshing`): the LCP card (see
 * `./lcp-card`) above the vitals card (see `./vitals-card`). The vitals are
 * read on the page's first open (a passive read); the analysis waits for
 * Analyse (it may frame the element).
 *
 * The session outlives the page body (panel lifetime): leaving the route
 * mid-ask keeps the ask, and its answer is there on return. A data refresh
 * swaps only the payload — the shown answers stay (marked stale once the
 * page reloaded).
 */
import type { JSX } from 'solid-js';
import { createRoot, Show } from 'solid-js';
import { useFdtData } from '../../state/use-fdt-data';
import { PageFrame } from '../page-frame';
import { inspectedReloadAction } from '../reload-inspected';
import { LcpCard } from './lcp-card';
import { realLcpVitalsDeps } from './real-deps';
import { createLcpVitalsSession, type LcpVitalsSession } from './session';
import { VitalsCard } from './vitals-card';

/** The page's title and one-line intro. */
export const LCP_VITALS_TITLE = 'LCP & Vitals';
export const LCP_VITALS_SUBTITLE =
  "Break this page's Largest Contentful Paint into its parts, and see this visit's Core Web Vitals.";

/** The panel-lifetime session (created on the page's first mount). */
let sharedSession: LcpVitalsSession | null = null;

/**
 * Create a session in its own reactive root (never disposed: it lives as
 * long as the panel document).
 *
 * @param create Builds the session.
 */
export function createLcpVitalsHandle(create: () => LcpVitalsSession): LcpVitalsSession {
  return createRoot(create);
}

/** Props of {@link LcpVitalsPage}. */
export interface LcpVitalsPageProps {
  /** A prebuilt session (tests); absent, the panel-lifetime one. */
  session?: LcpVitalsSession;
  /**
   * Reloads the inspected page (tests; `null`: the context cannot); absent,
   * DevTools' own reload when available.
   */
  reloadInspectedPage?: (() => void) | null;
}

/**
 * Render the page body.
 *
 * @param props See {@link LcpVitalsPageProps}.
 */
export function LcpVitalsPage(props: LcpVitalsPageProps = {}): JSX.Element {
  const store = useFdtData();
  // The session is chosen once per mount.
  const session =
    props.session ??
    (sharedSession ??= createLcpVitalsHandle(() =>
      createLcpVitalsSession(realLcpVitalsDeps({ state: store.state }))
    ));
  // Read once: the context cannot change.
  const reloadPage =
    props.reloadInspectedPage === undefined
      ? inspectedReloadAction(browser)
      : (props.reloadInspectedPage ?? undefined);
  session.ensureVitals();

  /** Whether the shell holds page data (the body renders only then). */
  const hasData = (): boolean => {
    const status = store.state().status;
    return status === 'ready' || status === 'refreshing';
  };

  return (
    <Show when={hasData()}>
      <PageFrame id="lcp-vitals" title={LCP_VITALS_TITLE} subtitle={LCP_VITALS_SUBTITLE}>
        <LcpCard session={session} reloadPage={reloadPage} />
        <VitalsCard session={session} reloadPage={reloadPage} />
      </PageFrame>
    </Show>
  );
}
