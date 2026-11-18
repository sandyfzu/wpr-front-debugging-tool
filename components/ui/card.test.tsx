/**
 * Render tests for the card — surface levels, the header/footer slots, and
 * their hairlines. Class-level assertions pin the token wiring only.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, describe, expect, it } from 'vitest';
import { Card } from './card';

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
    expect(card?.className).toContain('bg-surface-1');
    expect(card?.className).toContain('border-line-1');
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
