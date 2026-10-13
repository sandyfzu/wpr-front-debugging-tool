/**
 * The nav registry's shape tests: row order, groups, the reserved row and
 * its copy, uniqueness — plus the route-body table matching the registry
 * (the shell cannot run out of bodies).
 */
import { describe, expect, it } from 'vitest';
import { DEFAULT_ROUTE, NAV_GROUPS, NAV_ROUTES, ROUTE_IDS, navRoute } from './routes';
import { PAGES } from './pages';

describe('NAV_ROUTES', () => {
  it('lists the six rows in the journey order', () => {
    expect(NAV_ROUTES.map((row) => row.id)).toEqual([
      'detections',
      'javascript',
      'lazyload',
      'preloaded-resources',
      'undefined-references',
      'diagnoser'
    ]);
    expect(NAV_ROUTES.map((row) => row.group)).toEqual([
      'Overview',
      'Inspect',
      'Inspect',
      'Inspect',
      'Diagnose',
      'Diagnose'
    ]);
  });

  it('uses only known groups in known order', () => {
    for (const row of NAV_ROUTES) {
      expect((NAV_GROUPS as readonly string[]).includes(row.group)).toBe(true);
    }
  });

  it('gives every row a non-empty label and a distinct id', () => {
    const ids = NAV_ROUTES.map((row) => row.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const row of NAV_ROUTES) {
      expect(row.label.length).toBeGreaterThan(0);
      expect((ROUTE_IDS as readonly string[]).includes(row.id)).toBe(true);
    }
  });

  it('renders the Diagnoser row reserved, with its explanatory note', () => {
    const diagnoser = navRoute('diagnoser');
    expect(diagnoser?.reserved).toBe(true);
    expect(diagnoser?.reservedNote).toBe('Returns with the Diagnoser plugin v2');
  });

  it('names the plural explicitly where the singular menu name was wrong', () => {
    // Copy delta — the fixed label lives here, the record in the P15 sweep.
    expect(navRoute('undefined-references')?.label).toBe('Undefined References');
  });

  it('bounds every group value without leaving the vocabulary', () => {
    expect([...NAV_GROUPS]).toEqual(['Overview', 'Inspect', 'Diagnose', 'Tools']);
  });
});

describe('PAGES', () => {
  it('has one body per registry row — no route without a page', () => {
    expect(Object.keys(PAGES).sort()).toEqual([...ROUTE_IDS].sort());
  });

  it('defaults to the first registry route', () => {
    expect(DEFAULT_ROUTE).toBe('detections');
  });
});
