/**
 * The instructions card over a tracker fed by a data-state signal: the calm
 * line, the unreadable line, the collapsed summary, the three groups with
 * counts, the raw JSON with copy (no request field; whole when the view is
 * cut), the load stamp, the page swap on a reload, the stale notice on a load
 * without a beacon and its dismissal (none after an unreadable beacon), and
 * the expansion surviving a data refresh.
 */
import { cleanup, fireEvent, render, screen, waitFor } from '@solidjs/testing-library';
import { createRoot, createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import type { PriorityElementsBeaconDetection } from '../../../../lib/wp-rocket/types';
import type { DataState } from '../../state/fdt-state-machine';
import { makeFdtData } from '../../state/fixtures';
import {
  COPY_SUBJECT,
  createInstructionsTracker,
  InstructionsCard,
  RAW_LABELS,
  type InstructionsTracker
} from './instructions-card';
import {
  instructionsSourceOf,
  INSTRUCTIONS_TITLE,
  NO_INSTRUCTIONS_COPY,
  hiddenEntriesNote,
  LIST_DISPLAY_MAX,
  rawCutNote,
  RAW_DISPLAY_MAX_CHARS,
  STALE_INSTRUCTIONS_COPY,
  STALE_INSTRUCTIONS_TITLE,
  UNREADABLE_INSTRUCTIONS_COPY
} from './instructions-view';

/** The fixture payload's detection rows (all absent). */
const EMPTY_DETECTIONS = makeFdtData().wprDetections;

const REAL: PriorityElementsBeaconDetection = {
  present: true,
  status: { atf: true, lrc: true, preconnect_external_domain: true },
  isMobile: false,
  elements: 'img, video, picture',
  preconnect_external_domain_elements: ['link', 'script', 'iframe'],
  preconnect_external_domain_exclusions: ['static.cloudflareinsights.com']
};

/**
 * A ready data state whose payload carries this beacon row.
 *
 * @param beacon The row.
 * @param page The load identity.
 */
function ready(beacon: PriorityElementsBeaconDetection, page: string): DataState {
  return {
    status: 'ready',
    data: makeFdtData({
      scriptSnapshotId: page,
      wprDetections: { ...EMPTY_DETECTIONS, priority_elements_beacon: beacon }
    }),
    fetchedAt: 0
  };
}

afterEach(() => {
  cleanup();
  Reflect.deleteProperty(navigator, 'clipboard');
});

/** Render the card on a state signal; returns the setter and the tracker. */
function renderCard(initial: DataState): {
  setState: (state: DataState) => void;
  tracker: InstructionsTracker;
} {
  const [state, setState] = createSignal<DataState>(initial);
  const tracker = createRoot(() => createInstructionsTracker(() => instructionsSourceOf(state())));
  render(() => <InstructionsCard tracker={tracker} />);
  return { setState, tracker };
}

/** The card root. */
function card(): HTMLElement {
  const root = document.querySelector<HTMLElement>('[data-fdt="beacon-instructions"]');
  if (root === null) throw new Error('no instructions card');
  return root;
}

/** The disclosure button. */
function toggle(): HTMLButtonElement {
  const button = document.querySelector<HTMLButtonElement>('[data-fdt-beacon-instructions-toggle]');
  if (button === null) throw new Error('no Details toggle');
  return button;
}

describe('InstructionsCard', () => {
  it('shows one calm line on a page without the beacon', () => {
    renderCard(ready({ present: false, status: null, isMobile: null }, 'p1'));
    expect(screen.getByRole('heading', { level: 2, name: INSTRUCTIONS_TITLE })).toBeTruthy();
    expect(card().dataset['fdtBeaconInstructions']).toBe('none');
    expect(screen.getByText(NO_INSTRUCTIONS_COPY)).toBeTruthy();
    expect(document.querySelector('[data-fdt-beacon-instructions-toggle]')).toBeNull();
  });

  it('is one compact info row: title, the words beside it, Details at its end', () => {
    renderCard(ready(REAL, 'p1'));
    const heading = screen.getByRole('heading', { level: 2, name: INSTRUCTIONS_TITLE });
    const row = heading.parentElement;
    expect(row?.querySelector('[data-fdt-beacon-instructions-summary]')).not.toBeNull();
    expect(row?.lastElementChild).toBe(toggle());
    expect(toggle().className).toContain('ms-auto');
    // The page-level weight stays with the page h1: the row's title reads as a caption.
    expect(heading.className).toContain('text-xs');
    // Details open under the row, never inside it.
    fireEvent.click(toggle());
    const details = document.querySelector('[data-fdt-beacon-instructions-details]');
    expect(row?.contains(details)).toBe(false);
    expect(card().contains(details)).toBe(true);
  });

  it('puts the no-beacon and unreadable words in the row itself', () => {
    const { setState } = renderCard(ready({ present: false, status: null, isMobile: null }, 'p1'));
    const row = () =>
      screen.getByRole('heading', { level: 2, name: INSTRUCTIONS_TITLE }).parentElement;
    expect(row()?.textContent).toContain(NO_INSTRUCTIONS_COPY);
    setState(ready({ present: true, status: null, isMobile: null }, 'p2'));
    expect(row()?.textContent).toContain(UNREADABLE_INSTRUCTIONS_COPY);
  });

  it('says when the beacon’s instructions could not be read', () => {
    renderCard(ready({ present: true, status: null, isMobile: null }, 'p1'));
    expect(card().dataset['fdtBeaconInstructions']).toBe('unreadable');
    expect(screen.getByText(UNREADABLE_INSTRUCTIONS_COPY)).toBeTruthy();
  });

  it('starts collapsed on the summary, then shows the three groups with counts', () => {
    renderCard(ready(REAL, 'p1'));
    const summary = document.querySelector('[data-fdt-beacon-instructions-summary]');
    expect(summary?.textContent).toBe('3 of 4 features on · Desktop');
    expect(summary?.getAttribute('title')).toMatch(/^On: Optimize Critical Images/);
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelector('[data-fdt-beacon-instructions-details]')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    const groups = [...document.querySelectorAll('[data-fdt-beacon-instructions-group] h3')];
    expect(groups.map((heading) => heading.textContent)).toEqual([
      'Features3 of 4 on',
      'Elements checked6',
      'Exclusions1'
    ]);
    const features = document.querySelector('[data-fdt-beacon-instructions-group="features"]');
    expect(features?.textContent).toContain('Preload fontsOff');
    expect(features?.textContent).toContain('Optimize Critical ImagesOn');
    expect(document.querySelector('[data-fdt-beacon-instructions-device]')?.textContent).toBe(
      'Desktop'
    );
    const selectors = document.querySelectorAll(
      '[data-fdt-beacon-instructions-list="elements"] li'
    );
    expect([...selectors].map((item) => item.textContent)).toEqual(['img', 'video', 'picture']);
  });

  it('opens the raw JSON with copy, carrying no request field', () => {
    renderCard(ready(REAL, 'p1'));
    fireEvent.click(toggle());
    expect(document.querySelector('[data-fdt-beacon-instructions-raw]')).toBeNull();
    expect(screen.getByRole('button', { name: new RegExp(COPY_SUBJECT) })).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: RAW_LABELS.show }));
    const raw = document.querySelector('[data-fdt-beacon-instructions-raw]');
    expect(raw?.textContent).toContain('"preconnect_external_domain_elements"');
    expect(raw?.textContent).not.toContain('nonce');
    expect(raw?.textContent).not.toContain('ajax_url');
    fireEvent.click(screen.getByRole('button', { name: RAW_LABELS.hide }));
    expect(document.querySelector('[data-fdt-beacon-instructions-raw]')).toBeNull();
  });

  it('follows a reload: the new load’s instructions replace the old, the view kept', () => {
    const { setState } = renderCard(ready(REAL, 'p1'));
    fireEvent.click(toggle());
    setState({
      status: 'refreshing',
      data: makeFdtData({ scriptSnapshotId: 'p1' }),
      requestedAt: 1
    });
    setState(ready({ ...REAL, isMobile: true, status: { atf: true } }, 'p2'));
    expect(card().dataset['fdtBeaconInstructions']).toBe('instructions');
    expect(document.querySelector('[data-fdt-beacon-instructions-summary]')?.textContent).toBe(
      '1 of 4 features on · Mobile'
    );
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
  });

  it('reads earlier instructions as no longer on the page, until dismissed', () => {
    const { setState, tracker } = renderCard(ready(REAL, 'p1'));
    setState(ready({ present: false, status: null, isMobile: null }, 'p2'));
    expect(card().dataset['fdtBeaconInstructions']).toBe('stale');
    expect(screen.getByText(STALE_INSTRUCTIONS_TITLE)).toBeTruthy();
    expect(screen.getByText(STALE_INSTRUCTIONS_COPY)).toBeTruthy();
    // The earlier load's details stay readable.
    expect(document.querySelector('[data-fdt-beacon-instructions-summary]')?.textContent).toBe(
      '3 of 4 features on · Desktop'
    );
    fireEvent.click(screen.getByRole('button', { name: 'Dismiss' }));
    expect(card().dataset['fdtBeaconInstructions']).toBe('none');
    expect(screen.getByText(NO_INSTRUCTIONS_COPY)).toBeTruthy();
    // A later load with instructions shows them again; losing those reads stale again.
    setState(ready(REAL, 'p3'));
    expect(tracker.state().kind).toBe('instructions');
    setState(ready({ present: false, status: null, isMobile: null }, 'p4'));
    expect(tracker.state().kind).toBe('stale');
  });

  it('copies the whole raw text when the raw view is cut, and says what it left out', async () => {
    const writes: string[] = [];
    // The copy control resolves `navigator.clipboard` at click time.
    Object.defineProperty(navigator, 'clipboard', {
      configurable: true,
      value: {
        writeText: (text: string) => {
          writes.push(text);
          return Promise.resolve();
        }
      }
    });
    const fonts = Array.from(
      { length: 500 },
      (_, index) => `font-${String(index)}-${'f'.repeat(120)}`
    );
    renderCard(ready({ ...REAL, preload_fonts_exclusions: fonts }, 'p1'));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: RAW_LABELS.show }));
    expect(
      document.querySelector('[data-fdt-beacon-instructions-list="preload_fonts_exclusions"]')
        ?.textContent
    ).toContain(hiddenEntriesNote(500 - LIST_DISPLAY_MAX));
    expect(screen.getByText(rawCutNote())).toBeTruthy();

    fireEvent.click(screen.getByRole('button', { name: new RegExp(`^${COPY_SUBJECT}`) }));
    await waitFor(() => {
      expect(writes).toHaveLength(1);
    });
    const copied = writes[0] ?? '';
    expect(copied.length).toBeGreaterThan(RAW_DISPLAY_MAX_CHARS);
    expect(JSON.parse(copied)).toMatchObject({ preload_fonts_exclusions: fonts });
  });

  it('stamps the payload’s load identity on the card root', () => {
    const { setState } = renderCard(ready(REAL, 'p1'));
    expect(card().dataset['fdtBeaconInstructionsLoad']).toBe('p1');
    setState(ready(REAL, 'p2'));
    expect(card().dataset['fdtBeaconInstructionsLoad']).toBe('p2');
    setState({ status: 'fetching' });
    expect(card().dataset['fdtBeaconInstructionsLoad']).toBeUndefined();
  });

  it('after an unreadable beacon, a page without one shows no older instructions', () => {
    const { setState } = renderCard(ready(REAL, 'p1'));
    setState(ready({ present: true, status: null, isMobile: null }, 'p2'));
    expect(card().dataset['fdtBeaconInstructions']).toBe('unreadable');
    setState(ready({ present: false, status: null, isMobile: null }, 'p3'));
    expect(card().dataset['fdtBeaconInstructions']).toBe('none');
  });

  it('keeps the expansion and raw view across a data refresh of the same load', () => {
    const { setState, tracker } = renderCard(ready(REAL, 'p1'));
    fireEvent.click(toggle());
    fireEvent.click(screen.getByRole('button', { name: RAW_LABELS.show }));
    setState({
      status: 'refreshing',
      data: makeFdtData({
        scriptSnapshotId: 'p1',
        wprDetections: { ...EMPTY_DETECTIONS, priority_elements_beacon: REAL }
      }),
      requestedAt: 1
    });
    setState(ready(REAL, 'p1'));
    expect(tracker.expanded()).toBe(true);
    expect(document.querySelector('[data-fdt-beacon-instructions-raw]')).not.toBeNull();
    expect(card().dataset['fdtBeaconInstructions']).toBe('instructions');
  });
});
