/**
 * Fixture: `?fdt-error=minified` — throws a ReferenceError whose name is one letter.
 *
 * A browser reports minified names verbatim (no source-map rewriting in the error
 * text), so a bundle's failure arrives as e.g. `ReferenceError: a is not defined` —
 * a one-letter word the debugging tool's undefined-references card qualifies with
 * its minified-code note. The error is constructed explicitly instead of calling
 * an undefined one-letter identifier on purpose: the page's other scripts (minified
 * bundles especially) could define such a name before this file runs and take the
 * throw away, and a fixture must fire on every run. The message is byte-for-byte
 * what `a();` produces with `a` undefined, and the capture extracts `a` from it
 * exactly as it would from a real throw — the definition search then answers the
 * page's sources, where one-letter names match plenty of coincidental candidates
 * (the found-verdict replay for single letters).
 */
throw new ReferenceError('a is not defined');
