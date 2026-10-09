/**
 * Fixture: `?fdt-error=reference` — throws a ReferenceError at (non-delayed) load time.
 *
 * The identifier below is deliberately never defined anywhere on the site, so executing
 * this file always produces `ReferenceError: fdtFixtureReference is not defined` — the
 * exact shape the undefined-references capture extracts (`ReferenceError: X is not defined`).
 */
fdtFixtureReference();
