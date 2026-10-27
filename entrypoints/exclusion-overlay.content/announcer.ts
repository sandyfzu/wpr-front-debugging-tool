/**
 * The overlay's polite announcer. A live region reports changes to its
 * text, so writing the same text twice (the same lane copied twice, the
 * same refusal again) would be silent: each announcement clears the region
 * first and writes the text a frame later — two separate changes — and a
 * newer announcement within that frame supersedes the older one.
 */

/**
 * Build the announcer.
 *
 * @param write Sets the live region's text.
 * @param requestFrame Runs a callback on the next animation frame.
 * @returns `announce(text)`.
 */
export function createAnnouncer(
  write: (text: string) => void,
  requestFrame: (run: () => void) => void
): (text: string) => void {
  let latest = 0;
  return (text) => {
    latest += 1;
    const ticket = latest;
    write('');
    requestFrame(() => {
      if (ticket === latest) write(text);
    });
  };
}
