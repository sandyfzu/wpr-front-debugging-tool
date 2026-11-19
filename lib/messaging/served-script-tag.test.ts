import { describe, expect, it, vi } from 'vitest';
import { PAYLOAD_LIMITS } from './payload-bounds';
import { createScriptSnapshotId } from './script-source';
import {
  SERVED_TAG_ATTRIBUTE_MAX_CHARS,
  SERVED_TAG_MAX_CHARS,
  SERVED_TAGS_TOTAL_CHARS,
  capAttributeText,
  keepServedScriptTags,
  loadServedScriptTag,
  parseServedScriptTagReply,
  parseServedScriptTagRequest,
  readServedScriptTag,
  servedScriptTag,
  type ServedScriptTag
} from './served-script-tag';

const SNAPSHOT = createScriptSnapshotId();

/** The script elements of a parsed markup fragment, in document order. */
function scriptsOf(html: string): HTMLScriptElement[] {
  const doc = new DOMParser().parseFromString(`<!doctype html><body>${html}`, 'text/html');
  return [...doc.querySelectorAll('script')];
}

/** The one script of a fragment, rebuilt. */
function tagOf(html: string): ServedScriptTag {
  const [script] = scriptsOf(html);
  if (script === undefined) throw new Error('No script in the fragment.');
  return servedScriptTag(script.attributes);
}

describe('servedScriptTag', () => {
  it('rebuilds a delayed script in attribute order, valueless attributes bare', () => {
    expect(
      tagOf(
        '<script type="rocketlazyloadscript" data-rocket-src="/a.js?ver=1" data-rocket-type="module" defer data-rocket-defer></script>'
      )
    ).toEqual({
      tag: '<script type="rocketlazyloadscript" data-rocket-src="/a.js?ver=1" data-rocket-type="module" defer data-rocket-defer>',
      type: 'rocketlazyloadscript'
    });
  });

  it('answers a bare script with no type', () => {
    expect(tagOf('<script>var a = 1;</script>')).toEqual({ tag: '<script>', type: null });
  });

  it('keeps a module or JSON type as served', () => {
    expect(tagOf('<script type="module" src="m.js"></script>').type).toBe('module');
    expect(tagOf('<script type="application/ld+json">{}</script>')).toEqual({
      tag: '<script type="application/ld+json">',
      type: 'application/ld+json'
    });
  });

  it('escapes values so the tag never reads as other markup', () => {
    expect(tagOf(`<script data-x='a"b&c<d>'></script>`).tag).toBe(
      '<script data-x="a&quot;b&amp;c&lt;d&gt;">'
    );
  });

  it('cuts a huge attribute value (and name) to the cap with a mark', () => {
    const value = 'v'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS + 50);
    const { tag, type } = servedScriptTag([
      { name: 'type', value },
      { name: 'n'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS + 1), value: '' }
    ]);
    const cut = `${'v'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS)}…`;
    expect(type).toBe(cut);
    expect(tag).toBe(`<script type="${cut}" ${'n'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS)}…>`);
  });

  it('stops adding attributes before the tag cap and closes with a cut tail', () => {
    const attributes = Array.from({ length: 40 }, (_, index) => ({
      name: `data-a${String(index)}`,
      value: 'x'.repeat(200)
    }));
    const { tag } = servedScriptTag([...attributes, { name: 'type', value: 'module' }]);
    expect(tag.length).toBeLessThanOrEqual(SERVED_TAG_MAX_CHARS);
    expect(tag.endsWith(' …>')).toBe(true);
    expect(tag).not.toContain('data-a39');
  });

  /** Eight `dN="x…"` attributes (246 chars each): a 1,975-char tag head to fill from. */
  const head = Array.from({ length: 8 }, (_, index) => ({
    name: `d${String(index)}`,
    value: 'x'.repeat(240)
  }));
  const headTag = servedScriptTag(head).tag.slice(0, -1);
  /** An `f` attribute whose markup (` f="…"`, value + 5 chars) ends `room` chars short of the cap. */
  const filler = (room: number): { name: string; value: string } => ({
    name: 'f',
    value: 'x'.repeat(SERVED_TAG_MAX_CHARS - headTag.length - 5 - room)
  });

  it('keeps an attribute that leaves exactly the cut tail, then cuts at the cap', () => {
    const { tag } = servedScriptTag([
      ...head,
      filler(' …>'.length),
      { name: 'z', value: '' },
      { name: 'y', value: '' }
    ]);
    expect(tag).toHaveLength(SERVED_TAG_MAX_CHARS);
    expect(tag).toBe(`${headTag} f="${filler(' …>'.length).value}" …>`);
  });

  it('cuts an attribute one char past the cut tail, so the tag never exceeds the cap', () => {
    const { tag } = servedScriptTag([
      ...head,
      filler(' …>'.length - 1),
      { name: 'z', value: '' },
      { name: 'y', value: '' }
    ]);
    expect(tag).toBe(`${headTag} …>`);
    expect(tag.length).toBeLessThanOrEqual(SERVED_TAG_MAX_CHARS);
    expect(parseServedScriptTagReply({ status: 'ok', tag, type: null })).not.toBeNull();
  });

  it('adds nothing after a cut, not even an attribute that would still fit', () => {
    const { tag } = servedScriptTag([
      ...head,
      { name: 'long', value: 'x'.repeat(240) },
      { name: 'y', value: '' }
    ]);
    expect(tag).toBe(`${headTag} …>`);
  });

  it('still reads the type when the attribute list was cut before it', () => {
    const attributes = Array.from({ length: 20 }, (_, index) => ({
      name: `data-a${String(index)}`,
      value: 'x'.repeat(250)
    }));
    expect(servedScriptTag([...attributes, { name: 'type', value: 'module' }]).type).toBe('module');
  });
});

