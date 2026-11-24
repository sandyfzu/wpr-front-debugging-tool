/**
 * The engine worker's side of the preempting runner protocol
 * (`./transform-worker`): validate each structured-cloned request, run the
 * pipeline, post its step announcements and result. Imported only by the
 * worker entry, so the engine lives in the worker's bundle alone.
 */
import type { DocumentBytes } from '../exclusion-builder/libxml/charset';
import { parseExclusionSet } from '../messaging/exclusion-session';
import { parseDocumentSimulationInput } from '../messaging/exclusion-simulation';
import { isCount } from '../messaging/guard-policy';
import { isRecord } from '../../utils/is-record';
import { runDocumentPipeline } from './document-pipeline';
import type { TransformWorkerMessage, TransformWorkerRequest } from './transform-worker';

/**
 * Parse a host request (structured-cloned into the worker).
 *
 * @returns The request, or null when malformed.
 */
export function parseTransformWorkerRequest(data: unknown): TransformWorkerRequest | null {
  if (!isRecord(data) || data['type'] !== 'transform' || !isCount(data['id'])) return null;
  const raw = data['request'];
  if (!isRecord(raw) || typeof raw['html'] !== 'string') return null;
  const budgetMs = raw['budgetMs'];
  if (typeof budgetMs !== 'number' || !Number.isFinite(budgetMs) || budgetMs <= 0) return null;
  const set = parseExclusionSet(raw['set'], 'reject');
  if (set === null) return null;
  const bytes = parseDocumentBytes(raw['bytes']);
  if (bytes === null) return null;
  const rawSimulate = raw['simulate'];
  const simulate =
    rawSimulate === undefined
      ? undefined
      : parseDocumentSimulationInput(rawSimulate, raw['html'].length);
  if (simulate === null) return null;
  return {
    type: 'transform',
    id: data['id'],
    request: {
      html: raw['html'],
      set,
      budgetMs,
      ...(bytes === undefined ? {} : { bytes }),
      ...(simulate === undefined ? {} : { simulate })
    }
  };
}

/** The longest encoding name a request may carry (WHATWG names are far shorter). */
const ENCODING_NAME_LIMIT = 64;

/**
 * Parse a request's optional decoding facts.
 *
 * @returns The facts, `undefined` when absent, or `null` when malformed.
 */
function parseDocumentBytes(raw: unknown): DocumentBytes | undefined | null {
  if (raw === undefined) return undefined;
  if (!isRecord(raw)) return null;
  const encoding = raw['encoding'];
  const bom = raw['bom'];
  if (typeof encoding !== 'string' || encoding.length > ENCODING_NAME_LIMIT) return null;
  return typeof bom === 'boolean' ? { encoding, bom } : null;
}

/**
 * The worker side: run one request and post its step announcements and
 * result. Malformed requests are dropped (the host's deadline answers
 * them). An `engine-failed` cause crosses as its message only (an
 * arbitrary thrown value may not be cloneable).
 *
 * @param data The received message data.
 * @param post The worker's `postMessage`.
 * @param now The monotonic clock; defaults to `performance.now`.
 */
export function handleTransformWorkerMessage(
  data: unknown,
  post: (message: TransformWorkerMessage) => void,
  now: () => number = () => performance.now()
): void {
  const parsed = parseTransformWorkerRequest(data);
  if (parsed === null) return;
  const { id, request } = parsed;
  const result = runDocumentPipeline(request, now, (feature, stage) => {
    post({ type: 'step', id, feature, ...(stage === undefined ? {} : { stage }) });
  });
  if (result.ok || result.cause === undefined) {
    post({ type: 'result', id, result });
    return;
  }
  const cause =
    result.cause instanceof Error
      ? result.cause.message
      : typeof result.cause === 'string'
        ? result.cause
        : 'Non-error engine failure';
  post({ type: 'result', id, result: { ok: false, outcome: result.outcome, cause } });
}
