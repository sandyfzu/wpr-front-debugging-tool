/**
 * The route-switch focus rule at the unit level: the body's own h1 becomes
 * program-focusable and receives focus on a ready page; the skeleton and
 * error bodies (no h1) are skipped — the move is genuinely absent, never a
 * fallthrough.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { ROUTE_HEADING_SELECTOR, focusRouteHeading } from './focus';

/** One ready page body (what the shell's Dynamic renders). */
function readyBody(): { section: HTMLElement; heading: HTMLElement } {
  const section = document.createElement('section');
  section.setAttribute('data-fdt-page', 'detections');
  const heading = document.createElement('h1');
  heading.textContent = 'Detections';
  section.append(heading);
  document.body.append(section);
  return { section, heading };
}

/** One skeleton body (the fetching state): a body root, no h1. */
function skeletonBody(): HTMLElement {
  const section = document.createElement('section');
  section.setAttribute('data-fdt-page', 'fetching');
  document.body.append(section);
  return section;
}

afterEach(() => {
  document.body.innerHTML = '';
});

describe('focusRouteHeading', () => {
  it("focuses the ready body's heading (the selector pins itself)", () => {
    // Also pins the selector: the same '[data-fdt-page] h1' shape the real
    // bodies render.
    expect(ROUTE_HEADING_SELECTOR).toBe('[data-fdt-page] h1');
    const { heading } = readyBody();
    focusRouteHeading();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1');
  });

  it('keeps an already-declared tabindex and skips nothing else', () => {
    const { heading } = readyBody();
    heading.setAttribute('tabindex', '-1');
    focusRouteHeading();
    expect(document.activeElement).toBe(heading);
    expect(heading.getAttribute('tabindex')).toBe('-1'); // exactly one attribute write path
  });

  it('is a no-op on the skeleton body (no heading — the deliberate skip)', () => {
    skeletonBody();
    const focused = document.createElement('button');
    document.body.append(focused);
    focused.focus();
    focusRouteHeading();
    expect(document.activeElement).toBe(focused); // focus never moved
  });

  it('is a no-op on an empty document (the error/error-card branch)', () => {
    focusRouteHeading();
    expect(document.activeElement).toBe(document.body);
  });
});
