/**
 * The simulation marker step: run last, after the builder marker, it
 * writes the marker naming a simulated document (by the id the background
 * drew for it) so detection can tell simulated work from served work.
 *
 * Inert slot: nothing is written until the marker is built here — the
 * pipeline calls it already, so the marker lands without touching it. A
 * report names a marker id only when this step wrote it.
 */

/** The step's result: the document, and whether the marker was written into it. */
export interface SimulationMarkerWrite {
  readonly html: string;
  readonly written: boolean;
}

/**
 * Writes the simulation marker.
 *
 * @param html The finished document (builder marker included).
 * @param markerId The id to write (absent: none drawn — nothing to write).
 * @param simulated Whether a step simulated anything on this document.
 * @returns The document and whether the marker is in it.
 */
export type SimulationMarkerWriter = (
  html: string,
  markerId: string | undefined,
  simulated: boolean
) => SimulationMarkerWrite;

/** The writer the pipeline's last step calls (today: writes nothing). */
export const writeSimulationMarker: SimulationMarkerWriter = (html) => ({ html, written: false });
