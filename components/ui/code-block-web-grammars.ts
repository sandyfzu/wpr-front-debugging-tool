/**
 * The stylesheet and markup grammars, reached only through the highlighter's
 * dynamic `import()` so they ship as one chunk of their own, fetched by the
 * highlight worker on the first CSS or HTML block — the worker's start (every
 * script or JSON block) never pays for them.
 *
 * One chunk for both: the HTML grammar embeds the CSS one (and JavaScript,
 * which stays in the worker), so splitting them would only add a re-export
 * file without saving a byte on the HTML path.
 */
export { default as css } from 'shiki/langs/css.mjs';
export { default as html } from 'shiki/langs/html.mjs';
