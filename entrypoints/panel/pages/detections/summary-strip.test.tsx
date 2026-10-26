/**
 * The summary strip's branches: the headline + meter share, the facts the
 * status bar lacks (absolute cache time, platform header) and their
 * omissions (cached without a stamp, plugin without a version, nothing to
 * add), and the plugin-absent explanation.
 */
import { cleanup, render } from '@solidjs/testing-library';
import { afterEach, describe, expect, it } from 'vitest';
import type { DetectionsSummary } from '../../../../lib/panel/detections-summary';
import { cacheCopy } from '../../../../lib/detection/cache-context';
import { explainedCacheCopy, meterWidth, SummaryStrip } from './summary-strip';

afterEach(() => {
  cleanup();
});

/** A summary with overrides. */
function summary(overrides?: Partial<DetectionsSummary>): DetectionsSummary {
  return {
    wpr: { present: true, version: '3.20.1' },
    cache: { kind: 'bypass-requested' },
    server: 'nginx',
    platform: null,
    optimizations: { active: 3, total: 12, offInTab: 0 },
    wordpressVersion: null,
    cacheLayer: null,
    ...overrides
  };
}

/** The rendered fact by its key. */
function fact(key: string): Element | null {
  return document.querySelector(`[data-fdt-summary-fact="${key}"]`);
}

describe('meterWidth', () => {
  it.each([
    [3, 12, '25.00%'],
    [12, 12, '100.00%'],
    [0, 12, '0%'],
    [0, 0, '0%'],
    [5, 0, '0%'],
    [20, 10, '100.00%'],
    [-1, 10, '0%']
  ])('%d of %d → %s', (active, total, expected) => {
    expect(meterWidth(active, total)).toBe(expected);
  });
});

