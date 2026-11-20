/**
 * Render tests for the card — surface levels, the header/footer slots, and
 * their hairlines. Class-level assertions pin the token wiring only.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { Card, CARD_LOOK_CLASSES, CARD_LOOKS } from './card';

afterEach(() => {
  cleanup();
});

/** The card's body element, found through its test hook. */
function bodyElement(): HTMLElement {
  const body = document.querySelector<HTMLElement>('[data-fdt="card-body"]');
  if (!body) throw new Error('card body missing');
  return body;
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

describe('Card', () => {
  it('renders the body on the level surface with the matching line', () => {
    render(() => <Card>Content</Card>);
    const card = bodyElement().parentElement;
    expect(card?.dataset.fdt).toBe('card');
    // Level 1 (default): the raised card — brightest surface, quietest line.
    expect(card?.className).toContain('bg-surface-2');
    expect(card?.className).toContain('border-line-1');
  });

  it('raises the default card: 8 px corner, border, first elevation shadow', () => {
    render(() => <Card>Content</Card>);
    const tokens = (bodyElement().parentElement?.className ?? '').split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['rounded-lg', 'border', 'bg-surface-2', 'shadow-elev-1'])
    );
    expect(tokens).not.toContain('rounded-md');
    expect(tokens).not.toContain('border-dashed');
    expect(tokens).toEqual(expect.arrayContaining(CARD_LOOK_CLASSES.raised.split(' ')));
  });

  it('draws the placeholder look as a dashed outline on the canvas, never raised', () => {
    render(() => <Card look="placeholder">Nothing yet</Card>);
    const tokens = (bodyElement().parentElement?.className ?? '').split(/\s+/);
    expect(tokens).toEqual(
      expect.arrayContaining(['rounded-lg', 'border', 'border-dashed', 'bg-surface-0'])
    );
    // The placeholder's canvas fill replaces the level fill; no shadow lifts it.
    expect(tokens).not.toContain('bg-surface-2');
    expect(tokens.filter((token) => token.startsWith('shadow'))).toEqual([]);
    // The level's line stays (a dashed line in the level's quiet color).
    expect(tokens).toContain('border-line-1');
  });

  it('declares one class string per look, each a distinct registry row', () => {
    expect(Object.keys(CARD_LOOK_CLASSES)).toEqual([...CARD_LOOKS]);
    expect(new Set(Object.values(CARD_LOOK_CLASSES)).size).toBe(CARD_LOOKS.length);
  });

  it('lets caller classes win over the level and the look', () => {
    render(() => (
      <Card look="placeholder" class="bg-surface-1">
        Content
      </Card>
    ));
    const tokens = (bodyElement().parentElement?.className ?? '').split(/\s+/);
    expect(tokens).toContain('bg-surface-1');
    expect(tokens).not.toContain('bg-surface-0');
  });

  it('level selection switches the surface/line pair', () => {
    render(() => <Card level={3}>Content</Card>);
    const card = bodyElement().parentElement;
    expect(card?.className).toContain('bg-surface-3');
    expect(card?.className).toContain('border-line-3');
  });

  it('renders header and footer slots inside their hairlines', () => {
    render(() => (
      <Card header="Headers & Cookies" footer={<button type="button">Copy report</button>}>
        Content
      </Card>
    ));
    // A text-only slot resolves to the slot element itself.
    const header = screen.getByText('Headers & Cookies');
    expect(header.dataset.fdt).toBe('card-header');
    expect(header.className).toContain('border-b');
    expect(header.className).toContain('border-line-1');
    const footer = screen.getByText('Copy report').closest('[data-fdt=card-footer]');
    expect(footer?.className).toContain('border-t');
  });

  it('builds the header and footer slots exactly once', () => {
    const header = creationProbe();
    const footer = creationProbe();
    render(() => (
      <Card header={<header.Probe />} footer={<footer.Probe />}>
        Content
      </Card>
    ));
    expect(header.count()).toBe(1);
    expect(footer.count()).toBe(1);
    expect(document.querySelectorAll('[data-probe]')).toHaveLength(2);
  });
});
