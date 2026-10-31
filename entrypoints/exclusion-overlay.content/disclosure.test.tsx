/**
 * The note disclosure as rendered: nothing without lines, collapsed by
 * default, toggled in place, its label counting the lines, and collapsed
 * again when its lines come back after none.
 */
import { createSignal } from 'solid-js';
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { SIMULATION_LANE_COPY, type NoteText } from './copy';
import { NoteDisclosure } from './disclosure';

afterEach(cleanup);

const LINES: readonly NoteText[] = [['First limit.'], ['Second: ', { code: 'a.js' }]];

/** The disclosure's toggle (throws when absent). */
const toggle = (): HTMLElement => screen.getByRole('button', { name: /limits?$/ });

describe('NoteDisclosure', () => {
  it('renders nothing without lines', () => {
    render(() => <NoteDisclosure id="l" label={SIMULATION_LANE_COPY.limits} lines={[]} />);
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('starts collapsed, opens onto the lines and closes again', () => {
    render(() => <NoteDisclosure id="l" label={SIMULATION_LANE_COPY.limits} lines={LINES} />);
    expect(toggle().textContent).toBe('2 limits');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().hasAttribute('aria-controls')).toBe(false);
    expect(document.getElementById('l')).toBeNull();

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().getAttribute('aria-controls')).toBe('l');
    const items = [...document.querySelectorAll('#l .xo-note-disclosure-item')].map(
      (li) => li.textContent
    );
    expect(items).toEqual(['First limit.', 'Second: a.js']);

    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('l')).toBeNull();
  });

  it('comes back collapsed when its lines return after none', () => {
    const [lines, setLines] = createSignal<readonly NoteText[]>(LINES);
    render(() => <NoteDisclosure id="l" label={SIMULATION_LANE_COPY.limits} lines={lines()} />);
    fireEvent.click(toggle());
    expect(toggle().getAttribute('aria-expanded')).toBe('true');

    setLines([]);
    expect(screen.queryByRole('button')).toBeNull();

    setLines([['Only limit.']]);
    expect(toggle().textContent).toBe('1 limit');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(document.getElementById('l')).toBeNull();
  });

  it('stays open while its lines change but never empty', () => {
    const [lines, setLines] = createSignal<readonly NoteText[]>(LINES);
    render(() => <NoteDisclosure id="l" label={SIMULATION_LANE_COPY.limits} lines={lines()} />);
    fireEvent.click(toggle());
    setLines([['Only limit.']]);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelector('#l .xo-note-disclosure-item')?.textContent).toBe('Only limit.');
  });
});
