/**
 * Render tests for the recursive JSON renderer: primitives inline, collapse
 * with count badges, the search-query contract (marks + auto-expand) and the
 * structural plumbing (keys, brackets).
 */
import { cleanup, fireEvent, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { JsonValue } from './json-value';

afterEach(() => {
  cleanup();
});

/** Guard for indexed reads (noUncheckedIndexedAccess): branch, never crash. */
function throwAt(index: number): never {
  throw new Error(`Element at index ${String(index)} missing from the rendered tree`);
}

/** The toggle buttons of the rendered tree, in order. */
const toggles = (): HTMLElement[] =>
  Array.from(document.querySelectorAll<HTMLElement>('[data-fdt-json-toggle]'));

describe('JsonValue — primitives', () => {
  it('renders scalars inline as document text (types visually distinct)', () => {
    render(() => (
      <div>
        <JsonValue value={42} keyName="score" data-fdt-n="num" />
        <JsonValue value={true} keyName="ok" data-fdt-n="bool" />
        <JsonValue value={'https://example.org'} keyName="url" data-fdt-n="str" />
        <JsonValue value={null} keyName="none" data-fdt-n="null" />
        <JsonValue value={undefined} data-fdt-n="undef" />
      </div>
    ));
    const scalarOf = (hook: string): string | null | undefined =>
      document.querySelector(`[data-fdt-n="${hook}"] [data-fdt-json-scalar]`)?.textContent;
    // Strings keep their quotes — that is part of the data's shape.
    expect(scalarOf('num')).toBe('42');
    expect(scalarOf('bool')).toBe('true');
    expect(scalarOf('str')).toBe('"https://example.org"');
    expect(scalarOf('null')).toBe('null');
    expect(scalarOf('undef')).toBe('undefined');
    // The key renders with its muted term + colon separator.
    expect(screen.getByText('score')).toBeTruthy();
    expect(document.querySelector('[data-fdt-n="num"] [data-fdt-json-key]')?.textContent).toContain(
      'score'
    );
  });

  it('renders empty containers inline as their brackets', () => {
    render(() => (
      <div>
        <JsonValue value={{}} keyName="flags" />
        <JsonValue value={[]} data-fdt-empty />
      </div>
    ));
    expect(screen.getByText('{}')).toBeTruthy();
    expect(screen.getByText('[]')).toBeTruthy();
    expect(document.querySelector('[data-fdt-json-toggle]')).toBeNull();
  });
});

describe('JsonValue — collapse & counts', () => {
  it('renders arrays/objects collapsed under count badges and expands via toggle', () => {
    render(() => <JsonValue value={[1, 2, 3]} defaultCollapsed />);
    const toggle = toggles()[0];
    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(toggle?.querySelector('[data-fdt-json-count]')?.textContent).toContain('3 items');
    expect(document.querySelector('[data-fdt-json-children]')).toBeNull();
    fireEvent.click(toggle as HTMLElement);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    // Children render, each a JsonValue node with its own scalar form.
    expect(document.querySelectorAll('[data-fdt-json-children] [data-fdt-json-node]').length).toBe(
      3
    );
    expect(toggles()).toHaveLength(1); // scalars never render toggles.
  });

  it('counts object entries as keys', () => {
    render(() => <JsonValue value={{ a: 1, b: 'x' }} defaultCollapsed />);
    const toggle = toggles()[0];
    expect(toggle?.querySelector('[data-fdt-json-count]')?.textContent).toContain('2 keys');
    // Container bracket marks are decorative (aria-hidden), with a name hook.
    expect(toggle?.querySelector('[data-fdt-json-bracket]')?.textContent).toBe('{');
  });

  it('defaults to expanded (no defaultCollapsed passed)', () => {
    render(() => <JsonValue value={{ a: { b: 1 } }} />);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true');
    expect(document.querySelectorAll('[data-fdt-json-node]').length).toBe(3); // root + a + 1
  });

  it('collapses nested containers independently', () => {
    const { container } = render(() => <JsonValue value={{ outer: { inner: [1, 2] } }} />);
    const [rootToggle, outerToggle, innerToggle] = toggles();
    fireEvent.click(innerToggle as HTMLElement);
    // The deepest container collapsed; its ancestors kept their own state.
    expect(innerToggle?.getAttribute('aria-expanded')).toBe('false');
    expect(outerToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rootToggle?.getAttribute('aria-expanded')).toBe('true');
    // Children spans: the root's and the outer's — the inner's is gone (it
    // collapsed), and the outer's still names its own child plus the closing brace.
    const childrenSpans = Array.from(container.querySelectorAll('[data-fdt-json-children]'));
    expect(childrenSpans.length).toBe(2);
    expect(childrenSpans[1]?.querySelector('[data-fdt-json-children]')).toBeNull();
    expect(childrenSpans[1]?.textContent).toContain('inner');
  });
});

describe('JsonValue — search contract', () => {
  it('marks matching scalar text (case-insensitive) and forces matched branches open', () => {
    // 'allcached' is in the collapsed tree — must be opened by the query.
    render(() => (
      <div>
        <JsonValue value={{ cache: 'ALL_CACHED pages' }} defaultCollapsed searchQuery="cached" />
        <JsonValue value={12345607} searchQuery="456" />
      </div>
    ));
    const marks = Array.from(document.querySelectorAll<HTMLElement>('[data-fdt-json-match]'));
    expect(marks.length).toBe(2);
    const firstMark = marks[0] ?? throwAt(0);
    // The mark is element-owned text — read the matched slice, then normalize
    // the case for the case-insensitivity pin (the mark's slice keeps the source case).
    expect(firstMark.textContent.toLowerCase()).toBe('cached'); // The match kept its own branch opened despite the collapse default.
    const [treeToggle, ...rest] = toggles();
    expect(treeToggle?.getAttribute('aria-expanded')).toBe('true');
    expect(rest[0]).toBeUndefined(); // scalars do not render toggles.
    // The match is inside its own highlighted element (accent tint under it).
    expect(firstMark.className).toContain('bg-accent/20');
  });

  it('marks the key text too when the term matches', () => {
    render(() => <JsonValue value={{ rocketAttribute: true }} searchQuery="attribute" />);
    const marks = Array.from(document.querySelectorAll('[data-fdt-json-match]'));
    // The matched slice keeps the source's casing: "rocketAttribute" → "Attribute".
    expect(marks.map((mark) => mark.textContent)).toEqual(['Attribute']);
  });

  it('does not mark anything for an unknown query and leaves toggles authoritative', () => {
    render(() => <JsonValue value={{ server: 'nginx' }} defaultCollapsed searchQuery="nginx" />);
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('true'); // known hit: forced open
    cleanup();
    render(() => <JsonValue value={{ server: 'nginx' }} defaultCollapsed searchQuery="apache" />);
    // A second render (after cleanup) for the unknown query → collapsed default.
    expect(toggles()[0]?.getAttribute('aria-expanded')).toBe('false');
    expect(document.querySelectorAll('[data-fdt-json-match]').length).toBe(0);
  });
});
