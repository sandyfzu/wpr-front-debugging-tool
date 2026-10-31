/**
 * The Delay JS lane's mode control as rendered: options per real state
 * (unavailable ones dimmed, the reason said; a no-op Disabled said, never
 * dimmed), the blocked draft-mode note (As served clears it), focus kept across state changes, the
 * admin-screen warning that never blocks, the kept-simulation note, and the
 * simulated page's count, version and list lines and its limits disclosure
 * — then the Defer JS and LazyLoad lanes' own options, notes and lines.
 */
import { createHash } from 'node:crypto';
import { createRoot, createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { EMPTY_EXCLUSION_SET, type ExclusionSet } from '../../../lib/exclusion-builder/set';
import type { TransformReport } from '../../../lib/exclusion-builder/report';
import type {
  ActiveExclusionSession,
  ExclusionSessionStatus
} from '../../../lib/messaging/exclusion-session';
import {
  deferSimulatedReport,
  lazyloadSimulatedReport,
  simulatedReport
} from '../../../lib/messaging/exclusion-simulation.fixtures';
import type { DelaySimulationReport } from '../../../lib/messaging/exclusion-simulation';
import type { SimulateSpec } from '../../../lib/wp-rocket-simulation/spec';
import type { VirtualizerFactory } from '../../../components/ui/virtual-list';
import { createOverlayController, type OverlayController } from '../controller';
import type { ExclusionSessionPort, PortOutcome } from '../session/port';
import { DEFER_MODE_COPY, DELAY_MODE_COPY, LAZYLOAD_MODE_COPY } from '../copy';
import {
  ADMIN_WARNING_LANE,
  NO_PAGE_EVIDENCE,
  NO_SIMULATION_EVIDENCE,
  type DraftModeBlock,
  type LanePageEvidence
} from './simulation-mode';
import { Lane } from './lane';

const PAGE = 'https://example.com/';

/** The version-line tail every lane whose simulation applied carries (the site-exclusions note in short). */
const SITE_TAIL = ' · without the site’s own exclusions';
/** Any form of the site-exclusions note (the banner's sentence or the lane's tail). */
const ANY_SITE_NOTE = /site’s own (WP Rocket )?exclusions/;
/** The banner's full sentence: never on a lane. */
const FULL_SITE_NOTE = /site’s own WP Rocket exclusions aren’t included/;

/** The lane's limits disclosure toggle, by its "N limit(s)" name. */
const limitsToggle = (): HTMLElement => screen.getByRole('button', { name: /^\d+ limits?$/ });
const SIMULATE: SimulateSpec = { features: ['delay_js'] };

const noRows: VirtualizerFactory = () => ({
  getVirtualItems: () => [],
  getTotalSize: () => 0,
  measureElement: () => undefined
});

const reply = <T,>(value: T): Promise<PortOutcome<T>> =>
  Promise.resolve({ kind: 'reply', reply: value });

/** A ready controller over a port answering `status` and `saved`, with page evidence. */
async function ready(
  evidence: LanePageEvidence,
  options: {
    status?: ExclusionSessionStatus;
    saved?: { set: ExclusionSet; simulate?: SimulateSpec };
    href?: string;
    /** The Defer JS lane's evidence (default: nothing). */
    defer?: LanePageEvidence;
    /** The LazyLoad lane's evidence (default: nothing). */
    lazyload?: LanePageEvidence;
    /** Receives the evidence setter (a test that changes the page). */
    onPage?: (set: (next: LanePageEvidence) => void) => void;
  } = {}
): Promise<OverlayController> {
  const port: ExclusionSessionPort = {
    status: () => reply(options.status ?? { state: 'inactive' }),
    savedSet: () => reply(options.saved ?? { set: null }),
    apply: () => new Promise(() => undefined),
    stop: () => reply<ExclusionSessionStatus>({ state: 'inactive' }),
    save: () => reply({ outcome: 'saved' as const }),
    onStatus: () => () => undefined
  };
  const [page, setPage] = createSignal(evidence);
  options.onPage?.(setPage);
  const href = options.href ?? PAGE;
  const controller = createRoot(() =>
    createOverlayController({
      port,
      pageFacts: () => ({ href, documentUrl: href, navigationStart: 0, responseEnd: null }),
      now: () => 1,
      schedule: () => () => undefined,
      reload: vi.fn(),
      log: { warn: vi.fn() },
      simulationEvidence: () => ({
        delayJs: page(),
        deferJs: options.defer ?? NO_SIMULATION_EVIDENCE.deferJs,
        lazyload: options.lazyload ?? NO_SIMULATION_EVIDENCE.lazyload
      })
    })
  );
  controller.start();
  await new Promise((resolve) => setTimeout(resolve, 0));
  return controller;
}

/**
 * Render a mode lane (default: Delay JS).
 *
 * @param hold Whether an action holds the controls (its `locked` read live, a getter).
 */
function mount(
  controller: OverlayController,
  report?: TransformReport,
  hold: { readonly locked: boolean } = { locked: false },
  lane: 'delayJs' | 'deferJs' | 'lazyload' = 'delayJs'
): void {
  render(() => (
    <Lane
      lane={lane}
      controller={controller}
      report={report}
      pageCount={null}
      requestFrame={(run) => {
        run();
      }}
      locked={hold.locked}
      announce={vi.fn()}
      createVirtualizer={noRows}
      now={() => 1_790_000_000_000 + 3 * 3_600_000}
    />
  ));
}

/** The radio of a mode. */
const radio = (label: string): HTMLInputElement => screen.getByRole('radio', { name: label });

afterEach(cleanup);

describe('Delay JS lane mode control', () => {
  it('offers As served and Disabled on a delayed page, saying why Simulated is not', async () => {
    mount(await ready({ ...NO_PAGE_EVIDENCE, footprints: true }));
    expect(radio('As served').checked).toBe(true);
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('Disabled').disabled).toBe(false);
    const note = screen.getByText(DELAY_MODE_COPY.blocks['already-served']);
    // The reason is the control's description.
    const group = screen.getByRole('radiogroup', { name: DELAY_MODE_COPY.groupName });
    expect(note.closest(`#${group.getAttribute('aria-describedby') ?? ''}`)).not.toBeNull();
  });

  it('offers every mode on a page without Delay JS, saying a chosen Disabled changes nothing', async () => {
    const controller = await ready(NO_PAGE_EVIDENCE);
    mount(controller);
    expect(radio('Simulated').disabled).toBe(false);
    // No simulated page yet: the site-exclusions note belongs to an applied simulation.
    expect(screen.queryByText(ANY_SITE_NOTE)).toBeNull();
    // Disabled stays selectable: disabling what the page does not serve is a no-op.
    expect(radio('Disabled').disabled).toBe(false);
    expect(screen.queryByText(DELAY_MODE_COPY.disabledChangesNothing)).toBeNull();
    fireEvent.click(screen.getByText('Disabled'));
    expect(controller.laneMode('delayJs')).toBe('disabled');
    expect(screen.getByText(DELAY_MODE_COPY.disabledChangesNothing)).toBeTruthy();
    fireEvent.click(screen.getByText('Simulated'));
    expect(controller.laneMode('delayJs')).toBe('simulated');
    expect(radio('Simulated').checked).toBe(true);
    expect(screen.queryByText(DELAY_MODE_COPY.disabledChangesNothing)).toBeNull();
  });

  it('holds the whole control while an action is in flight: reachable, said why, picks refused', async () => {
    const controller = await ready(NO_PAGE_EVIDENCE);
    const [locked, setLocked] = createSignal(true);
    mount(controller, undefined, {
      get locked() {
        return locked();
      }
    });
    const group = screen.getByRole('radiogroup', { name: DELAY_MODE_COPY.groupName });
    expect(group.getAttribute('aria-disabled')).toBe('true');
    expect(group.getAttribute('title')).toBe(DELAY_MODE_COPY.held);
    // Never native-disabled: the checked radio stays the group's Tab stop.
    expect(radio('As served').disabled).toBe(false);
    radio('As served').focus();
    expect(document.activeElement).toBe(radio('As served'));
    fireEvent.click(screen.getByText('Simulated'));
    expect(controller.laneMode('delayJs')).toBe('served');
    expect(radio('As served').checked).toBe(true);
    expect(radio('Simulated').checked).toBe(false);
    // Released: the same radios take picks again, focus untouched.
    setLocked(false);
    expect(group.hasAttribute('aria-disabled')).toBe(false);
    expect(group.hasAttribute('title')).toBe(false);
    expect(document.activeElement).toBe(radio('As served'));
    fireEvent.click(screen.getByText('Simulated'));
    expect(controller.laneMode('delayJs')).toBe('simulated');
  });

  it('keeps an option the page does not allow natively disabled while held', async () => {
    const controller = await ready({ ...NO_PAGE_EVIDENCE, footprints: true });
    mount(controller, undefined, { locked: true });
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('As served').disabled).toBe(false);
    expect(radio('Disabled').disabled).toBe(false);
  });

  it('keeps a saved Disabled on a page without Delay JS (never blocked)', async () => {
    const disabled: ExclusionSet = {
      ...EMPTY_EXCLUSION_SET,
      disable: { ...EMPTY_EXCLUSION_SET.disable, delayJs: true }
    };
    const controller = await ready(NO_PAGE_EVIDENCE, { saved: { set: disabled } });
    mount(controller);
    expect(radio('Disabled').checked).toBe(true);
    expect(controller.blockedLaneMode('delayJs')).toBeNull();
  });

  it('keeps keyboard focus on a radio when the page’s state changes (checking → verified)', async () => {
    let setPage!: (next: LanePageEvidence) => void;
    const controller = await ready(
      { ...NO_PAGE_EVIDENCE, marker: 'checking' },
      {
        onPage: (set) => {
          setPage = set;
        }
      }
    );
    mount(controller);
    const served = radio('As served');
    served.focus();
    expect(document.activeElement).toBe(served);
    expect(radio('Simulated').disabled).toBe(true);
    setPage({ ...NO_PAGE_EVIDENCE, marker: 'verified' });
    // The same input, still focused: the radios were updated, never rebuilt.
    expect(radio('Simulated').disabled).toBe(false);
    expect(radio('As served')).toBe(served);
    expect(document.activeElement).toBe(served);
  });

  it('offers As served only on an AMP page', async () => {
    mount(await ready({ ...NO_PAGE_EVIDENCE, amp: true }));
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('Disabled').disabled).toBe(true);
    expect(screen.getByText(DELAY_MODE_COPY.blocks.amp)).toBeTruthy();
  });

  it('shows a restored mode the page does not allow as it is, dimmed, said, the draft kept', async () => {
    const controller = await ready(
      { ...NO_PAGE_EVIDENCE, footprints: true },
      { saved: { set: EMPTY_EXCLUSION_SET, simulate: SIMULATE } }
    );
    mount(controller);
    expect(radio('Simulated').checked).toBe(true);
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('As served').checked).toBe(false);
    expect(radio('Disabled').checked).toBe(false);
    const note = DELAY_MODE_COPY.blockedDraft('already-served');
    expect(note).toBe(
      'Set for this site; doesn’t apply on this page (WP Rocket already does it). Choose As served to clear it.'
    );
    expect(screen.getByText(note)).toBeTruthy();
    expect(controller.dirty()).toBe(false);
    // As served is a real click: it drops the simulation from the draft.
    fireEvent.click(screen.getByText('As served'));
    expect(controller.laneMode('delayJs')).toBe('served');
    expect(controller.draft().simulate).toBeUndefined();
    expect(radio('As served').checked).toBe(true);
    expect(screen.queryByText(note)).toBeNull();
  });

  it('never says Disabled changes nothing while a marker is being verified', async () => {
    const controller = await ready({ ...NO_PAGE_EVIDENCE, marker: 'checking' });
    mount(controller);
    fireEvent.click(screen.getByText('Disabled'));
    expect(controller.laneMode('delayJs')).toBe('disabled');
    expect(screen.queryByText(DELAY_MODE_COPY.disabledChangesNothing)).toBeNull();
  });

  it('never says Disabled changes nothing on a page a session’s rewrite touched (after Stop)', async () => {
    const controller = await ready({
      ...NO_PAGE_EVIDENCE,
      builderOff: true,
      builderTouched: true
    });
    mount(controller);
    fireEvent.click(screen.getByText('Disabled'));
    expect(controller.laneMode('delayJs')).toBe('disabled');
    expect(screen.queryByText(DELAY_MODE_COPY.disabledChangesNothing)).toBeNull();
  });

  it('warns on an admin or login screen without blocking any option', async () => {
    const controller = await ready(NO_PAGE_EVIDENCE, { href: `${PAGE}wp-login.php` });
    mount(controller);
    expect(screen.getByText(DELAY_MODE_COPY.adminScreen)).toBeTruthy();
    fireEvent.click(screen.getByText('Simulated'));
    expect(controller.laneMode('delayJs')).toBe('simulated');
  });

  it('says the admin warning once: under the first mode control, never the Defer JS one', async () => {
    expect(ADMIN_WARNING_LANE).toBe('delayJs');
    const controller = await ready(NO_PAGE_EVIDENCE, { href: `${PAGE}wp-admin/` });
    mount(controller, undefined, undefined, 'deferJs');
    expect(screen.queryByText(DEFER_MODE_COPY.adminScreen)).toBeNull();
    mount(controller);
    expect(screen.getAllByText(DELAY_MODE_COPY.adminScreen)).toHaveLength(1);
  });

  it('shows no admin warning on a front-end page', async () => {
    mount(await ready(NO_PAGE_EVIDENCE));
    expect(screen.queryByText(DELAY_MODE_COPY.adminScreen)).toBeNull();
  });

  it('says a kept simulation (no session on) goes away on reload', async () => {
    mount(await ready({ ...NO_PAGE_EVIDENCE, footprints: true, marker: 'verified' }));
    expect(screen.getByText(DELAY_MODE_COPY.kept)).toBeTruthy();
    expect(radio('Simulated').disabled).toBe(false);
  });

  it('dims Simulated while a marker is being verified (Disabled stays offered)', async () => {
    mount(await ready({ ...NO_PAGE_EVIDENCE, marker: 'checking' }));
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('Disabled').disabled).toBe(false);
    expect(screen.getByText(DELAY_MODE_COPY.blocks.checking)).toBeTruthy();
  });

  /** A rewritten document of this page carrying the given Delay JS simulation and lane report. */
  function delaySession(
    simulation: DelaySimulationReport,
    report: TransformReport
  ): ActiveExclusionSession {
    return {
      state: 'active',
      origin: 'https://example.com',
      set: { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, delayJs: ['gtag'] } },
      simulate: SIMULATE,
      startedAt: 1,
      document: {
        outcome: 'rewritten',
        reports: [report],
        simulation,
        served: {
          urlPath: PAGE,
          urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
          token: 't',
          order: 1,
          receivedAt: 40,
          speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
          copy: true,
          serviceWorkersBypassed: true
        }
      }
    };
  }

  /** A Delay JS lane report restoring one of four scripts. */
  const delayReport: TransformReport = {
    feature: 'delay_js',
    featureWide: false,
    candidates: 4,
    rewritten: 1,
    regionRemovals: 0,
    matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 1 }],
    unmatchedRows: []
  };

  it('says a stopped Delay JS pattern as a visible lane line, never a limit', async () => {
    const stopped: DelaySimulationReport = {
      ...simulatedReport(),
      delayed: 0,
      regexLimitHit: true
    };
    delete (stopped as { undetermined?: number }).undetermined;
    mount(
      await ready(
        { ...NO_PAGE_EVIDENCE, footprints: true },
        { status: delaySession(stopped, delayReport) }
      ),
      delayReport
    );
    const line = screen.getByText(
      'Delay JS’s pattern stops here (PHP backtracking limit): nothing delayed, as on the site.'
    );
    expect(line.className).toBe('xo-lane-caveat');
    expect(screen.queryByRole('button', { name: /^\d+ limits?$/ })).toBeNull();
  });

  it('counts a simulated page’s scripts and names the version and the list', async () => {
    const report = delayReport;
    const session = delaySession(simulatedReport(), report);
    mount(await ready({ ...NO_PAGE_EVIDENCE, footprints: true }, { status: session }), report);
    expect(screen.getByText('4 delayed by the simulation · 1 excluded by your rows')).toBeTruthy();
    expect(screen.queryByText(/delayed scripts restored/)).toBeNull();
    expect(
      screen.getByText(`Simulated · WP Rocket 3.24 (the site serves 3.12.1)${SITE_TAIL}`)
    ).toBeTruthy();
    expect(screen.queryByText(FULL_SITE_NOTE)).toBeNull();
    expect(screen.getByText('Exclusion list: latest (fetched 3 h ago)')).toBeTruthy();
    // The scripts left as served are an outcome: a visible line, no disclosure.
    const line = screen.getByText('1 left as served: WP Rocket decides it with random ids.');
    expect(line.className).toBe('xo-lane-caveat');
    expect(screen.queryByRole('button', { name: /^\d+ limits?$/ })).toBeNull();
    expect(radio('Simulated').checked).toBe(true);
  });
});

