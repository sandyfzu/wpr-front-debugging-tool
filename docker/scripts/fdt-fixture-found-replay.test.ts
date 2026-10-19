/**
 * The `?fdt-delay=1` found-replay union across the docker site's delayed
 * scripts, against the debugging tool's real machinery: the capture extracts
 * the word from the browser's error shape, the throwing script answers that
 * word with nothing (the honest not-found anchor), the definer's assignment
 * answers it in the definition search's shape, and the fixture plugin queues
 * the stems in the order the story needs (real throw → benign marker → late
 * definition).
 *
 * These are text contracts over the fixture files: the live behavior rides
 * on them plus WP Rocket's verified queue semantics, and the browser-side
 * proof is `docker/scripts/cdp-smoke.mjs` scenario 2. Pinning the text keeps
 * fixture drift from silently breaking the found-verdict replay the site
 * exists to hand-test.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { extractUndefinedReference } from '../../entrypoints/main-world/capture-undefined-references';
import { definitionMatcher } from '../../lib/panel/undefined-refs';

const FIXTURES = join(dirname(fileURLToPath(import.meta.url)), '..', 'fixtures');
const assetSource = (asset: string): string =>
  readFileSync(join(FIXTURES, 'assets', `${asset}.js`), 'utf8');

/**
 * The word the thrower's bare call resolves to, read from the thrower itself:
 * a rename in either script breaks the union here instead of shipping a
 * silently not-found docker site.
 *
 * @throws When `fdt-delayed-reference.js` no longer carries its single
 *   bare-call line — the found-replay contract is unreadable then.
 */
function thrownWord(): string {
  const call = assetSource('fdt-delayed-reference').match(/^([A-Za-z_$][\w$]*)\(\);\s*$/m);
  if (!call || call[1] === undefined) {
    throw new Error(
      'fdt-delayed-reference.js lost its single bare-call line — the found-replay contract is unreadable'
    );
  }
  return call[1];
}

const WORD = thrownWord();

describe('the ?fdt-delay=1 found-replay union', () => {
  it('the thrower names the word; the capture extracts it from the browser error shape', () => {
    expect(extractUndefinedReference(`ReferenceError: ${WORD} is not defined`)).toBe(WORD);
  });

  it('the thrower defines nothing: a bare call is the honest not-found anchor', () => {
    const search = definitionMatcher(WORD);
    expect(search, `the identifier ${WORD} must be searchable`).not.toBeNull();
    expect(search?.(assetSource('fdt-delayed-reference'))).toBe(false);
  });

  it('the definer answers the same word in the definition search assignment shape', () => {
    const search = definitionMatcher(WORD);
    expect(search, `the identifier ${WORD} must be searchable`).not.toBeNull();
    expect(search?.(assetSource('fdt-delayed-definer'))).toBe(true);
  });

  it('no sibling delayed script shadows the answer with a false definition', () => {
    const search = definitionMatcher(WORD);
    expect(search, `the identifier ${WORD} must be searchable`).not.toBeNull();
    expect(search?.(assetSource('fdt-delayed-lifecycle'))).toBe(false);
  });

  it('the fixture plugin queues the stems in the order the story needs', () => {
    const php = readFileSync(join(FIXTURES, 'fdt-fixtures.php'), 'utf8');
    const fnStart = php.indexOf('function fixture_delay_assets(): array {');
    const fnEnd = fnStart === -1 ? -1 : php.indexOf('\t];', fnStart);
    expect(
      fnEnd,
      'fixture_delay_assets() is unreadable — the queue-order pin lost its target'
    ).toBeGreaterThan(-1);
    const stems = [...php.slice(fnStart, fnEnd).matchAll(/'([a-z0-9-]+)',/g)].map((m) => m[1]);
    expect(stems).toEqual([
      'fdt-delayed-reference',
      'fdt-delayed-lifecycle',
      'fdt-delayed-definer'
    ]);
  });
});
