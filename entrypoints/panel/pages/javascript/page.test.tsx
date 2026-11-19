/**
 * Render tests for the JavaScript page on the calm list kit: the summary,
 * the rows (name, preview, size, two chips, Clipped), the facets and the
 * search, the empty and filtered-empty states, the detail (pane and
 * drill-in: chips, facts, source tile, code, served tag and its states),
 * the on-demand reads (complete source, served tag — direct and over the
 * background relay, contract-true on both ends), copy, refresh identity and
 * the views. Layout comes from the harness doubles (virtualizer, resize
 * observer); code blocks never load a highlighter.
 */
import { cleanup, fireEvent, screen, within } from '@solidjs/testing-library';
import type { JSX } from 'solid-js';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { IntersectionGate } from '../../../../components/ui/code-block';
import type { VirtualizerFactory } from '../../../../components/ui/virtual-list';
import { boundWprDetections, PAYLOAD_LIMITS } from '../../../../lib/messaging/payload-bounds';
import {
  createScriptSnapshotId,
  readScriptSourceChunk,
  SCRIPT_SOURCE_CHUNK_CHARS,
  type ScriptSourceRequest
} from '../../../../lib/messaging/script-source';
import {
  keepServedScriptTags,
  readServedScriptTag,
  type ServedScriptTagRequest
} from '../../../../lib/messaging/served-script-tag';
import type { TabAsks } from '../../../../lib/messaging/tab-asks';
import { parseTabRelayRequest, type TabRelayRequest } from '../../../../lib/messaging/tab-relay';
import { relayTabAsks } from '../../../../lib/messaging/tab-relay-client';
import type { DelayedScriptRecord, FdtData } from '../../../../lib/wp-rocket/types';
import { makeDelayScript, makeFdtData } from '../../state/fixtures';
import { SEARCH_DEBOUNCE_MS } from '../../state/search';
import type { OpenResource } from '../open-resource';
import {
  installFakeResizeObserver,
  type FakeResizeObservers
} from '../resource-list/fake-resize-observer';
import { renderPage, renderWindowedRows, type PageHarness } from '../resource-list/page-harness';
import type { CodeBlockSeams } from './code-seams';
import { JAVASCRIPT_TAB_LABELS, JavaScriptPage, listCutNote, type JavaScriptSeams } from './page';
import { SERVED_TAG_NOTES, SOURCE_READ_NOTE } from './script-detail';
import { createServedTagReader, createSourceChunkReader } from './source-chunk-reader';

/** Code-block seams: no highlighter load, no observer (raw text stays). */
const CODE_SEAMS: CodeBlockSeams = {
  createObserver: (): IntersectionGate => ({
    observe: () => undefined,
    disconnect: () => undefined
  }),
  loadHighlighter: () => new Promise<never>(() => undefined),
  watchOverflow: (_box, _content, onChange) => {
    onChange(false);
    return () => undefined;
  }
};

/** A fixed snapshot id the fixtures' reads answer for. */
const SNAPSHOT = createScriptSnapshotId();

/** The page's fixture scripts: every row shape the page renders. */
function scripts(): DelayedScriptRecord[] {
  return [
    makeDelayScript({ src: 'https://example.test/js/jquery.js?ver=3', delayed: true }),
    makeDelayScript({
      src: 'https://example.test/cart.js',
      delayed: false,
      deferred: true,
      deferredByWPR: true,
      minifyAttribute: true
    }),
    makeDelayScript({ src: '', delayed: false }),
    {
      inline: true,
      content: 'line1();\n  line2();\nline3();',
      delayed: true,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      minifyAttribute: false,
      originalType: 'module'
    },
    {
      inline: true,
      content: 'tiny();',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: 'delay_js',
      minifyAttribute: false
    },
    {
      inline: true,
      content: '',
      delayed: false,
      deferred: false,
      deferredByWPR: false,
      fdtExcluded: null,
      minifyAttribute: false
    }
  ];
}

/** Page data around a script list (with the fixed snapshot id). */
function dataWith(
  list: DelayedScriptRecord[],
  options: { present?: boolean; version?: string | null; snapshot?: boolean } = {}
): FdtData {
  const base = makeFdtData();
  return makeFdtData({
    ...(options.snapshot === false ? {} : { scriptSnapshotId: SNAPSHOT }),
    wprDetections: {
      ...base.wprDetections,
      delay_js: {
        present: options.present ?? true,
        scripts: list,
        version: options.version === undefined ? '2.0.4' : options.version,
        delayedScripts: list.filter((s) => s.delayed).length
      }
    }
  });
}

