/** The state-chip renderer: each chip's source look (icon + treatment) and title, the "+N" chip, no tab stops. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { StateChips } from './state-chip-list';
import { NO_STATE_CHIPS, splitStateChips, type StateChip } from './state-chips';

afterEach(cleanup);

const CHIPS: StateChip[] = [
  { id: 'excluded', label: 'Excluded', source: 'excluded', title: 'Excluded by FDT from X' },
  { id: 'delayed', label: 'Delayed', source: 'simulated', title: 'Delayed by the simulation' },
  { id: 'deferred', label: 'Deferred', source: 'page' },
  { id: 'minified', label: 'Minified', source: 'wp-rocket', title: 'Minified by WP Rocket (X)' },
  { id: 'c', label: 'C', source: 'page' }
];

/** The rendered visible chips' hook spans. */
function chipHooks(container: HTMLElement): HTMLElement[] {
  return [...container.querySelectorAll<HTMLElement>('[data-fdt="state-chip"]')];
}

/** The badge inside one chip hook. */
function badgeOf(hook: HTMLElement | undefined): HTMLElement | null | undefined {
  return hook?.querySelector<HTMLElement>('[data-fdt="badge"]');
}

describe('StateChips', () => {
  it('renders nothing for a row without states', () => {
    const { container } = render(() => <StateChips chips={NO_STATE_CHIPS} />);
    expect(container.textContent).toBe('');
  });

  it('renders the visible chips in order with one-word text, their source and title, then "+N"', () => {
    const { container } = render(() => <StateChips chips={splitStateChips(CHIPS)} />);
    const chips = chipHooks(container);
    expect(chips.map((chip) => chip.dataset.fdtState)).toEqual(['excluded', 'delayed', 'deferred']);
    expect(chips.map((chip) => chip.dataset.fdtSource)).toEqual(['excluded', 'simulated', 'page']);
    // The source rides on icon + treatment; the words stay the state's one word.
    expect(chips.map((chip) => chip.textContent)).toEqual(['Excluded', 'Delayed', 'Deferred']);
    expect(badgeOf(chips[0])?.getAttribute('title')).toBe('Excluded by FDT from X');
    expect(badgeOf(chips[2])?.hasAttribute('title')).toBe(false);
    const overflow = container.querySelector('[data-fdt="state-chip-overflow"] [data-fdt="badge"]');
    expect(overflow?.textContent).toBe('+2');
    expect(overflow?.getAttribute('title')).toBe('Also: Minified (WP Rocket), C (page)');
  });

  it.each([
    // [source, treatment classes present, classes absent, has an icon]
    ['wp-rocket', ['bg-status-info-soft', 'text-status-info'], ['border'], true],
    [
      'simulated',
      ['border-dashed', 'border-current', 'text-status-info'],
      ['bg-status-info-soft'],
      true
    ],
    ['excluded', ['bg-status-warn-soft', 'text-status-warn'], ['border'], true],
    [
      'page',
      ['border-line-2', 'text-status-neutral'],
      ['border-dashed', 'bg-status-neutral-soft'],
      false
    ]
  ] as const)(
    'draws a %s chip by icon + treatment, never color alone',
    (source, has, lacks, icon) => {
      const { container } = render(() => (
        <StateChips chips={splitStateChips([{ id: 's', label: 'State', source }])} />
      ));
      const badge = badgeOf(chipHooks(container)[0]);
      const classes = badge?.className.split(/\s+/) ?? [];
      for (const name of has) expect(classes, `${source} has ${name}`).toContain(name);
      for (const name of lacks) expect(classes, `${source} lacks ${name}`).not.toContain(name);
      const svg = badge?.querySelector('svg');
      expect(svg !== null && svg !== undefined).toBe(icon);
      if (icon) expect(svg?.getAttribute('aria-hidden')).toBe('true');
    }
  );

  it('draws each source with its own icon', () => {
    const { container } = render(() => (
      <StateChips
        chips={splitStateChips([
          { id: 'a', label: 'A', source: 'wp-rocket' },
          { id: 'b', label: 'B', source: 'simulated' },
          { id: 'c', label: 'C', source: 'excluded' }
        ])}
      />
    ));
    const icons = chipHooks(container).map(
      (hook) => badgeOf(hook)?.querySelector('svg')?.classList
    );
    expect(icons.map((list) => list?.contains('lucide-rocket'))).toEqual([true, false, false]);
    expect(icons.map((list) => list?.contains('lucide-flask-conical'))).toEqual([
      false,
      true,
      false
    ]);
    expect(icons.map((list) => list?.contains('lucide-ban'))).toEqual([false, false, true]);
  });

  it('shows the rocket on "+N" in WP Rocket\'s tone only when it hides a WP Rocket chip', () => {
    const { container: hides } = render(() => <StateChips chips={splitStateChips(CHIPS)} />);
    const hiding = hides.querySelector<HTMLElement>('[data-fdt="state-chip-overflow"]');
    expect(hiding?.hasAttribute('data-fdt-hides-wp-rocket')).toBe(true);
    const hidingBadge = hiding?.querySelector('[data-fdt="badge"]');
    expect(hidingBadge?.className).toContain('text-status-info');
    expect(hidingBadge?.querySelector('svg')?.classList.contains('lucide-rocket')).toBe(true);
    cleanup();

    const plain: StateChip[] = CHIPS.map((chip) => ({ ...chip, source: 'page' }));
    const { container } = render(() => <StateChips chips={splitStateChips(plain)} />);
    const overflow = container.querySelector<HTMLElement>('[data-fdt="state-chip-overflow"]');
    expect(overflow?.hasAttribute('data-fdt-hides-wp-rocket')).toBe(false);
    const badge = overflow?.querySelector('[data-fdt="badge"]');
    expect(badge?.className).toContain('text-status-neutral');
    expect(badge?.querySelector('svg')).toBeNull();
    expect(badge?.textContent).toBe('+2');
  });

  it('is non-interactive: no button, no tab stop', () => {
    const { container } = render(() => <StateChips chips={splitStateChips(CHIPS)} />);
    expect(container.querySelector('button, [tabindex]')).toBeNull();
  });
});