describe('Defer JS lane mode control', () => {
  it('replaces the disable switch; Simulated unavailable on a delayed page, said why', async () => {
    const controller = await ready({ ...NO_PAGE_EVIDENCE, footprints: true });
    mount(controller, undefined, undefined, 'deferJs');
    expect(screen.getByRole('radiogroup', { name: DEFER_MODE_COPY.groupName })).toBeTruthy();
    expect(screen.queryByRole('switch')).toBeNull();
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('Disabled').disabled).toBe(false);
    expect(screen.getByText(DEFER_MODE_COPY.blocks['delay-served'])).toBeTruthy();
    fireEvent.click(screen.getByText('Disabled'));
    expect(controller.draft().disable.deferJs).toBe(true);
  });

  it('says a page WP Rocket already defers, and a Disabled that changes nothing', async () => {
    const deferred = await ready(NO_PAGE_EVIDENCE, {
      defer: { ...NO_PAGE_EVIDENCE, footprints: true }
    });
    mount(deferred, undefined, undefined, 'deferJs');
    expect(screen.getByText(DEFER_MODE_COPY.blocks['already-served'])).toBeTruthy();
    cleanup();
    const plain = await ready(NO_PAGE_EVIDENCE);
    mount(plain, undefined, undefined, 'deferJs');
    fireEvent.click(screen.getByText('Disabled'));
    expect(screen.getByText(DEFER_MODE_COPY.disabledChangesNothing)).toBeTruthy();
  });

  it('shows the Defer JS simulation’s counts, version and list on the page it applied to', async () => {
    const report: TransformReport = {
      feature: 'defer_all_js',
      featureWide: false,
      candidates: 5,
      rewritten: 1,
      regionRemovals: 0,
      matchedRows: [],
      unmatchedRows: []
    };
    const session: ActiveExclusionSession = {
      state: 'active',
      origin: 'https://example.com',
      set: EMPTY_EXCLUSION_SET,
      simulate: { features: ['defer_all_js'] },
      startedAt: 1,
      document: {
        outcome: 'rewritten',
        reports: [report],
        deferSimulation: deferSimulatedReport(),
        served: {
          urlPath: PAGE,
          urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
          token: 't',
          order: 1,
          receivedAt: 40,
          speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
          copy: true,
          serviceWorkersBypassed: true
        }
      }
    };
    const controller = await ready(NO_PAGE_EVIDENCE, {
      status: session,
      defer: { ...NO_PAGE_EVIDENCE, footprints: true }
    });
    mount(controller, report, undefined, 'deferJs');
    expect(
      screen.getByText(
        '4 deferred and 1 inline wrapped by the simulation · 1 excluded by your rows'
      )
    ).toBeTruthy();
    expect(screen.getByText(`Simulated · WP Rocket 3.24${SITE_TAIL}`)).toBeTruthy();
    expect(screen.queryByText(FULL_SITE_NOTE)).toBeNull();
    expect(screen.getByText(/^Exclusion list: bundled with WP Rocket 3.24/)).toBeTruthy();
    // Defer JS has no lane limits: no disclosure.
    expect(screen.queryByRole('button', { name: /^\d+ limits?$/ })).toBeNull();
    expect(radio('Simulated').checked).toBe(true);
    expect(radio('Simulated').disabled).toBe(false);
  });
});