/** Served tags answering every fixture script; the fifth (inline) one is an import map. */
function tagReads(
  list: DelayedScriptRecord[]
): (request: ServedScriptTagRequest) => Promise<unknown> {
  const tags = list.map((script, index) => ({
    tag: `<script data-at="${String(index)}"${script.inline ? '' : ` src="${script.src ?? ''}"`}>`,
    type: script.inline && index === 4 ? 'importmap' : null
  }));
  return (request) => Promise.resolve(readServedScriptTag(tags, SNAPSHOT, request));
}

let observers: FakeResizeObservers;

beforeEach(() => {
  observers = installFakeResizeObserver();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

/** Render the page at a list width (pane from 830). */
function mount(
  data: FdtData = dataWith(scripts()),
  options: { width?: number; seams?: JavaScriptSeams; virtualizer?: VirtualizerFactory } = {}
): PageHarness {
  const seams: JavaScriptSeams = {
    codeBlock: CODE_SEAMS,
    openResource: null,
    readServedTag: tagReads(data.wprDetections.delay_js.scripts),
    runtimeStates: () => <p data-fdt="runtime-double">Runtime</p>,
    ...options.seams
  };
  const harness = renderPage(
    (props): JSX.Element => <JavaScriptPage {...props} {...seams} />,
    data,
    options.virtualizer ?? renderWindowedRows
  );
  observers.resize(options.width ?? 1000);
  return harness;
}

/** Every rendered row. */
function rows(): HTMLElement[] {
  return [...document.querySelectorAll<HTMLElement>('[data-fdt="script-row"]')];
}

/** The rendered rows' names, in order. */
function names(): string[] {
  return rows().map((row) => row.querySelector('[data-fdt="list-row-name"]')?.textContent ?? '');
}

/** A row by its name. */
function rowNamed(name: string): HTMLElement {
  const row = rows().find(
    (candidate) => candidate.querySelector('[data-fdt="list-row-name"]')?.textContent === name
  );
  if (row === undefined) throw new Error(`no row ${name}`);
  return row;
}

/** Open a row's detail by its name. */
function open(name: string): void {
  const button = rowNamed(name).querySelector<HTMLButtonElement>('[data-fdt-row-open]');
  if (button === null) throw new Error(`no open button on ${name}`);
  fireEvent.click(button);
}

/** The side pane (throws when closed). */
function pane(): HTMLElement {
  const found = document.querySelector<HTMLElement>('[data-fdt="detail-pane"]');
  if (found === null) throw new Error('no detail pane');
  return found;
}

/** A facet segment's radio. */
function segment(value: string): HTMLInputElement {
  const input = document.querySelector<HTMLInputElement>(
    `[data-fdt="facet-bar"] [data-fdt-choice-value="${value}"] input`
  );
  if (input === null) throw new Error(`no segment ${value}`);
  return input;
}

/**
 * One fixture script by position.
 *
 * @param index The position.
 */
function fixtureScript(index: number): DelayedScriptRecord {
  const script = scripts()[index];
  if (script === undefined) throw new Error(`no fixture script ${String(index)}`);
  return script;
}

/** Let promise reactions and queued effects settle. */
async function settle(): Promise<void> {
  for (let round = 0; round < 6; round += 1) await Promise.resolve();
}

describe('JavaScript page — summary', () => {
  it('renders the Delay JS state, its version and the script total', () => {
    mount();
    const summary = document.querySelector('[data-fdt="script-summary"]') as HTMLElement;
    expect(summary.textContent).toContain('Delay JavaScript execution');
    expect(summary.textContent).toContain('Detected');
    expect(summary.textContent).toContain('v2.0.4');
    expect(summary.querySelector('[data-fdt="script-total"]')?.textContent).toBe('6 scripts');
  });

  it('says "Not detected" without a version when Delay JS is absent', () => {
    mount(dataWith(scripts(), { present: false, version: null }));
    const summary = document.querySelector('[data-fdt="script-summary"]') as HTMLElement;
    expect(summary.textContent).toContain('Not detected');
    expect(summary.textContent).not.toContain('2.0.4');
  });

  it('notes a list cut at its cap and floors the total', () => {
    const list = Array.from({ length: PAYLOAD_LIMITS.delayScripts.count }, (_, index) =>
      makeDelayScript({ src: `/s${String(index)}.js` })
    );
    const data = dataWith(list);
    data.wprDetections.delay_js.truncated = true;
    mount(data);
    expect(document.querySelector('[data-fdt="script-list-cut"]')?.textContent).toBe(
      listCutNote(PAYLOAD_LIMITS.delayScripts.count)
    );
    expect(document.querySelector('[data-fdt="script-total"]')?.textContent).toBe('5,000+ scripts');
  });
});

describe('JavaScript page — calm rows', () => {
  it('names each row: file name, empty src, inline ordinal', () => {
    mount();
    expect(names()).toEqual([
      'jquery.js',
      'cart.js',
      'Empty src attribute',
      'Inline script #1',
      'Inline script #2',
      'Inline script #3'
    ]);
  });

  it('previews the URL without its scheme, collapsed code with its type first, and why code is missing', () => {
    mount();
    const previews = rows().map(
      (row) => row.querySelector('[data-fdt="list-row-preview"]')?.textContent
    );
    expect(previews).toEqual([
      'example.test/js/jquery.js?ver=3',
      'example.test/cart.js',
      '',
      'module · line1(); line2(); line3();',
      'tiny();',
      'Empty inline script'
    ]);
  });

  it('sizes inline rows only, in characters', () => {
    mount();
    const sizes = rows().map(
      (row) => row.querySelector('[data-fdt="list-row-size"]')?.textContent ?? null
    );
    expect(sizes).toEqual([null, null, null, '28', '7', '0']);
    expect(document.querySelector('[data-fdt="list-head"]')?.textContent).toContain('Chars');
  });

  it('shows the row states and the source legend once', () => {
    mount();
    expect(rowNamed('cart.js').textContent).toContain('Deferred');
    expect(rowNamed('Inline script #2').textContent).toContain('Excluded');
    expect(document.querySelectorAll('[data-fdt="state-source-legend"]')).toHaveLength(1);
  });

  it('marks a clipped inline capture and floors its size', () => {
    const text = 'x'.repeat(PAYLOAD_LIMITS.delayScripts.content + 10);
    const data = dataWith([{ ...fixtureScript(4), content: text, fdtExcluded: null }]);
    mount({ ...data, wprDetections: boundWprDetections(data.wprDetections) });
    const row = rows()[0] as HTMLElement;
    expect(row.textContent).toContain('Clipped');
    expect(row.querySelector('[data-fdt="list-row-size"]')?.textContent).toBe('≥ 524.2K');
  });

  it('renders no code block in any row', () => {
    mount();
    expect(
      document.querySelector('[data-fdt="calm-list-rows"] [data-fdt="code-block"]')
    ).toBeNull();
  });
});

describe('JavaScript page — facets and search', () => {
  it('narrows by Delay, composed with Type', () => {
    mount();
    fireEvent.click(segment('delayed'));
    expect(names()).toEqual(['jquery.js', 'Inline script #1']);
    fireEvent.click(segment('inline'));
    expect(names()).toEqual(['Inline script #1']);
  });

  it('composes the committed query (URLs and code) with the facets', () => {
    vi.useFakeTimers();
    const harness = mount();
    harness.search.perform('tiny');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(names()).toEqual(['Inline script #2']);
    harness.search.perform('example.test');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    fireEvent.click(segment('non-delayed'));
    expect(names()).toEqual(['cart.js']);
  });

  it('names the narrowing in the filtered-empty state and clears it in one click', () => {
    vi.useFakeTimers();
    const harness = mount();
    fireEvent.click(segment('delayed'));
    harness.search.perform('no-such-code');
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(rows()).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'Clear filters' }));
    expect(rows()).toHaveLength(6);
  });

  it('commits typed text after the quiet period', () => {
    vi.useFakeTimers();
    mount();
    fireEvent.input(screen.getByRole('searchbox', { name: 'Search scripts' }), {
      target: { value: 'cart' }
    });
    vi.advanceTimersByTime(SEARCH_DEBOUNCE_MS);
    expect(names()).toEqual(['cart.js']);
  });

  it('shows the empty state without facets or list on a page with no scripts', () => {
    mount(dataWith([]));
    expect(screen.getByText('No scripts on this page')).toBeTruthy();
    expect(document.querySelector('[data-fdt="facet-bar"]')).toBeNull();
  });
});

