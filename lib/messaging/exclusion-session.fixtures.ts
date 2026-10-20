/**
 * Shared fixtures for the exclusion-session guard, store and fuzz suites:
 * the canonical valid values each suite mutates per case — declared once so
 * the shapes cannot drift between suites.
 */
import type { ExclusionSet } from '../exclusion-builder/set';
import type { ActiveExclusionSession } from './exclusion-session';

/** A populated set: rows in every feature, one toggle on. */
export function validSet(): ExclusionSet {
  return {
    rows: {
      delayJs: ['jquery\\.min\\.js', 'gtag'],
      deferJs: ['/wp-includes/js/'],
      lazyload: ['hero.webp'],
      lazyRender: ['<section class="footer">']
    },
    disable: { delayJs: false, deferJs: true, lazyRender: false }
  };
}

/** An active session with a rewritten document (one report). */
export function activeRecord(): ActiveExclusionSession {
  return {
    state: 'active',
    origin: 'https://example.com',
    set: validSet(),
    startedAt: 1_790_000_000_000,
    document: {
      outcome: 'rewritten',
      reports: [
        {
          feature: 'delay_js',
          featureWide: false,
          candidates: 3,
          rewritten: 2,
          regionRemovals: 0,
          matchedRows: [{ row: 'gtag', rowKind: 'pattern', matches: 2 }],
          unmatchedRows: ['jquery\\.min\\.js']
        }
      ]
    }
  };
}