describe('SummaryStrip', () => {
  it('heads with "N of M optimizations active" and a decorative meter at that share', () => {
    render(() => <SummaryStrip summary={summary()} />);
    expect(document.querySelector('[data-fdt-summary-headline]')?.textContent).toBe(
      '3 of 12 optimizations active'
    );
    const meter = document.querySelector<HTMLElement>('[data-fdt-summary-meter]');
    expect(meter?.getAttribute('aria-hidden')).toBe('true');
    expect((meter?.firstElementChild as HTMLElement | null)?.style.width).toBe('25.00%');
    // Right after the headline, at most 12 rem, an accent (not status) fill.
    expect(meter?.previousElementSibling?.hasAttribute('data-fdt-summary-headline')).toBe(true);
    expect(meter?.className).toContain('w-48');
    expect(meter?.firstElementChild?.className).toContain('bg-accent');
    expect(meter?.firstElementChild?.className).not.toContain('status');
  });

  it('adds the builder reason suffix only when features are off in this tab', () => {
    const headline = (offInTab: number): string => {
      cleanup();
      render(() => (
        <SummaryStrip summary={summary({ optimizations: { active: 1, total: 16, offInTab } })} />
      ));
      return document.querySelector('[data-fdt-summary-headline]')?.textContent ?? '';
    };
    expect(headline(0)).toBe('1 of 16 optimizations active');
    expect(document.querySelector('[data-fdt-summary-off]')).toBeNull();
    expect(headline(1)).toBe('1 of 16 optimizations active · 1 off in this tab');
    expect(headline(2)).toBe('1 of 16 optimizations active · 2 off in this tab');
    // The suffix wraps as one unit, never mid-phrase.
    expect(document.querySelector('[data-fdt-summary-off]')?.className).toContain(
      'whitespace-nowrap'
    );
  });

  it('states the absolute cache time as a machine-readable <time>', () => {
    render(() => (
      <SummaryStrip
        summary={summary({
          cache: { kind: 'cached', seconds: 1700000000, formatted: '2023-11-14 22:13:20 UTC' }
        })}
      />
    ));
    expect(fact('cache')?.textContent).toBe('Cache generated 2023-11-14 22:13:20 UTC');
    expect(fact('cache')?.querySelector('time')?.getAttribute('datetime')).toBe(
      '2023-11-14T22:13:20.000Z'
    );
    expect(fact('cache')?.querySelector('time')?.className).toContain('whitespace-nowrap');
  });

  it('omits the cache fact when cached without a representable stamp', () => {
    render(() => (
      <SummaryStrip
        summary={summary({ cache: { kind: 'cached', seconds: null, formatted: null } })}
      />
    ));
    expect(fact('cache')).toBeNull();
  });

  it('names the platform with the header that identified it', () => {
    render(() => (
      <SummaryStrip summary={summary({ platform: { name: 'Kinsta', header: 'X-Kinsta-Cache' } })} />
    ));
    expect(fact('platform')?.textContent).toBe('Kinsta via X-Kinsta-Cache');
  });

  it('adds no facts row when the status bar already says it all (version-less plugin included)', () => {
    // A stamp-less cached page: the bar's "Cached" is the whole cache answer.
    render(() => (
      <SummaryStrip
        summary={summary({
          wpr: { present: true, version: null },
          cache: { kind: 'cached', seconds: null, formatted: null }
        })}
      />
    ));
    expect(document.querySelector('[aria-label="Page facts"]')).toBeNull();
    expect(document.querySelector('[data-fdt="detections-summary"]')?.textContent).toBe(
      '3 of 12 optimizations active'
    );
  });

  it('explains a zero headline when the plugin is absent', () => {
    render(() => (
      <SummaryStrip
        summary={summary({
          wpr: { present: false },
          cache: { kind: 'not-applicable' },
          optimizations: { active: 0, total: 14, offInTab: 0 }
        })}
      />
    ));
    expect(fact('wpr')?.textContent).toBe('WP Rocket was not detected on this page.');
  });

  it.each([
    [{ kind: 'uncertain-signature' }, 'Cache not proven'],
    [{ kind: 'possibly-cached', evidence: 'Cloudflare' }, 'Possibly cached'],
    [{ kind: 'not-detected', headers: 'unavailable' }, 'Cache not detected'],
    [{ kind: 'not-detected', headers: 'captured' }, 'Cache not detected'],
    [{ kind: 'bypass-requested' }, 'Bypass requested']
  ] as const)(
    'states the %o cache answer with the shared chip copy as a tooltip trigger',
    (cache, chip) => {
      render(() => <SummaryStrip summary={summary({ cache })} />);
      const trigger = fact('cache')?.querySelector<HTMLElement>('[data-fdt="tooltip-trigger"]');
      expect(trigger?.textContent).toBe(chip);
      expect(trigger?.textContent).toBe(cacheCopy(cache).chip);
      // A real control: keyboard-focusable, so the explanation is never hover-only.
      expect(trigger?.tagName).toBe('BUTTON');
    }
  );

  it('explains every state except cached (stamp fact) and not-applicable (no question)', () => {
    expect(explainedCacheCopy({ kind: 'not-applicable' })).toBeNull();
    expect(explainedCacheCopy({ kind: 'cached', seconds: null, formatted: null })).toBeNull();
    expect(explainedCacheCopy({ kind: 'bypass-requested' })).toEqual(
      cacheCopy({ kind: 'bypass-requested' })
    );
  });

  it('names the WordPress version and the served hosting cache layer', () => {
    render(() => (
      <SummaryStrip
        summary={summary({
          cache: { kind: 'cached', seconds: null, formatted: null },
          wordpressVersion: '6.8.1',
          cacheLayer: 'Cloudflare'
        })}
      />
    ));
    expect(fact('wordpress')?.textContent).toBe('WordPress 6.8.1');
    expect(fact('wordpress')?.querySelector('.font-mono')?.textContent).toBe('6.8.1');
    expect(fact('cache-layer')?.textContent).toBe('Cloudflare cache-layer marker captured');
  });

  it('omits the WordPress and cache-layer facts when unknown', () => {
    render(() => <SummaryStrip summary={summary()} />);
    expect(fact('wordpress')).toBeNull();
    expect(fact('cache-layer')).toBeNull();
  });
});