describe('LazyLoad lane mode control', () => {
  /** A rewritten document of this page carrying a simulated LazyLoad report. */
  function lazyloadSession(): ActiveExclusionSession {
    return {
      state: 'active',
      origin: 'https://example.com',
      set: { ...EMPTY_EXCLUSION_SET, rows: { ...EMPTY_EXCLUSION_SET.rows, lazyload: ['hero'] } },
      simulate: { features: ['lazyload'] },
      startedAt: 1,
      document: {
        outcome: 'rewritten',
        reports: [],
        lazyloadSimulation: {
          ...lazyloadSimulatedReport(),
          placement: {
            head: 'before-end-tag',
            footer: 'before-end-tag',
            fallbacks: ['last-of-several-body-ends']
          }
        },
        served: {
          urlPath: PAGE,
          urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
          token: 't',
          order: 1,
          receivedAt: 40,
          speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
          copy: true,
          serviceWorkersBypassed: true
        }
      }
    };
  }

  it('offers As served and Simulated only, in place of no switch', async () => {
    const controller = await ready(NO_PAGE_EVIDENCE);
    mount(controller, undefined, undefined, 'lazyload');
    const group = screen.getByRole('radiogroup', { name: LAZYLOAD_MODE_COPY.groupName });
    expect(group.querySelectorAll('input[type="radio"]')).toHaveLength(2);
    expect(screen.queryByRole('radio', { name: 'Disabled' })).toBeNull();
    expect(screen.queryByRole('switch')).toBeNull();
    fireEvent.click(screen.getByText('Simulated'));
    expect(controller.draft().simulate).toEqual({ features: ['lazyload'] });
  });

  it.each([
    ['already-served' as const, { ...NO_PAGE_EVIDENCE, footprints: true }],
    ['search' as const, { ...NO_PAGE_EVIDENCE, skip: 'search' as const }],
    ['amp' as const, { ...NO_PAGE_EVIDENCE, amp: true }]
  ])('dims Simulated and says why (%s)', async (block, lazyload) => {
    mount(await ready(NO_PAGE_EVIDENCE, { lazyload }), undefined, undefined, 'lazyload');
    expect(radio('Simulated').disabled).toBe(true);
    expect(radio('As served').disabled).toBe(false);
    expect(screen.getByText(LAZYLOAD_MODE_COPY.blocks[block])).toBeTruthy();
  });

  it('shows no admin warning under LazyLoad (said once, under the first mode control)', async () => {
    mount(
      await ready(NO_PAGE_EVIDENCE, { href: 'https://example.com/wp-admin/' }),
      undefined,
      undefined,
      'lazyload'
    );
    expect(screen.queryByText(LAZYLOAD_MODE_COPY.adminScreen)).toBeNull();
  });

  /** The simulated LazyLoad lane, mounted with rows that restored 2 images. */
  async function mountSimulatedLazyload(): Promise<void> {
    const report: TransformReport = {
      feature: 'lazyload',
      featureWide: false,
      candidates: 5,
      rewritten: 2,
      regionRemovals: 0,
      matchedRows: [{ row: 'hero', rowKind: 'literal', matches: 2 }],
      unmatchedRows: []
    };
    const controller = await ready(NO_PAGE_EVIDENCE, {
      status: lazyloadSession(),
      lazyload: { ...NO_PAGE_EVIDENCE, footprints: true }
    });
    mount(controller, report, undefined, 'lazyload');
  }

  it('shows the simulation’s counts and version, its limits collapsed', async () => {
    await mountSimulatedLazyload();
    expect(
      screen.getByText(
        '5 images, 1 picture and 2 background images lazy loaded by the simulation · 2 excluded by your rows'
      )
    ).toBeTruthy();
    expect(screen.queryByText(/lazy images restored/)).toBeNull();
    expect(screen.getByText(`Simulated · WP Rocket 3.24${SITE_TAIL}`)).toBeTruthy();
    // The long note is the banner's alone now.
    expect(screen.queryByText(FULL_SITE_NOTE)).toBeNull();
    // No exclusion list: LazyLoad's exclusions ship with the version.
    expect(screen.queryByText(/^Exclusion list:/)).toBeNull();
    const toggle = limitsToggle();
    expect(toggle.classList.contains('xo-disclosure')).toBe(true);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(toggle.querySelector('.xo-chevron')?.getAttribute('aria-hidden')).toBe('true');
    // Script line + one fallback + the noscript note + 3 every-page caveats.
    expect(toggle.textContent).toBe('6 limits');
    expect(screen.queryByText(/^Script address guessed/)).toBeNull();
    expect(document.querySelector('.xo-note-disclosure-item')).toBeNull();
  });

  it('opens in place onto exactly the page’s limit lines, and closes again', async () => {
    await mountSimulatedLazyload();
    const toggle = limitsToggle();
    toggle.focus();
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('true');
    const list = document.getElementById(toggle.getAttribute('aria-controls') ?? '');
    expect(list?.tagName.toLowerCase()).toBe('ul');
    const URL =
      'https://example.com/wp-content/plugins/wp-rocket/assets/js/lazyload/17.8.3/lazyload.min.js';
    expect([...(list?.querySelectorAll('li') ?? [])].map((item) => item.textContent)).toEqual([
      `Script address guessed from WordPress’s default folders; your folders or CDN may differ: ${URL}`,
      'Several </body> tags: LazyLoad’s scripts went before the last.',
      // The rows restored images: their noscript copies stay, unlike on the site.
      'Images your rows restore keep their noscript copy, unlike on the site.',
      'Style and scripts placed where most themes print them.',
      'Above-the-fold and LCP images aren’t skipped (needs WP Rocket’s site data).',
      'Site filters, options and DONOTLAZYLOAD aren’t applied.'
    ]);
    expect(list?.querySelector('code')?.textContent).toBe(URL);
    expect(document.activeElement).toBe(toggle);
    fireEvent.click(toggle);
    expect(toggle.getAttribute('aria-expanded')).toBe('false');
    expect(toggle.hasAttribute('aria-controls')).toBe(false);
    expect(document.querySelector('.xo-note-disclosure-item')).toBeNull();
    expect(radio('Simulated').checked).toBe(true);
    expect(radio('Simulated').disabled).toBe(false);
  });
});