describe('capAttributeText', () => {
  it('never splits a surrogate pair at the cut', () => {
    const text = `${'a'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS - 1)}😀tail`;
    expect(capAttributeText(text)).toBe(`${'a'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS - 1)}…`);
    expect(capAttributeText('short')).toBe('short');
  });

  it('keeps a text at the cap whole and cuts one char past it', () => {
    const atCap = 'a'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS);
    expect(capAttributeText(atCap)).toBe(atCap);
    expect(capAttributeText(`${atCap}b`)).toBe(`${atCap}…`);
  });

  it('rebuilds a cut of a huge text as the same prefix + mark', () => {
    const huge = `${'é'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS)}${'q'.repeat(1_000_000)}`;
    const cut = capAttributeText(huge);
    expect(cut).toBe(`${'é'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS)}…`);
    expect(cut).toHaveLength(SERVED_TAG_ATTRIBUTE_MAX_CHARS + 1);
  });
});

describe('keepServedScriptTags', () => {
  it('keeps one tag per script in document order', () => {
    const kept = keepServedScriptTags(
      scriptsOf('<script src="a.js"></script><script defer></script>')
    );
    expect(kept.map((entry) => entry?.tag)).toEqual(['<script src="a.js">', '<script defer>']);
  });

  it('stops keeping once the budget is spent (null from there on)', () => {
    const scripts = scriptsOf('<script src="a.js"></script><script src="b.js"></script>');
    const first = '<script src="a.js">'.length;
    expect(keepServedScriptTags(scripts, first).map((entry) => entry?.tag ?? null)).toEqual([
      '<script src="a.js">',
      null
    ]);
    expect(keepServedScriptTags(scripts, first - 1)).toEqual([null, null]);
    expect(SERVED_TAGS_TOTAL_CHARS).toBeGreaterThan(SERVED_TAG_MAX_CHARS);
  });

  it('keeps no more tags than the payload carries scripts', () => {
    const many = Array.from({ length: PAYLOAD_LIMITS.delayScripts.count + 3 }, () => ({
      attributes: [] as unknown as NamedNodeMap
    }));
    expect(keepServedScriptTags(many)).toHaveLength(PAYLOAD_LIMITS.delayScripts.count);
  });
});

describe('parseServedScriptTagRequest', () => {
  it('accepts exactly the two fields', () => {
    expect(parseServedScriptTagRequest({ snapshotId: SNAPSHOT, scriptIndex: 0 })).toEqual({
      snapshotId: SNAPSHOT,
      scriptIndex: 0
    });
  });

  it.each([
    null,
    'x',
    {},
    { snapshotId: SNAPSHOT },
    { snapshotId: 'nope', scriptIndex: 0 },
    { snapshotId: SNAPSHOT, scriptIndex: -1 },
    { snapshotId: SNAPSHOT, scriptIndex: 1.5 },
    { snapshotId: SNAPSHOT, scriptIndex: '1' },
    { snapshotId: SNAPSHOT, scriptIndex: PAYLOAD_LIMITS.delayScripts.count },
    { snapshotId: SNAPSHOT, scriptIndex: 0, offset: 0 }
  ])('refuses %j', (input) => {
    expect(parseServedScriptTagRequest(input)).toBeNull();
  });
});

