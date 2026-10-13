/**
 * Render tests for the key/value row and ledger: inline layout with the
 * dotted leader, stacked layout, and the data-driven list form.
 */
import { cleanup, render, screen } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import { KeyValue, KeyValueList } from './key-value';

afterEach(() => {
  cleanup();
});

describe('KeyValue', () => {
  it('renders the term and value inline with a leader between them', () => {
    render(() => <KeyValue term="Version">3.17.2</KeyValue>);
    const row = document.querySelector('[data-fdt="key-value"]');
    expect(row?.textContent).toContain('Version');
    expect(screen.getByText('Version').className).toContain('text-fg-muted');
    // The leader is decorational only (the value text is what SR reads).
    expect(row?.querySelector('[aria-hidden="true"]')).toBeTruthy();
    expect(row?.hasAttribute('data-fdt-stacked')).toBe(false);
  });

  it('drops the leader on stacked rows and stacks term above value', () => {
    render(() => (
      <KeyValue term="Server" stacked>
        LiteSpeed
      </KeyValue>
    ));
    const stacked = document.querySelector('[data-fdt-stacked]');
    expect(stacked?.className).toContain('flex-col');
    expect(stacked?.querySelector('[aria-hidden="true"]')).toBeNull();
  });

  it('honors leader=false for tight inline rows', () => {
    render(() => (
      <KeyValue term="Source" leader={false}>
        HTML
      </KeyValue>
    ));
    expect(document.querySelector('[data-fdt="key-value"] [aria-hidden="true"]')).toBeNull();
  });

  it('lets callers win classes and keeps the row at the text-xs density', () => {
    render(() => (
      <KeyValue term="Status" class="pt-1">
        ok
      </KeyValue>
    ));
    const row = document.querySelector('[data-fdt="key-value"]');
    expect(row?.className).toContain('text-xs');
    expect(row?.className).toContain('pt-1');
  });
});

describe('KeyValueList', () => {
  it('renders the ledger from data and reuses the same row primitive', () => {
    render(() => (
      <KeyValueList
        items={[
          { term: 'Platform', value: 'WordPress 6.7' },
          { term: 'Server', value: 'nginx' },
          { term: 'Notes', value: 'see the source', stacked: true }
        ]}
      />
    ));
    const rows = document.querySelectorAll('[data-fdt="key-value"]');
    expect(rows.length).toBe(3);
    // The third row stacks (its own per-row flag survives the list form).
    expect(rows[2]?.hasAttribute('data-fdt-stacked')).toBe(true);
    expect(rows[0]?.textContent).toContain('WordPress 6.7');
  });

  it('propagates leader=false to every row and accepts caller classes', () => {
    render(() => (
      <KeyValueList
        leader={false}
        class="gap-y-1.5"
        items={[
          { term: 'A', value: 'a' },
          { term: 'B', value: 'b' }
        ]}
      />
    ));
    const rows = document.querySelectorAll('[data-fdt="key-value"]');
    expect(rows.length).toBe(2);
    for (const row of rows) {
      expect(row.querySelector('[aria-hidden="true"]')).toBeNull();
    }
    expect(document.querySelector('[data-fdt="key-value-list"]')?.className).toContain('gap-y-1.5');
  });
});