describe('site-exclusions note on a mixed page', () => {
  /** A rewritten document of this page: Delay JS simulated, LazyLoad blocked by the CSP. */
  function mixedSession(): ActiveExclusionSession {
    return {
      state: 'active',
      origin: 'https://example.com',
      set: EMPTY_EXCLUSION_SET,
      simulate: { features: ['lazyload', 'delay_js'] },
      startedAt: 1,
      document: {
        outcome: 'rewritten',
        reports: [],
        simulation: simulatedReport(),
        lazyloadSimulation: {
          feature: 'lazyload',
          state: 'csp-blocked',
          images: 0,
          pictures: 0,
          backgrounds: 0,
          wpRocketVersion: '3.24'
        },
        served: {
          urlPath: PAGE,
          urlDigest: createHash('sha256').update(PAGE, 'utf8').digest('hex'),
          token: 't',
          order: 1,
          receivedAt: 40,
          speculationRules: { removedFromDocument: 0, headerRemoved: false, guarded: true },
          copy: true,
          serviceWorkersBypassed: true
        }
      }
    };
  }

  it('stays off the blocked lane while the simulated lane beside it carries it', async () => {
    const controller = await ready(
      { ...NO_PAGE_EVIDENCE, footprints: true },
      { status: mixedSession(), lazyload: { ...NO_PAGE_EVIDENCE, footprints: true } }
    );
    mount(controller, undefined, undefined, 'lazyload');
    expect(screen.queryByText(ANY_SITE_NOTE)).toBeNull();
    cleanup();
    mount(controller);
    expect(
      screen.getByText(`Simulated · WP Rocket 3.24 (the site serves 3.12.1)${SITE_TAIL}`)
    ).toBeTruthy();
  });
});

