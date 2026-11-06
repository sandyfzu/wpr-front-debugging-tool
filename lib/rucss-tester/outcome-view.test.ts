/**
 * Every outcome's words and recoveries: each kind has its own view, every
 * outcome that left the page as it was says so, a request sent stays
 * copyable, and a pattern failure leads to its field.
 */
import { describe, expect, it } from 'vitest';
import type { RucssFetchFailure } from './response';
import { describeRucssOutcome } from './outcome-view';
import type { RucssTestOutcome } from './run-test';

const URL = 'https://mega.wp-rocket.me/support/wpr-rucss-v2.php?url=https://a.test/?1';
const UNCHANGED = 'Nothing on the page was changed.';

/** Every outcome that leaves the page untouched, one per kind and sub-kind. */
const UNTOUCHED: readonly RucssTestOutcome[] = [
  { kind: 'config-unreadable' },
  {
    kind: 'invalid-config',
    problems: [{ kind: 'exclude-pattern', line: '(', message: 'bad' }]
  },
  ...(['no-receiver', 'timeout', 'invalid-reply', 'failed'] as const).map(
    (miss): RucssTestOutcome => ({ kind: 'page-unreachable', step: 'start', miss })
  ),
  ...(
    [
      { kind: 'network-error' },
      { kind: 'timeout' },
      { kind: 'cancelled' },
      { kind: 'oversize' },
      { kind: 'not-utf8' },
      { kind: 'http-status', httpStatus: 503 },
      { kind: 'malformed', httpStatus: 200 },
      { kind: 'service-code', httpStatus: 200, serviceCode: 401 }
    ] satisfies RucssFetchFailure[]
  ).map((failure): RucssTestOutcome => ({
    kind: 'start-failed',
    failure: { kind: 'fetch', requestUrl: URL, failure }
  })),
  ...(
    [
      'refused',
      'background-unreachable',
      'superseded',
      'too-many-styles',
      'inline-check-too-slow'
    ] as const
  ).map((kind): RucssTestOutcome => ({ kind: 'start-failed', failure: { kind } })),
  ...(
    [
      { ok: false, problem: 'timeout' },
      { ok: false, problem: 'unavailable' },
      { ok: false, problem: 'failed' },
      { ok: false, problem: 'oversize' },
      { ok: false, problem: 'oversize', index: 2 },
      { ok: false, problem: 'pattern-failed', index: 1, message: 'Maximum call stack' },
      { ok: false, problem: 'exclusion-failed', line: 'a+', message: 'Maximum call stack' },
      { ok: false, problem: 'invalid-config' }
    ] as const
  ).map((failure): RucssTestOutcome => ({ kind: 'build-failed', requestUrl: URL, failure })),
  ...(['stale-run', 'invalid-request', 'no-document', 'css-blocked'] as const).map(
    (failure): RucssTestOutcome => ({ kind: 'apply-failed', failure })
  )
];

