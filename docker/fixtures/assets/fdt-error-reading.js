/**
 * Fixture: `?fdt-error=reading` — throws the reading-of-undefined TypeError at load time.
 *
 * The base object is anchored on `window` (an existing binding) so the identifier
 * itself resolves and the property READ is what fails, producing exactly
 * `TypeError: Cannot read properties of undefined (reading 'fdtFixtureProperty')` —
 * the second extraction shape (`TypeError: Cannot read properties of undefined (reading 'X')`).
 * A bare unresolved identifier would fail earlier as a ReferenceError and never reach
 * the property read.
 */
window.fdtFixtureMissingObject.fdtFixtureProperty;
