/**
 * Render tests for the stat tile: the label/value anatomy, the optional icon,
 * media, supporting line and link slots, the value roles and tones, and the
 * card staying non-interactive (only the inner link takes focus, with the
 * shared focus ring).
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import Database from 'lucide-solid/icons/database';
import { FOCUS_RING } from './classes';
import { ScoreRing } from './score-ring';
import {
  STAT_TILE_TONE_CLASSES,
  STAT_TILE_VALUE_CLASSES,
  StatTile,
  type StatTileTone
} from './stat-tile';
import { STATUS_KINDS } from './status-badge';

afterEach(() => {
  cleanup();
});

/** The element behind a `data-fdt` hook (throws when absent). */
function hook(name: string): HTMLElement {
  const element = document.querySelector<HTMLElement>(`[data-fdt="${name}"]`);
  if (!element) throw new Error(`${name} missing`);
  return element;
}

/** Whether a `data-fdt` hook is rendered. */
function has(name: string): boolean {
  return document.querySelector(`[data-fdt="${name}"]`) !== null;
}

/** Elements that can take keyboard focus inside the rendered tree. */
function focusables(): Element[] {
  return [...document.querySelectorAll('a[href], button, input, select, textarea, [tabindex]')];
}

/**
 * A slot probe that counts its own creations, to prove each slot is built once.
 *
 * @returns The probe and a reader of how many times it was created.
 */
function creationProbe(): { Probe: () => JSX.Element; count: () => number } {
  let created = 0;
  return {
    Probe: () => {
      created += 1;
      return <span data-probe />;
    },
    count: () => created
  };
}