describe('As served by default (no session, no saved draft)', () => {
  /** The evidence of a page WP Rocket serves the feature on. */
  const SERVED: LanePageEvidence = { ...NO_PAGE_EVIDENCE, footprints: true };

  it.each(['delayJs', 'deferJs', 'lazyload'] as const)(
    'checks As served on the %s lane of a page served without the feature, and with it',
    async (lane) => {
      for (const evidence of [NO_PAGE_EVIDENCE, SERVED]) {
        const controller = await ready(
          lane === 'delayJs' ? evidence : NO_PAGE_EVIDENCE,
          lane === 'deferJs'
            ? { defer: evidence }
            : lane === 'lazyload'
              ? { lazyload: evidence }
              : {}
        );
        mount(controller, undefined, { locked: false }, lane);
        expect(radio('As served').checked).toBe(true);
        expect(radio('Simulated').checked).toBe(false);
        expect(controller.laneMode(lane)).toBe('served');
        expect(controller.blockedLaneMode(lane)).toBeNull();
        expect(controller.dirty()).toBe(false);
        cleanup();
      }
    }
  );

  it('keeps As served shown while the page is still read (Simulated dimmed, said)', async () => {
    const controller = await ready({ ...NO_PAGE_EVIDENCE, marker: 'checking' });
    mount(controller);
    expect(radio('As served').checked).toBe(true);
    expect(radio('Simulated').disabled).toBe(true);
    expect(screen.getByText(DELAY_MODE_COPY.blocks.checking)).toBeTruthy();
  });
});