describe('JavaScript page — detail pane', () => {
  it('opens an external script: kind, title, chips, facts, a new-tab tile without Sources', async () => {
    mount();
    open('cart.js');
    await settle();
    const detail = pane();
    expect(detail.querySelector('[data-fdt="detail-kind"]')?.textContent).toBe('External script');
    expect(detail.querySelector('[data-fdt="detail-title"]')?.textContent).toBe('cart.js');
    expect(detail.querySelector('[data-fdt="script-detail-chips"]')?.textContent).toContain(
      'Deferred'
    );
    const facts = detail.querySelector('[data-fdt="script-facts"]')?.textContent ?? '';
    expect(facts).toContain('WP Rocket defer');
    expect(facts).toContain('data-rocket-defer');
    expect(facts).toContain('data-minify="1"');
    expect(
      detail.querySelector('[data-fdt="source-link-open"]')?.getAttribute('data-fdt-action')
    ).toBe('new-tab');
  });

  it('offers Open in Sources when DevTools has it, handing it the parsed URL', async () => {
    const opened: string[] = [];
    const openResource: OpenResource = (url) => {
      opened.push(url);
      return Promise.resolve();
    };
    mount(dataWith([makeDelayScript({ src: 'https://example.test/a.js?v=1#frag' })]), {
      seams: { openResource }
    });
    open('a.js');
    await settle();
    const tile = pane().querySelector<HTMLElement>('[data-fdt="source-link-open"]');
    expect(tile?.getAttribute('data-fdt-action')).toBe('sources');
    tile?.click();
    await settle();
    // The capability itself drops the fragment (its own tests; e2e on the real one).
    expect(opened).toEqual(['https://example.test/a.js?v=1#frag']);
  });

  it('shows the served tag as an HTML block, asked once at the row’s capture position', async () => {
    const asked: ServedScriptTagRequest[] = [];
    const reads = tagReads(scripts());
    mount(undefined, {
      seams: {
        readServedTag: (request) => {
          asked.push(request);
          return reads(request);
        }
      }
    });
    open('cart.js');
    await settle();
    const served = pane().querySelector('[data-fdt="script-served-tag"]') as HTMLElement;
    expect(served.querySelector('[data-fdt="code-block"]')?.textContent).toContain(
      '<script data-at="1" src="https://example.test/cart.js">'
    );
    expect(asked).toEqual([{ snapshotId: SNAPSHOT, scriptIndex: 1 }]);
  });

  it.each([
    ['gone', { status: 'gone' }, SERVED_TAG_NOTES.gone],
    ['not kept', { status: 'error', reason: 'not-kept' }, SERVED_TAG_NOTES['not-kept']],
    ['malformed', { status: 'ok', tag: '<style>', type: null }, SERVED_TAG_NOTES.unreadable]
  ])(
    'hides the served block with a one-line note when the tag is %s',
    async (_name, answer, note) => {
      mount(undefined, { seams: { readServedTag: () => Promise.resolve(answer) } });
      open('cart.js');
      await settle();
      const served = pane().querySelector('[data-fdt="script-served-tag"]') as HTMLElement;
      expect(served.querySelector('[data-fdt="code-block"]')).toBeNull();
      expect(served.querySelector('[data-fdt="script-served-tag-note"]')?.textContent).toBe(note);
    }
  );

  it('notes an unreachable page instead of the served block', async () => {
    mount(undefined, { seams: { readServedTag: () => Promise.reject(new Error('No receiver')) } });
    open('cart.js');
    await settle();
    expect(pane().querySelector('[data-fdt="script-served-tag-note"]')?.textContent).toBe(
      SERVED_TAG_NOTES.unreachable
    );
  });

  it('says why when the page data carries no snapshot, asking nothing', async () => {
    const readServedTag = vi.fn(() => Promise.resolve({ status: 'gone' }));
    mount(dataWith(scripts(), { snapshot: false }), { seams: { readServedTag } });
    open('cart.js');
    await settle();
    expect(pane().querySelector('[data-fdt="script-served-tag-note"]')?.textContent).toBe(
      SERVED_TAG_NOTES['no-snapshot']
    );
    expect(readServedTag).not.toHaveBeenCalled();
  });

  it('shows a delayed inline script’s full code as JavaScript', async () => {
    mount();
    open('Inline script #1');
    await settle();
    const source = pane().querySelector('[data-fdt="script-source"]') as HTMLElement;
    expect(source.textContent).toContain('3 lines');
    const block = source.querySelector('[data-fdt="code-block"]') as HTMLElement;
    expect(block.textContent).toContain('line1();\n  line2();\nline3();');
    expect(block.textContent).toContain('javascript');
  });

  it('reads an undelayed inline script as JSON when its served type says so', async () => {
    mount();
    open('Inline script #2');
    await settle();
    const block = pane().querySelector('[data-fdt="script-source"] [data-fdt="code-block"]');
    expect(block?.textContent).toContain('json');
    expect(block?.textContent).toContain('tiny();');
  });

  it('says a blank inline script is empty, with no code and no header copy', async () => {
    mount();
    open('Inline script #3');
    await settle();
    const source = pane().querySelector('[data-fdt="script-source"]') as HTMLElement;
    expect(source.textContent).toContain('Empty inline script');
    expect(source.querySelector('[data-fdt="code-block"]')).toBeNull();
    expect(within(pane()).queryByRole('button', { name: /copy/iu })).toBeNull();
  });

  it('says there is no WP Rocket state on a plain script', async () => {
    mount(dataWith([makeDelayScript({ src: '/plain.js', delayed: false })]));
    open('plain.js');
    await settle();
    expect(pane().querySelector('[data-fdt="script-no-state"]')).not.toBeNull();
    expect(pane().querySelector('[data-fdt="script-facts"]')).toBeNull();
  });

  it('keeps the selection across a refresh, and says when the row is gone', async () => {
    const harness = mount();
    open('cart.js');
    await settle();
    harness.refresh(dataWith(scripts()));
    await settle();
    expect(pane().querySelector('[data-fdt="detail-title"]')?.textContent).toBe('cart.js');
    harness.refresh(
      dataWith(scripts().filter((script) => script.src !== 'https://example.test/cart.js'))
    );
    await settle();
    expect(pane().querySelector('[data-fdt="detail-gone"]')).not.toBeNull();
  });

  it('renumbers inline names in place when a script lands above', async () => {
    const harness = mount();
    const before = rowNamed('Inline script #2');
    harness.refresh(dataWith([fixtureScript(3), ...scripts()]));
    await settle();
    expect(rowNamed('Inline script #3')).toBe(before);
  });
});