describe('StatTile', () => {
  it('renders the label and the value on a card, with no optional slot', () => {
    render(() => <StatTile label="Stack">WordPress 7.1.3</StatTile>);
    expect(hook('stat-tile').closest('[data-fdt="card"]')).not.toBeNull();
    expect(hook('stat-tile-label').textContent).toBe('Stack');
    expect(hook('stat-tile-value').textContent).toBe('WordPress 7.1.3');
    expect(hook('stat-tile-label').querySelector('svg')).toBeNull();
    for (const slot of ['stat-tile-media', 'stat-tile-sub', 'stat-tile-link']) {
      expect(has(slot)).toBe(false);
    }
  });

  it('defaults to the tile value role in the primary tone', () => {
    render(() => <StatTile label="WP Rocket">3.24.1</StatTile>);
    const value = hook('stat-tile-value').className;
    expect(value).toContain('text-tile');
    expect(value).toContain('font-semibold');
    expect(value).toContain('text-fg-primary');
    expect(value).toContain('tabular-nums');
  });

  it('keeps the stat size beside a status tone (no class dropped as a conflict)', () => {
    render(() => (
      <StatTile label="Optimizations" valueRole="stat" valueTone="ok">
        4
      </StatTile>
    ));
    const value = hook('stat-tile-value').className.split(/\s+/u);
    expect(value).toEqual(expect.arrayContaining(['text-stat', 'text-status-ok']));
    expect(value).not.toContain('text-tile');
    expect(value).not.toContain('text-fg-primary');
  });

  it('maps every tone to one token text class, status kinds through the vocabulary', () => {
    const tones: StatTileTone[] = ['primary', 'muted', 'accent', ...STATUS_KINDS];
    expect(Object.keys(STAT_TILE_TONE_CLASSES).sort()).toEqual([...tones].sort());
    for (const tone of tones) expect(STAT_TILE_TONE_CLASSES[tone]).toMatch(/^text-[a-z-]+$/u);
    expect(STAT_TILE_TONE_CLASSES.warn).toBe('text-status-warn');
    expect(STAT_TILE_VALUE_CLASSES).toEqual({
      stat: 'text-stat font-semibold',
      tile: 'text-tile font-semibold'
    });
  });

  it('leads the label with a decorative icon in the muted tone, or the given one', () => {
    render(() => (
      <>
        <StatTile label="Page cache" icon={Database}>
          Hit
        </StatTile>
        <StatTile label="Page cache" icon={Database} iconTone="warn">
          Not proven
        </StatTile>
      </>
    ));
    const icons = [...document.querySelectorAll('[data-fdt="stat-tile-label"] svg')];
    expect(icons).toHaveLength(2);
    for (const icon of icons) expect(icon.getAttribute('aria-hidden')).toBe('true');
    expect(icons[0]?.getAttribute('class')).toContain('text-fg-muted');
    expect(icons[1]?.getAttribute('class')).toContain('text-status-warn');
    for (const icon of icons) {
      expect(icon.getAttribute('width')).toBe('14');
      expect(icon.getAttribute('height')).toBe('14');
    }
  });

  it('renders the supporting line under the value in the muted meta style', () => {
    render(() => (
      <StatTile label="Stack" sub="Apache 2.4.69 · PHP 8.4.27">
        WordPress 7.1.3
      </StatTile>
    ));
    const sub = hook('stat-tile-sub');
    expect(sub.textContent).toBe('Apache 2.4.69 · PHP 8.4.27');
    expect(sub.className).toContain('text-2xs');
    expect(sub.className).toContain('text-fg-muted');
    // Order: label, value, sub.
    expect(hook('stat-tile-value').nextElementSibling).toBe(sub);
  });

  it('places a media slot (the score ring) beside the text column', () => {
    render(() => (
      <StatTile
        label="Optimizations"
        valueRole="stat"
        media={<ScoreRing segments={[]} total={0} />}
      >
        4
      </StatTile>
    ));
    const media = hook('stat-tile-media');
    expect(media.querySelector('[data-fdt="score-ring"]')).not.toBeNull();
    expect(media.className).toContain('shrink-0');
    expect(media.nextElementSibling?.contains(hook('stat-tile-label'))).toBe(true);
  });

  it('builds each JSX slot exactly once', () => {
    const media = creationProbe();
    const sub = creationProbe();
    render(() => (
      <StatTile label="Optimizations" media={<media.Probe />} sub={<sub.Probe />}>
        4
      </StatTile>
    ));
    expect(media.count()).toBe(1);
    expect(sub.count()).toBe(1);
    expect(hook('stat-tile-media').querySelectorAll('[data-probe]')).toHaveLength(1);
    expect(hook('stat-tile-sub').querySelectorAll('[data-probe]')).toHaveLength(1);
  });

  it('renders the link as the only interactive element, with the shared focus ring', () => {
    render(() => (
      <StatTile label="Page cache" link={{ href: '#/headers', label: 'Check headers' }}>
        Not proven
      </StatTile>
    ));
    const link = screen.getByRole('link', { name: 'Check headers' });
    expect(link.dataset.fdt).toBe('stat-tile-link');
    expect(link.getAttribute('href')).toBe('#/headers');
    for (const ring of FOCUS_RING.split(' ')) expect(link.className).toContain(ring);
    // The 24 px hit floor, sized to its text (never the whole tile width).
    expect(link.className).toContain('min-h-6');
    expect(link.className).toContain('self-start');
    // Accent text, underlined only on hover.
    expect(link.className.split(/\s+/u)).toEqual(
      expect.arrayContaining(['text-accent', 'no-underline', 'hover:underline'])
    );
    expect(link.querySelector('span')?.textContent).toBe('Check headers');
    expect(link.querySelector('svg')?.getAttribute('aria-hidden')).toBe('true');
    expect(focusables()).toEqual([link]);
    link.focus();
    expect(document.activeElement).toBe(link);
  });

  it('keeps the card itself non-interactive: no link, tab stop, cursor or hover', () => {
    render(() => (
      <StatTile label="Page cache" link={{ href: '#/headers', label: 'Check headers' }}>
        Not proven
      </StatTile>
    ));
    const card = hook('card');
    expect(card.tagName).toBe('DIV');
    expect(card.closest('a')).toBeNull();
    for (const element of [card, ...card.querySelectorAll('*')]) {
      if (element.closest('a')) continue;
      expect(element.hasAttribute('tabindex')).toBe(false);
      const classes = element.getAttribute('class') ?? '';
      expect(classes).not.toMatch(/(^|\s)(hover:|cursor-)/u);
    }
  });

  it('has no focusable element without a link', () => {
    render(() => <StatTile label="Stack">WordPress</StatTile>);
    expect(focusables()).toEqual([]);
  });

  it('lets long values and labels wrap inside the tile instead of overflowing', () => {
    render(() => (
      <StatTile label="Stack" sub="x" link={{ href: '#/a', label: 'Open' }}>
        WordPress
      </StatTile>
    ));
    expect(hook('stat-tile').className).toContain('min-w-0');
    for (const name of ['stat-tile-value', 'stat-tile-sub']) {
      expect(hook(name).className).toContain('min-w-0');
      expect(hook(name).className).toContain('wrap-break-word');
    }
    const labelText = hook('stat-tile-label').querySelector(':scope > span');
    expect(labelText?.textContent).toBe('Stack');
    expect(labelText?.className.split(/\s+/u)).toEqual(['min-w-0', 'wrap-break-word']);
    expect(hook('stat-tile-link').querySelector('span')?.className).toContain('wrap-break-word');
  });

  it('merges extra classes onto the card frame', () => {
    render(() => (
      <StatTile label="Optimizations" class="col-span-2">
        4
      </StatTile>
    ));
    expect(hook('card').className).toContain('col-span-2');
    expect(hook('card').className).toContain('min-w-0');
  });
});
