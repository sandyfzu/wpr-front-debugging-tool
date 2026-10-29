/**
 * The background's half of the simulation marker: it draws the id written
 * into each simulated document and remembers it for the document's tab and
 * origin before the document is released (so the page can never ask
 * first), and it answers a page's "is my marker yours?" — the only way a
 * marker becomes an authority for detection. Page markup is untrusted: a
 * forged, saved or other tab's copy of a marker must read as unverified.
 *
 * Storage and randomness are injected (the background binds the memo in
 * `lib/storage/simulation-markers` and `crypto.getRandomValues`).
 */
import type { InterceptedDocument } from './backend';
import type { SimulationSources } from './simulation-sources';
import {
  parseSimulationMarkerQuery,
  type SimulationMarkerVerdict
} from '../messaging/exclusion-simulation';
import { resolveTopFrameSender, type LooseMessageSender } from '../messaging/sender';
import type { SimulationMarkerEntry } from '../storage/simulation-markers';
import { parseUrl, isHttpOrigin } from '../../utils/urls';

/** Bytes in a marker id: 128 random bits. */
const MARKER_ID_BYTES = 16;

/**
 * Draw a marker id: 128 bits from the injected source, as 32 lowercase hex.
 *
 * @param fill Fills a buffer with cryptographically strong random bytes.
 */
export function drawSimulationMarkerId(fill: (bytes: Uint8Array) => void): string {
  const bytes = new Uint8Array(MARKER_ID_BYTES);
  fill(bytes);
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
}

/** What the marker id source needs. */
export interface MarkerIdSourceDeps {
  /** Fills a buffer with cryptographically strong random bytes. */
  readonly fill: (bytes: Uint8Array) => void;
  /** Writes one entry to the tab's memo (rejects when it cannot). */
  readonly remember: (tabId: number, entry: SimulationMarkerEntry) => Promise<unknown>;
}

/**
 * The marker id source: per document about to be simulated, draw an id and
 * remember it for the document's tab and origin, resolving only once the
 * memo holds it. Rejects when the document has no http(s) origin or the
 * write fails — the preparation then fails and the document is served
 * unmodified, never as a simulated page without a verifiable marker. An id
 * is drawn per prepared document, so one whose step ends up not simulating
 * (already served, not applicable) leaves an id no page carries: harmless,
 * it can only be guessed (128 bits).
 *
 * @param deps The random source and the memo write.
 */
export function createMarkerIdSource(deps: MarkerIdSourceDeps): SimulationSources['markerId'] {
  return async (document: InterceptedDocument, simulate) => {
    const origin = parseUrl(document.documentUrl)?.origin;
    if (origin === undefined || !isHttpOrigin(origin)) {
      throw new Error('Simulation marker: the document has no http(s) origin');
    }
    const markerId = drawSimulationMarkerId(deps.fill);
    await deps.remember(document.tabId, { markerId, origin, features: [...simulate.features] });
    return markerId;
  };
}

/** The verdict for a marker no memo entry vouches for. */
const UNVERIFIED: SimulationMarkerVerdict = { features: [] };

/**
 * Answer a page's marker verification: the features the memo entry vouches
 * for when the asking top frame's tab remembers that id for the asking
 * page's origin; `[]` (unverified) for an unknown id, another tab's id or
 * another origin's.
 *
 * @param sender The runtime sender (must resolve to a tab's top frame).
 * @param data The untrusted payload.
 * @param readTab The tab's remembered markers.
 * @returns The verdict. Rejects with an {@link Error} for a sender that is
 *   not a top-frame http(s) page or a malformed payload (the asker reads it
 *   as unverified), and with whatever the memo read rejects with.
 */
export async function answerSimulationMarkerVerify(
  sender: LooseMessageSender | undefined,
  data: unknown,
  readTab: (tabId: number) => Promise<readonly SimulationMarkerEntry[]>
): Promise<SimulationMarkerVerdict> {
  const page = resolveTopFrameSender(sender);
  if (page === null) {
    throw new Error('verifySimulationMarker: only a top-frame page may ask');
  }
  const query = parseSimulationMarkerQuery(data);
  if (query === null) throw new Error('verifySimulationMarker: malformed query refused');
  const entries = await readTab(page.tabId);
  const entry = entries.find(
    (candidate) => candidate.markerId === query.markerId && candidate.origin === page.origin
  );
  return entry === undefined ? UNVERIFIED : { features: [...entry.features] };
}
