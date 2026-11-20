/**
 * One Detections entry's pure rules (evidence and note-line presence, icons
 * per verdict) and its anatomy: state cell (pill or the quiet "Off"), the
 * page link as the only control, the source chip's two scopes.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import Clock from 'lucide-solid/icons/clock';
import { STATUS_ICONS } from '../../../../components/ui/status-badge';
import { SOURCE_COPY } from '../../../../lib/detection/hud';
import type { StatusItem } from '../../../../lib/panel/detections-view-model';
import { ENTRY_ICONS, hasEvidence, hasNoteLine, SourceChip, StatusCard } from './status-card';

afterEach(() => {
  cleanup();
});

/** A row with just the given fields. */
function item(extra?: Partial<StatusItem>): StatusItem {
  return { id: 'delay_js', name: 'Delay JavaScript execution', status: 'active', ...extra };
}

describe('hasEvidence / hasNoteLine', () => {
  it('needs a shown source chip or a sentence', () => {
    expect(hasEvidence(item(), true)).toBe(false);
    expect(hasEvidence(item({ source: 'meta' }), true)).toBe(true);
    // A hidden chip (its group states it) is no evidence of its own.
    expect(hasEvidence(item({ source: 'meta' }), false)).toBe(false);
    expect(hasEvidence(item({ why: 'Waiting.' }), false)).toBe(true);
    expect(hasEvidence(item({ builder: { off: 'feature' } }), false)).toBe(true);
    expect(hasEvidence(item({ declaredOnly: 'Declared.' }), false)).toBe(true);
  });

  it('counts a subtitle as a note line too', () => {
    expect(hasNoteLine(item(), true)).toBe(false);
    expect(hasNoteLine(item({ subtitle: 'Version 2.0' }), false)).toBe(true);
    expect(hasNoteLine(item({ source: 'meta' }), true)).toBe(true);
    expect(hasNoteLine(item({ source: 'meta' }), false)).toBe(false);
  });
});

describe('ENTRY_ICONS', () => {
  it('reads collecting as a clock, the rest as the status vocabulary', () => {
    expect(ENTRY_ICONS).toEqual({
      active: STATUS_ICONS.ok,
      collecting: Clock,
      unknown: STATUS_ICONS.warn,
      'not-active': STATUS_ICONS.neutral
    });
  });
});

describe('StatusCard', () => {
  it('shows a pill for a state worth noticing and the quiet "Off" otherwise', () => {
    const { container } = render(() => (
      <>
        <StatusCard item={item({ status: 'collecting' })} now={0} />
        <StatusCard item={item({ id: 'minify_css', status: 'not-active' })} now={0} />
      </>
    ));
    const states = [...container.querySelectorAll<HTMLElement>('[data-fdt-card-state]')];
    expect(states.map((state) => state.dataset.fdtCardState)).toEqual(['collecting', 'not-active']);
    expect(states[0]?.querySelector('[data-fdt="status-badge"]')?.textContent).toBe('Collecting');
    expect(states[1]?.querySelector('[data-fdt="status-badge"]')).toBeNull();
    expect(states[1]?.textContent).toBe(', Off');
  });

  it('carries the page link as its only control, named with the row', () => {
    const { container } = render(() => <StatusCard item={item()} linkTo="javascript" now={0} />);
    const row = container.querySelector<HTMLElement>('[data-fdt="status-card"]');
    expect(row?.tagName).toBe('DIV');
    const controls = row?.querySelectorAll('a, button, [tabindex]');
    expect(controls).toHaveLength(1);
    const link = row?.querySelector('a[data-fdt-card-link]');
    expect(link?.getAttribute('href')).toBe('#/javascript');
    expect(link?.textContent).toBe('Open JavaScript, Delay JavaScript execution');
  });

  it('hides its own source chip on request, keeping the source hook', () => {
    const { container } = render(() => (
      <StatusCard item={item({ source: 'meta' })} now={0} showSource={false} />
    ));
    const row = container.querySelector<HTMLElement>('[data-fdt="status-card"]');
    expect(row?.dataset.fdtCardSourceKind).toBe('meta');
    expect(row?.querySelector('[data-fdt-card-source]')).toBeNull();
    expect(row?.querySelector('[data-fdt-card-evidence]')).toBeNull();
  });
});

describe('SourceChip', () => {
  it('words a row chip and a group norm chip apart', () => {
    const { container } = render(() => (
      <>
        <SourceChip copy={SOURCE_COPY.meta} />
        <SourceChip copy={SOURCE_COPY.meta} scope="group" />
      </>
    ));
    const own = container.querySelector<HTMLElement>('[data-fdt-card-source]');
    const norm = container.querySelector<HTMLElement>('[data-fdt-group-source]');
    expect(own?.title).toBe(SOURCE_COPY.meta.tooltip);
    expect(norm?.title).toBe(`${SOURCE_COPY.meta.tooltip} Applies to every row here.`);
    expect(norm?.hasAttribute('data-fdt-card-source')).toBe(false);
  });
});