describe('readServedScriptTag', () => {
  const tags: (ServedScriptTag | null)[] = [{ tag: '<script defer>', type: null }, null];

  it('answers the kept tag of the same snapshot', () => {
    expect(readServedScriptTag(tags, SNAPSHOT, { snapshotId: SNAPSHOT, scriptIndex: 0 })).toEqual({
      status: 'ok',
      tag: '<script defer>',
      type: null
    });
  });

  it('answers gone for a replaced snapshot or a position past the list', () => {
    const other = createScriptSnapshotId();
    expect(readServedScriptTag(tags, SNAPSHOT, { snapshotId: other, scriptIndex: 0 })).toEqual({
      status: 'gone'
    });
    expect(readServedScriptTag(tags, SNAPSHOT, { snapshotId: SNAPSHOT, scriptIndex: 2 })).toEqual({
      status: 'gone'
    });
  });

  it('types the errors: malformed, not processed yet, not kept', () => {
    expect(readServedScriptTag(tags, SNAPSHOT, { scriptIndex: 0 })).toEqual({
      status: 'error',
      reason: 'invalid-request'
    });
    expect(readServedScriptTag(null, SNAPSHOT, { snapshotId: SNAPSHOT, scriptIndex: 0 })).toEqual({
      status: 'error',
      reason: 'not-ready'
    });
    expect(readServedScriptTag(tags, SNAPSHOT, { snapshotId: SNAPSHOT, scriptIndex: 1 })).toEqual({
      status: 'error',
      reason: 'not-kept'
    });
  });
});

describe('parseServedScriptTagReply', () => {
  it('rebuilds each valid reply', () => {
    expect(parseServedScriptTagReply({ status: 'ok', tag: '<script>', type: 'module' })).toEqual({
      status: 'ok',
      tag: '<script>',
      type: 'module'
    });
    expect(parseServedScriptTagReply({ status: 'gone' })).toEqual({ status: 'gone' });
    expect(parseServedScriptTagReply({ status: 'error', reason: 'not-kept' })).toEqual({
      status: 'error',
      reason: 'not-kept'
    });
  });

  it.each([
    null,
    [],
    { status: 'ok', tag: `<script ${'a'.repeat(SERVED_TAG_MAX_CHARS)}>`, type: null },
    { status: 'ok', tag: '<style>', type: null },
    { status: 'ok', tag: '<script', type: null },
    { status: 'ok', tag: 7, type: null },
    { status: 'ok', tag: '<script>', type: 3 },
    { status: 'ok', tag: '<script>', type: 'x'.repeat(SERVED_TAG_ATTRIBUTE_MAX_CHARS + 2) },
    { status: 'ok', tag: '<script>' },
    { status: 'ok', tag: '<script>', type: null, extra: 1 },
    { status: 'gone', extra: 1 },
    { status: 'error', reason: 'boom' },
    { status: 'error', reason: 'not-kept', extra: 1 },
    { status: 'unavailable' }
  ])('refuses %j', (input) => {
    expect(parseServedScriptTagReply(input)).toBeNull();
  });
});

describe('loadServedScriptTag', () => {
  const request = { snapshotId: SNAPSHOT, scriptIndex: 0 };

  it('returns the validated reply', async () => {
    const log = { warn: vi.fn() };
    await expect(
      loadServedScriptTag(request, () => Promise.resolve({ status: 'gone' }), log)
    ).resolves.toEqual({ status: 'gone' });
    expect(log.warn).not.toHaveBeenCalled();
  });

  it('turns a transport failure into unreachable, logged with its cause', async () => {
    const log = { warn: vi.fn() };
    await expect(
      loadServedScriptTag(request, () => Promise.reject(new Error('No receiver')), log)
    ).resolves.toEqual({ status: 'error', reason: 'unreachable' });
    expect(log.warn).toHaveBeenCalledWith('Reading the served script tag failed', 'No receiver');
  });

  it('turns a malformed answer into unreadable, logged', async () => {
    const log = { warn: vi.fn() };
    await expect(
      loadServedScriptTag(request, () => Promise.resolve({ status: 'ok' }), log)
    ).resolves.toEqual({ status: 'error', reason: 'unreadable' });
    expect(log.warn).toHaveBeenCalledOnce();
  });
});
