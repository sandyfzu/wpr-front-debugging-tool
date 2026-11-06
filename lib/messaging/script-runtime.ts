/**
 * The live script read's message contract (`getScriptRuntimeStatuses`,
 * DevTools panel → the tab's top frame) and its boundary guard.
 *
 * The page answers the raw attribute values of its live `<script>`
 * elements (in document order, at most {@link SCRIPT_RUNTIME_LIMITS}
 * `.scripts`), read on demand — never the snapshot detection parsed — and
 * the panel classifies them. Strings are capped by the page with `capText`
 * at the classifier's own caps, so the classifier's output is unchanged;
 * script text shares one budget per answer, and a script whose text the
 * budget cut below the classifier's full cap says so (`textCut`).
 */
import { cappedUnits } from '../../utils/cap-text';
import { hasOnlyKeys, isRecord, ownValue } from '../../utils/is-record';
import {
  CLASSES_MAX,
  FIELD_MAX,
  FULL_TEXT_MAX,
  type ScriptDescriptor
} from '../script-runtime/classify';

/** Bounds of one answer. */
export const SCRIPT_RUNTIME_LIMITS = {
  /** Scripts listed (the first ones, in document order). */
  scripts: 1000,
  /**
   * Script text sent per answer, all scripts together (UTF-16 units): past
   * it, each further script carries only its preview.
   */
  textBudgetUnits: 1_048_576
} as const;

/** One live script as the page read it. */
export interface LiveScriptFacts extends ScriptDescriptor {
  /** Whether the answer's text budget cut this script's text below the full-text cap. */
  readonly textCut: boolean;
}

/** The page's answer. */
export interface ScriptRuntimeReply {
  /** The first {@link SCRIPT_RUNTIME_LIMITS}`.scripts` scripts, in document order. */
  readonly scripts: readonly LiveScriptFacts[];
  /** All `<script>` elements on the page at the read. */
  readonly total: number;
}

/** An attribute value's unit cap. */
const FIELD_UNITS = cappedUnits(FIELD_MAX);

/**
 * A string within `max` units, or null (an absent attribute).
 *
 * @param value The boundary value.
 * @param max The unit cap.
 */
function isNullableString(value: unknown, max: number): value is string | null {
  return value === null || (typeof value === 'string' && value.length <= max);
}

/** One script's keys (exact shape). */
const SCRIPT_KEYS = ['type', 'delayedSrc', 'src', 'status', 'id', 'classes', 'text', 'textCut'];

/**
 * Guard one script's facts.
 *
 * @param input The boundary value.
 * @returns The facts, rebuilt, or null.
 */
function parseScript(input: unknown): LiveScriptFacts | null {
  if (!isRecord(input) || !hasOnlyKeys(input, SCRIPT_KEYS)) return null;
  const type = ownValue(input, 'type');
  const delayedSrc = ownValue(input, 'delayedSrc');
  const src = ownValue(input, 'src');
  const status = ownValue(input, 'status');
  const id = ownValue(input, 'id');
  const classes = ownValue(input, 'classes');
  const text = ownValue(input, 'text');
  const textCut = ownValue(input, 'textCut');
  if (!isNullableString(type, FIELD_UNITS) || !isNullableString(delayedSrc, FIELD_UNITS)) {
    return null;
  }
  if (!isNullableString(src, FIELD_UNITS) || !isNullableString(status, FIELD_UNITS)) return null;
  if (typeof id !== 'string' || id.length > FIELD_UNITS || typeof textCut !== 'boolean') {
    return null;
  }
  if (typeof text !== 'string' || text.length > cappedUnits(FULL_TEXT_MAX)) return null;
  if (!Array.isArray(classes) || classes.length > CLASSES_MAX) return null;
  const names: unknown[] = classes;
  if (
    !names.every((name): name is string => typeof name === 'string' && name.length <= FIELD_UNITS)
  ) {
    return null;
  }
  return { type, delayedSrc, src, status, id, classes: Object.freeze([...names]), text, textCut };
}

/**
 * Guard the page's answer (received by the panel).
 *
 * @param input The boundary value.
 * @returns The reply, rebuilt, or null on any violation.
 */
export function parseScriptRuntimeReply(input: unknown): ScriptRuntimeReply | null {
  if (!isRecord(input) || !hasOnlyKeys(input, ['scripts', 'total'])) return null;
  const rawScripts = ownValue(input, 'scripts');
  const total = ownValue(input, 'total');
  if (!Array.isArray(rawScripts) || rawScripts.length > SCRIPT_RUNTIME_LIMITS.scripts) return null;
  if (typeof total !== 'number' || !Number.isSafeInteger(total) || total < rawScripts.length) {
    return null;
  }
  const scripts: LiveScriptFacts[] = [];
  for (const raw of rawScripts as unknown[]) {
    const script = parseScript(raw);
    if (script === null) return null;
    scripts.push(script);
  }
  return { scripts: Object.freeze(scripts), total };
}
