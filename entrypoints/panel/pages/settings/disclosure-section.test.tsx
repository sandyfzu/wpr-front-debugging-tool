/** The shared settings disclosure: heading button, page hooks, summary + problem, open state. */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { createSignal } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { STATUS_TEXT_CLASSES } from '../../../../components/ui/status-badge';
import type { SectionSummary } from '../../../../lib/panel/section-summary';
import { DisclosureSection, sectionBodyId } from './disclosure-section';

afterEach(() => {
  cleanup();
});

/** Render one section on signals; the toggle flips the open signal. */
function renderSection(summary: SectionSummary, initiallyOpen = false) {
  const [open, setOpen] = createSignal(initiallyOpen);
  const [words, setWords] = createSignal(summary);
  render(() => (
    <DisclosureSection
      page="tool"
      section="request"
      title="Request"
      summary={words()}
      open={open()}
      onOpenChange={setOpen}
    >
      <label>
        Field
        <input />
      </label>
    </DisclosureSection>
  ));
  const toggle = () => {
    const button = document.querySelector<HTMLButtonElement>('[data-fdt-tool-section-toggle]');
    if (button === null) throw new Error('no toggle');
    return button;
  };
  return { open, setOpen, setWords, toggle };
}

describe('sectionBodyId', () => {
  it('scopes the body id by page and section', () => {
    expect(sectionBodyId('rucss', 'keep')).toBe('rucss-section-keep');
    expect(sectionBodyId('beacon', 'aboveTheFold')).toBe('beacon-section-aboveTheFold');
  });
});

describe('DisclosureSection', () => {
  it('is an h3 holding the disclosure button, under the page’s hooks', () => {
    const { toggle } = renderSection({ text: 'Desktop', problem: null });
    const heading = screen.getByRole('heading', { level: 3 });
    expect(heading.contains(toggle())).toBe(true);
    expect(document.querySelector('[data-fdt-tool-section="request"]')).not.toBeNull();
    expect(toggle().getAttribute('aria-controls')).toBe('tool-section-request');
    expect(toggle().getAttribute('aria-expanded')).toBe('false');
    expect(toggle().querySelector('[data-fdt-tool-section-summary]')?.textContent).toBe('Desktop');
    expect(toggle().querySelector('[data-fdt-tool-section-problem]')).toBeNull();
    expect(screen.queryByLabelText('Field')).toBeNull();
  });

  it('opens and folds its body, turning the chevron', () => {
    const { toggle, open } = renderSection({ text: '', problem: null });
    fireEvent.click(toggle());
    expect(open()).toBe(true);
    expect(toggle().getAttribute('aria-expanded')).toBe('true');
    expect(toggle().querySelector('svg')?.getAttribute('class')).toContain('rotate-90');
    expect(
      document.getElementById('tool-section-request')?.contains(screen.getByLabelText('Field'))
    ).toBe(true);
    fireEvent.click(toggle());
    expect(open()).toBe(false);
    expect(screen.queryByLabelText('Field')).toBeNull();
  });

  it('shows the problem in the error tone, live, folded or open', () => {
    const { toggle, setWords } = renderSection({ text: 'Desktop', problem: null });
    setWords({ text: 'Desktop', problem: '1 invalid value' });
    const problem = toggle().querySelector('[data-fdt-tool-section-problem]');
    expect(problem?.textContent).toBe('1 invalid value');
    expect(problem?.className).toBe(STATUS_TEXT_CLASSES.error);
    setWords({ text: 'Desktop', problem: null });
    expect(toggle().querySelector('[data-fdt-tool-section-problem]')).toBeNull();
  });
});
