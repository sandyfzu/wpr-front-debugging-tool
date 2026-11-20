/**
 * Render test for the skeleton placeholder: a pulsing block sized by its
 * classes, rendered for real waits only (usage contract, UX-D6).
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { Skeleton } from './skeleton';

afterEach(() => {
  cleanup();
});

describe('Skeleton', () => {
  it('renders a pulsing block sized by its classes', () => {
    render(() => <Skeleton class="h-3 w-32" />);
    const skeleton = document.querySelector<HTMLElement>('[data-fdt="skeleton"]');
    expect(skeleton).toBeTruthy();
    expect(skeleton?.className).toContain('animate-pulse');
    expect(skeleton?.className).toContain('bg-surface-4');
    expect(skeleton?.className).toContain('h-3');
  });

  it('carries the motion-token pulse class, neutralized by reduced motion globally', () => {
    // The token stylesheet drops every animation (`animation-name: none`)
    // under `prefers-reduced-motion`; the component only contributes the class.
    render(() => <Skeleton />);
    expect(document.querySelector('[data-fdt="skeleton"]')?.className).toContain('animate-pulse');
  });
});
