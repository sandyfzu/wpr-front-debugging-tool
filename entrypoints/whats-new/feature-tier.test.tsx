/**
 * The `@feature` container tier (`--container-feature` in theme.css) is the
 * list width at which a highlight's screenshot moves beside its text. Container
 * conditions compile to literals, so the tier cannot read its inputs: this test
 * re-derives it from them — the widest bundled shot, the card's chrome and the
 * row's gap and text minimum — so a changed shot, card inset or row class
 * fails here (CI) instead of quietly shrinking shots below their shot width.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { render } from '@solidjs/testing-library';
import { describe, expect, it } from 'vitest';
import { CARD_FRAME_CLASSES, Card } from '../../components/ui/card';
import { RELEASE_SCREENSHOTS } from '../../lib/release-notes/screenshots';
import { HIGHLIGHT_ROW } from './release';

/** Tailwind's spacing step and the root font size, in CSS px. */
const SPACING_PX = 4;
const REM_PX = 16;

/** Tailwind's bare `border` width, in CSS px. */
const BORDER_PX = 1;

/**
 * The first capture of `pattern` in `text`, as a number.
 *
 * @param text The class string.
 * @param pattern A regex with one numeric capture.
 * @throws {@link Error} When the class is missing (the layout changed shape).
 */
function captured(text: string, pattern: RegExp): number {
  const match = pattern.exec(text)?.[1];
  if (match === undefined) throw new Error(`no ${String(pattern)} in "${text}"`);
  return Number(match);
}

/** The card body's padding per side, read off a rendered `Card`. */
function cardPaddingPx(): number {
  const { container } = render(() => <Card>x</Card>);
  const body = container.querySelector('[data-fdt="card-body"]');
  return captured(body?.className ?? '', /(?:^|\s)p-(\d+(?:\.\d+)?)(?:\s|$)/) * SPACING_PX;
}

describe('the @feature tier', () => {
  it('equals the widest shot + card chrome + the row gap + the text minimum', () => {
    const shot = Math.max(...Object.values(RELEASE_SCREENSHOTS).map((row) => row.width));
    expect(CARD_FRAME_CLASSES.split(' ')).toContain('border');
    const chrome = 2 * (BORDER_PX + cardPaddingPx());
    const gap = captured(HIGHLIGHT_ROW, /@feature:gap-(\d+(?:\.\d+)?)/) * SPACING_PX;
    const text = captured(HIGHLIGHT_ROW, /minmax\((\d+(?:\.\d+)?)rem,1fr\)/) * REM_PX;
    const css = readFileSync(join(process.cwd(), 'assets', 'css', 'theme.css'), 'utf8');
    const declarations = [...css.matchAll(/--container-feature:\s*([^;]+);/g)].map((m) => m[1]);
    expect(declarations).toEqual([`${String(shot + chrome + gap + text)}px`]);
  });
});