describe('As served clears a draft mode the page does not allow', () => {
  /** Evidence of a page WP Rocket serves the feature on. */
  const SERVED: LanePageEvidence = { ...NO_PAGE_EVIDENCE, footprints: true };
  const AMP: LanePageEvidence = { ...NO_PAGE_EVIDENCE, amp: true };
  /** A set disabling a lane's feature. */
  const disabling = (key: 'delayJs' | 'deferJs'): ExclusionSet => ({
    ...EMPTY_EXCLUSION_SET,
    disable: { ...EMPTY_EXCLUSION_SET.disable, [key]: true }
  });
  type Case = readonly [
    name: string,
    lane: 'delayJs' | 'deferJs' | 'lazyload',
    blocked: 'simulated' | 'disabled',
    block: DraftModeBlock,
    pages: { delay?: LanePageEvidence; defer?: LanePageEvidence; lazyload?: LanePageEvidence }
  ];
  const CASES: readonly Case[] = [
    ['Delay JS, already delayed', 'delayJs', 'simulated', 'already-served', { delay: SERVED }],
    ['Delay JS, AMP', 'delayJs', 'simulated', 'amp', { delay: AMP }],
    ['Delay JS Disabled, AMP', 'delayJs', 'disabled', 'amp', { delay: AMP }],
    ['Defer JS, already deferred', 'deferJs', 'simulated', 'already-served', { defer: SERVED }],
    ['Defer JS, delayed page', 'deferJs', 'simulated', 'delay-served', { delay: SERVED }],
    ['Defer JS, AMP', 'deferJs', 'simulated', 'amp', { defer: AMP }],
    ['Defer JS Disabled, AMP', 'deferJs', 'disabled', 'amp', { defer: AMP }],
    [
      'LazyLoad, already lazy loaded',
      'lazyload',
      'simulated',
      'already-served',
      { lazyload: SERVED }
    ],
    ['LazyLoad, AMP', 'lazyload', 'simulated', 'amp', { lazyload: AMP }],
    [
      'LazyLoad, preview',
      'lazyload',
      'simulated',
      'preview',
      { lazyload: { ...NO_PAGE_EVIDENCE, skip: 'preview' } }
    ],
    [
      'LazyLoad, search',
      'lazyload',
      'simulated',
      'search',
      { lazyload: { ...NO_PAGE_EVIDENCE, skip: 'search' } }
    ],
    [
      'LazyLoad, page builder editor',
      'lazyload',
      'simulated',
      'page-builder-editor',
      { lazyload: { ...NO_PAGE_EVIDENCE, skip: 'page-builder-editor' } }
    ]
  ];
  const FEATURE = { delayJs: 'delay_js', deferJs: 'defer_all_js', lazyload: 'lazyload' } as const;
  const COPY = { delayJs: DELAY_MODE_COPY, deferJs: DEFER_MODE_COPY, lazyload: LAZYLOAD_MODE_COPY };

  it.each(CASES)(
    '%s: shown checked + dimmed + said; As served clears it (restored, and in a session)',
    async (...args) => {
      const [, lane, blocked, block, pages] = args;
      const saved =
        blocked === 'simulated'
          ? { set: EMPTY_EXCLUSION_SET, simulate: { features: [FEATURE[lane]] } }
          : { set: disabling(lane === 'deferJs' ? 'deferJs' : 'delayJs') };
      // The same choice restored from the site's saved draft, then as the
      // active session's (no document of this page yet: the live page decides).
      const statuses: readonly ExclusionSessionStatus[] = [
        { state: 'inactive' },
        { state: 'active', origin: 'https://example.com', startedAt: 1, document: null, ...saved }
      ];
      for (const status of statuses) {
        const controller = await ready(pages.delay ?? NO_PAGE_EVIDENCE, {
          status,
          saved,
          defer: pages.defer,
          lazyload: pages.lazyload
        });
        mount(controller, undefined, { locked: false }, lane);
        const label = blocked === 'simulated' ? 'Simulated' : 'Disabled';
        expect(radio(label).checked).toBe(true);
        expect(radio(label).disabled).toBe(true);
        expect(radio('As served').checked).toBe(false);
        expect(radio('As served').disabled).toBe(false);
        expect(controller.blockedLaneMode(lane)).toBe(block);
        const note = COPY[lane].blockedDraft(block);
        expect(screen.getByText(note)).toBeTruthy();
        expect(controller.dirty()).toBe(false);
        fireEvent.click(screen.getByText('As served'));
        expect(controller.laneMode(lane)).toBe('served');
        // An edit: against the session's set when one is on.
        expect(controller.dirty()).toBe(status.state === 'active');
        expect(controller.draft().simulate).toBeUndefined();
        expect(controller.draft().disable).toEqual(EMPTY_EXCLUSION_SET.disable);
        expect(radio('As served').checked).toBe(true);
        expect(screen.queryByText(note)).toBeNull();
        cleanup();
      }
    }
  );

  it('names each block short, inside one sentence', () => {
    expect(DELAY_MODE_COPY.blockedDraft('amp')).toBe(
      'Set for this site; doesn’t apply on this page (AMP page). Choose As served to clear it.'
    );
    expect(DEFER_MODE_COPY.blockedDraft('delay-served')).toBe(
      'Set for this site; doesn’t apply on this page (WP Rocket delays scripts here). Choose As served to clear it.'
    );
    expect(LAZYLOAD_MODE_COPY.blockedDraft('search')).toBe(
      'Set for this site; doesn’t apply on this page (search results). Choose As served to clear it.'
    );
  });
});