describe('describeRucssOutcome', () => {
  it('says every untouched outcome left the page as it was, with its own title', () => {
    const titles = new Set<string>();
    for (const outcome of UNTOUCHED) {
      const view = describeRucssOutcome(outcome);
      expect(view.message, JSON.stringify(outcome)).toContain(UNCHANGED);
      expect(view.tone, JSON.stringify(outcome)).not.toBe('ok');
      titles.add(view.title);
    }
    // Distinct kinds read distinctly (the two oversize builds share one title on purpose).
    expect(titles.size).toBe(UNTOUCHED.length - 1);
  });

  it('keeps the request address copyable whenever one was sent', () => {
    for (const outcome of UNTOUCHED) {
      const sent =
        outcome.kind === 'build-failed' ||
        (outcome.kind === 'start-failed' && outcome.failure.kind === 'fetch');
      expect(describeRucssOutcome(outcome).requestUrl, JSON.stringify(outcome)).toBe(
        sent ? URL : null
      );
    }
  });

  it('names the service answer it got', () => {
    const view = (failure: RucssFetchFailure): string =>
      describeRucssOutcome({
        kind: 'start-failed',
        failure: { kind: 'fetch', requestUrl: URL, failure }
      }).title;
    expect(view({ kind: 'http-status', httpStatus: 503 })).toBe(
      'The RUCSS service answered HTTP 503'
    );
    expect(view({ kind: 'service-code', httpStatus: 200, serviceCode: 401 })).toBe(
      'The RUCSS service returned code 401'
    );
  });

  it('leads a pattern failure to its field', () => {
    expect(
      describeRucssOutcome({
        kind: 'build-failed',
        requestUrl: URL,
        failure: { ok: false, problem: 'pattern-failed', index: 1, message: 'm' }
      })
    ).toMatchObject({
      title: 'Replacement 2 failed on this CSS',
      recoveries: ['review-patterns'],
      focus: { field: 'replacement', index: 1 }
    });
    expect(
      describeRucssOutcome({
        kind: 'build-failed',
        requestUrl: URL,
        failure: { ok: false, problem: 'exclusion-failed', line: 'a+', message: 'm' }
      }).focus
    ).toEqual({ field: 'excludeFiles' });
    expect(
      describeRucssOutcome({
        kind: 'build-failed',
        requestUrl: URL,
        failure: { ok: false, problem: 'oversize' }
      }).focus
    ).toEqual({ field: 'prepend' });
    expect(
      describeRucssOutcome({
        kind: 'invalid-config',
        problems: [
          { kind: 'replacement-pattern', index: 4, search: '(', message: 'x' },
          { kind: 'replacement-pattern', index: 5, search: '[', message: 'y' }
        ]
      })
    ).toMatchObject({
      message: expect.stringMatching(/^2 patterns do not compile/) as unknown,
      focus: { field: 'replacement', index: 4 }
    });
  });

  it('offers a reload first when only a reload can help', () => {
    expect(
      describeRucssOutcome({ kind: 'page-unreachable', step: 'start', miss: 'no-receiver' })
        .recoveries
    ).toEqual(['reload-page', 'retry']);
    expect(
      describeRucssOutcome({ kind: 'apply-failed', failure: 'no-document' }).recoveries
    ).toEqual(['reload-page']);
    expect(
      describeRucssOutcome({ kind: 'start-failed', failure: { kind: 'too-many-styles' } })
        .recoveries
    ).toEqual(['inspect-styles']);
    expect(
      describeRucssOutcome({ kind: 'start-failed', failure: { kind: 'inline-check-too-slow' } })
    ).toMatchObject({
      title: 'Too much inline CSS for your markers',
      message: expect.stringContaining('passed 5 s') as unknown,
      recoveries: ['inspect-styles', 'retry']
    });
    // A policy block cannot be retried away: the form's Run stays the way forward.
    expect(describeRucssOutcome({ kind: 'apply-failed', failure: 'css-blocked' })).toMatchObject({
      title: "This page's security policy blocked the test's CSS",
      recoveries: []
    });
  });

  it('warns that an unconfirmed apply leaves the page state unknown', () => {
    for (const miss of ['no-receiver', 'timeout', 'invalid-reply', 'failed'] as const) {
      const view = describeRucssOutcome({ kind: 'page-unreachable', step: 'apply', miss });
      expect(view.tone).toBe('warn');
      expect(view.message).toContain('may or may not have changed');
      expect(view.recoveries).toEqual(['reload-page', 'retry']);
    }
  });

  it('counts an applied test and warns when its result is empty', () => {
    const applied = (cssChars: number, gone = 0): RucssTestOutcome => ({
      kind: 'applied',
      requestUrl: URL,
      summary: { removed: 12, preserved: 2, excluded: 1, gone, cssChars },
      applied: []
    });
    expect(describeRucssOutcome(applied(1_234))).toEqual({
      tone: 'ok',
      title: 'Test applied',
      message:
        'Removed 12 styles, kept 3, injected 1,234 characters of CSS. Reload the page to restore its styles.',
      recoveries: ['reload-page'],
      requestUrl: URL,
      focus: null
    });
    expect(describeRucssOutcome(applied(5, 1)).message).toContain('1 had already left the page.');
    expect(describeRucssOutcome(applied(0))).toMatchObject({
      tone: 'warn',
      title: 'Test applied — the result is empty'
    });
  });
});
