/**
 * Diagnoser extraction: element discovery, JSON repair tolerance, and the
 * explicit "report unreadable" state instead of guesses. Errors are logged
 * at message level only, so hostile text never hits the console.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { parsePage } from '../detection/parse-page';
import { extractDiagnoserData } from './extract';

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {});

afterEach(() => {
  errorSpy.mockClear();
});

function parse(html: string): Document {
  return parsePage(html).document;
}

describe('extractDiagnoserData', () => {
  it('parses both slots from a well-formed diagnoser page', async () => {
    const doc = parse(
      `<html><body>
        <script id="wpr-diagnoser-no-rocket-json-data">{"wpr_plugin":{"version":"3.20"},"server_info":{"server_load":1.5}}</script>
        <script id="wpr-diagnoser-rocket-json-data">{"options":{"delay_js":{"option_name":"delay_js"}},"post_meta_excluded_options":{}}</script>
      </body></html>`
    );
    const result = await extractDiagnoserData(doc);
    expect(result.noRocketData).toEqual({
      wpr_plugin: { version: '3.20' },
      server_info: { server_load: 1.5 }
    });
    expect(result.rocketData).toEqual({
      options: { delay_js: { option_name: 'delay_js' } },
      post_meta_excluded_options: {}
    });
  });

  it('repairs malformed JSON the plugin can print', async () => {
    const doc = parse(
      `<html><body>
        <script id="wpr-diagnoser-no-rocket-json-data">{'server_info': {'web_server': 'nginx',}}</script>
        <script id="wpr-diagnoser-rocket-json-data">{"options": {"delay_js" {"option_name": 1}}}</script>
      </body></html>`
    );
    const result = await extractDiagnoserData(doc);
    // The repaired JSON parses (trailing comma + missing colon tolerated).
    expect(result.noRocketData).toEqual({ server_info: { web_server: 'nginx' } });
    expect(result.rocketData).toEqual({ options: { delay_js: { option_name: 1 } } });
  });

  it('resolves null slots when elements are missing or empty', async () => {
    const doc = parse('<html><body><h1>no diagnoser here</h1></body></html>');
    expect(await extractDiagnoserData(doc)).toEqual({ noRocketData: null, rocketData: null });
    const empty = parse('<script id="wpr-diagnoser-rocket-json-data">   </script>');
    expect(await extractDiagnoserData(empty)).toEqual({ noRocketData: null, rocketData: null });
  });

  it('logs a message-level failure (no page content) for unparsable text', async () => {
    const doc = parse(
      `<script id="wpr-diagnoser-no-rocket-json-data">{{"totally":"not json"}}` +
        `</script>` +
        `<script id="wpr-diagnoser-rocket-json-data">{"ok":true}</script>`
    );
    const result = await extractDiagnoserData(doc);
    expect(result.noRocketData).toBeNull();
    expect(result.rocketData).toEqual({ ok: true });
    expect(errorSpy).toHaveBeenCalledTimes(1);
    expect(String(errorSpy.mock.calls[0]?.[0])).toBe(
      '[WPR FDT] [diagnostics] Diagnoser element #wpr-diagnoser-no-rocket-json-data did not contain parsable JSON'
    );
    // The failing element's text must never leak into logs.
    expect(errorSpy.mock.calls.map((c) => String(c[0])).join(' ')).not.toContain('not json');
  });

  it('rejects non-object JSON payloads (arrays, primitives)', async () => {
    const doc = parse(
      `<script id="wpr-diagnoser-rocket-json-data">[1,2,3]</script>
       <script id="wpr-diagnoser-no-rocket-json-data">"just a string"</script>`
    );
    expect(await extractDiagnoserData(doc)).toEqual({ noRocketData: null, rocketData: null });
  });
});