describe('JavaScript page — drill-in', () => {
  it('replaces the list below the split width, Back returning to it', async () => {
    mount(undefined, { width: 600 });
    expect(document.querySelector('[data-fdt="calm-list"]')?.getAttribute('data-fdt-layout')).toBe(
      'drill'
    );
    open('jquery.js');
    await settle();
    const drill = document.querySelector('[data-fdt="drill-detail"]') as HTMLElement;
    expect(drill.querySelector('[data-fdt="detail-title"]')?.textContent).toBe('jquery.js');
    expect(drill.querySelector('[data-fdt="drill-position"]')?.textContent).toBe('1 of 6');
    fireEvent.click(drill.querySelector('[data-fdt="drill-back"]') as HTMLElement);
    expect(document.querySelector('[data-fdt="drill-detail"]')).toBeNull();
  });
});

describe('JavaScript page — complete source reads', () => {
  /** A bounded inline capture: the payload clipped the text, the snapshot holds it all. */
  function clipped(): { raw: DelayedScriptRecord[]; data: FdtData; source: string } {
    const source = 'y'.repeat(PAYLOAD_LIMITS.delayScripts.content + 5);
    const raw = [{ ...fixtureScript(4), content: source, fdtExcluded: null }];
    const data = dataWith(raw);
    return {
      raw,
      source,
      data: { ...data, wprDetections: boundWprDetections(data.wprDetections) }
    };
  }

  it('reads the complete source into the detail and copies it whole', async () => {
    const { raw, data, source } = clipped();
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount(data, {
      seams: {
        readSourceChunk: (request: ScriptSourceRequest) =>
          Promise.resolve(readScriptSourceChunk(raw, SNAPSHOT, request))
      }
    });
    open('Inline script #1');
    await vi.waitFor(() => {
      expect(pane().querySelector('[data-fdt="script-source-cut"]')).not.toBeNull();
    });
    expect(pane().querySelector('[data-fdt="script-source-partial"]')).toBeNull();
    fireEvent.click(within(pane()).getByRole('button', { name: 'Inline script — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith(source);
    });
  });

  it('keeps the captured part, noted, when the complete read fails', async () => {
    const { data } = clipped();
    mount(data, { seams: { readSourceChunk: () => Promise.resolve({ status: 'unavailable' }) } });
    open('Inline script #1');
    await vi.waitFor(() => {
      expect(pane().querySelector('[data-fdt="script-source-partial"]')?.textContent).toBe(
        SOURCE_READ_NOTE
      );
    });
    expect(
      pane().querySelector('[data-fdt="script-source"] [data-fdt="code-block"]')
    ).not.toBeNull();
  });

  it('reads both asks through the background relay against the real content-side readers', async () => {
    const { raw, data, source } = clipped();
    const parsed = new DOMParser().parseFromString(
      '<!doctype html><script type="text/plain" data-x="1"></script>',
      'text/html'
    );
    const tags = keepServedScriptTags([...parsed.querySelectorAll('script')]);
    // The background's side, contract-true: validate, then forward to the tab.
    const tab: TabAsks = {
      processPageData: () => Promise.resolve(true),
      getFdtData: () => Promise.resolve(null),
      getScriptSourceChunk: (_tabId, request) =>
        Promise.resolve(readScriptSourceChunk(raw, SNAPSHOT, request)),
      getServedScriptTag: (_tabId, request) =>
        Promise.resolve(readServedScriptTag(tags, SNAPSHOT, request)),
      startRucssTest: () => Promise.resolve(null),
      applyRucssTest: () => Promise.resolve(null),
      runBeaconTest: () => Promise.resolve(null),
      runLcpAnalysis: () => Promise.resolve(null),
      getScriptRuntimeStatuses: () => Promise.resolve(null),
      getCurrentVisitVitals: () => Promise.resolve(null),
      listPageStyles: () => Promise.resolve(null),
      listPageStylesheets: () => Promise.resolve(null)
    };
    const relayed: TabRelayRequest[] = [];
    const deps = {
      asks: () =>
        relayTabAsks(async (request) => {
          relayed.push(request);
          const valid = parseTabRelayRequest(request);
          return valid === null
            ? { ok: false, failure: 'invalid-request' }
            : { ok: true, answer: await valid.forward(tab) };
        }),
      inspectedTabId: () => 9
    };
    mount(data, {
      seams: {
        readSourceChunk: createSourceChunkReader(deps),
        readServedTag: createServedTagReader(deps)
      }
    });
    open('Inline script #1');
    await vi.waitFor(() => {
      expect(
        pane().querySelector('[data-fdt="script-served-tag"] [data-fdt="code-block"]')?.textContent
      ).toContain('<script type="text/plain" data-x="1">');
      expect(pane().querySelector('[data-fdt="script-source-cut"]')).not.toBeNull();
    });
    const chunks = Math.ceil(source.length / SCRIPT_SOURCE_CHUNK_CHARS);
    expect(relayed.filter((request) => request.ask === 'getScriptSourceChunk')).toHaveLength(
      chunks
    );
    expect(relayed.filter((request) => request.ask === 'getServedScriptTag')).toEqual([
      { tabId: 9, ask: 'getServedScriptTag', payload: { snapshotId: SNAPSHOT, scriptIndex: 0 } }
    ]);
  });

  it('copies an unbounded external URL as shown', async () => {
    const writeText = vi.fn(() => Promise.resolve());
    Object.defineProperty(navigator, 'clipboard', { value: { writeText }, configurable: true });
    mount();
    open('cart.js');
    await settle();
    fireEvent.click(within(pane()).getByRole('button', { name: 'Script URL — copy' }));
    await vi.waitFor(() => {
      expect(writeText).toHaveBeenCalledWith('https://example.test/cart.js');
    });
  });
});

describe('JavaScript page — views', () => {
  it('opens on the served scripts and swaps in the Runtime states section on its tab', () => {
    mount();
    expect(rows()).toHaveLength(6);
    fireEvent.click(screen.getByRole('tab', { name: JAVASCRIPT_TAB_LABELS.runtime }));
    expect(document.querySelector('[data-fdt="runtime-double"]')).not.toBeNull();
    expect(rows()).toHaveLength(0);
  });
});
