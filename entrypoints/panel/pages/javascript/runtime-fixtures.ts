/**
 * Test fixtures for the Runtime states section: live records classified the
 * way a real read classifies them (imported by tests only — no bundle
 * reaches this module).
 */
import { classifyScript, type ScriptDescriptor } from '../../../../lib/script-runtime/classify';
import type { LiveScriptRecord } from '../../../../lib/script-runtime/read-live';

/** The `type` WP Rocket writes on a delayed tag. */
export const DELAYED = 'rocketlazyloadscript';

/**
 * A live record from descriptor fields (classified like a real read).
 *
 * @param fields The descriptor fields that differ from an empty script.
 * @param fullTextCut Whether the read's text budget cut its code.
 */
export function liveScript(
  fields: Partial<ScriptDescriptor> = {},
  fullTextCut = false
): LiveScriptRecord {
  return {
    ...classifyScript({
      type: null,
      delayedSrc: null,
      src: null,
      status: null,
      id: '',
      classes: [],
      text: '',
      ...fields
    }),
    fullTextCut
  };
}
