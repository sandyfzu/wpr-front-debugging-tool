/**
 * The nav form tables: the column widths the UI bar declares (L-1), the
 * spacing the decisions pin (UX-D16), and the note's tone rule.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { STATUS_KINDS, STATUS_TEXT_CLASSES } from '../../../components/ui/status-badge';
import { NAV_FORM_CLASSES, navNoteToneClass } from './nav-forms';

/** The Tailwind spacing step in px (`--spacing: 0.25rem` at a 16 px root). */
const SPACING_PX = 4;

/** The width a `w-N` class in a class string sets, in px. */
function widthPx(classes: string): number {
  const match = /(?:^|\s)w-(\d+)(?:\s|$)/.exec(classes);
  if (match?.[1] === undefined) throw new Error(`no w-N class in "${classes}"`);
  return Number(match[1]) * SPACING_PX;
}

describe('NAV_FORM_CLASSES', () => {
  it('sizes the columns as UI bar L-1 declares (208 px labeled, 52 px rail)', () => {
    const labeled = widthPx(NAV_FORM_CLASSES.labeled.column);
    const rail = widthPx(NAV_FORM_CLASSES.rail.column);
    expect([labeled, rail]).toEqual([208, 52]);
    const bar = readFileSync(join(process.cwd(), 'docs', 'ui-ux-bar.md'), 'utf8');
    expect(bar).toContain(`**${String(labeled)} px labeled / ${String(rail)} px rail**`);
  });

  it('keeps 32 px rows in both forms and the rail hairline lead (UX-D16)', () => {
    expect(NAV_FORM_CLASSES.rail.row).toContain('size-8');
    expect(NAV_FORM_CLASSES.labeled.row).toContain('h-8');
    // 6 px above + 1 px hairline + 6 px below, none above the first group.
    expect(NAV_FORM_CLASSES.rail.group).toContain('mt-1.5');
    expect(NAV_FORM_CLASSES.rail.group).toContain('border-t');
    expect(NAV_FORM_CLASSES.rail.group).toContain('pt-1.5');
    expect(NAV_FORM_CLASSES.rail.caption).toBeNull();
    // The labeled caption: the caps label with its 14 px lead.
    expect(NAV_FORM_CLASSES.labeled.caption).toContain('pt-3.5');
    expect(NAV_FORM_CLASSES.labeled.caption).toContain('uppercase');
    expect(NAV_FORM_CLASSES.labeled.caption).toContain('text-2xs');
  });

  it('tints the active row and gives the rest the hover surface, in both forms', () => {
    for (const form of ['rail', 'labeled'] as const) {
      expect(NAV_FORM_CLASSES[form].rowActive).toContain('bg-accent-soft');
      expect(NAV_FORM_CLASSES[form].rowIdle).toContain('hover:bg-surface-3');
    }
  });
});

describe('navNoteToneClass', () => {
  it('keeps counts and info/neutral quiet; attention tones keep their color', () => {
    for (const tone of STATUS_KINDS) {
      const expected =
        tone === 'neutral' || tone === 'info' ? 'text-fg-muted' : STATUS_TEXT_CLASSES[tone];
      expect(navNoteToneClass(tone)).toBe(expected);
    }
  });
});
