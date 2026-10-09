/**
 * Fixture: `?fdt-error=notfunction` — throws the not-a-function TypeError at load time.
 *
 * `document.body` exists when this file runs (script enqueued to head with the DOM
 * preserved), so the call fails with
 * `TypeError: document.body.fdtFixtureNotAFunction is not a function` — the third
 * extraction shape (`TypeError: X is not a function` → last identifier segment).
 */
document.body.fdtFixtureNotAFunction();
