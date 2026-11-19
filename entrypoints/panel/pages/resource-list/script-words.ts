/**
 * The words a listed script shows wherever the panel names one — the
 * JavaScript page's two lists (Delay & defer, Runtime states) and the
 * Undefined References definitions: its kind and its URL copy's name.
 */

/** A script's kind, by where its code lives. */
export const SCRIPT_KIND_LABELS = {
  inline: 'Inline script',
  external: 'External script'
} as const;

/** The copy action's name for a script's URL. */
export const SCRIPT_URL_COPY_LABEL = 'Script URL';
