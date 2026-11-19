/** The detail building blocks: the facts list (mono, multi-line, none) and the titled code section. */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { CodeSection, FactList } from './detail-section';

afterEach(() => {
  cleanup();
});

describe('FactList', () => {
  it('renders each fact as a label/value pair, mono and multi-line only when asked', () => {
    const { container } = render(() => (
      <FactList
        hook="facts"
        facts={[
          { label: 'Kind', value: 'img', mono: true },
          { label: 'Note', value: 'plain words', mono: false },
          { label: '<source> 1', value: 'srcset: a.avif\nmedia: (x)', mono: true, multiline: true }
        ]}
      />
    ));
    const list = container.querySelector('[data-fdt="facts"]');
    expect([...(list?.querySelectorAll('dt') ?? [])].map((dt) => dt.textContent)).toEqual([
      'Kind',
      'Note',
      '<source> 1'
    ]);
    const values = [...(list?.querySelectorAll('dd') ?? [])];
    expect(values.map((dd) => dd.className.includes('font-mono'))).toEqual([true, false, true]);
    expect(values.map((dd) => dd.className.includes('whitespace-pre-line'))).toEqual([
      false,
      false,
      true
    ]);
    expect(values[2]?.textContent).toBe('srcset: a.avif\nmedia: (x)');
  });

  it('renders nothing without facts', () => {
    const { container } = render(() => <FactList hook="facts" facts={[]} />);
    expect(container.querySelector('[data-fdt="facts"]')).toBeNull();
  });
});

describe('CodeSection', () => {
  it('titles its body, with the muted aside only when given', () => {
    const { container } = render(() => (
      <CodeSection title="Code" aside="3 lines" hook="code">
        <p>body</p>
      </CodeSection>
    ));
    const section = container.querySelector('[data-fdt="code"]');
    expect(section?.querySelector('h3')?.textContent).toBe('Code3 lines');
    expect(section?.querySelector('p')?.textContent).toBe('body');
    cleanup();
    const bare = render(() => (
      <CodeSection title="Code" hook="code">
        <p>body</p>
      </CodeSection>
    ));
    expect(bare.container.querySelector('h3')?.textContent).toBe('Code');
  });
});
