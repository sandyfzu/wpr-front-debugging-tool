/**
 * Fixture: `?fdt-delay=1` — the script that finally defines the dependency the
 * delayed-reference script called.
 *
 * Runs LAST in the delay queue (the enqueue order in fdt-fixtures.php is the
 * delay-execution order), so when the reference script ran, the name below was
 * still undefined — the browser reported `ReferenceError:
 * fdtDelayTypedDependency is not defined` for exactly that moment. This file
 * then assigns the name (a real definition, arriving only after the call that
 * needed it): the order-dependent reproduction the debugging tool's
 * definition search serves as a found verdict — the search answers this file
 * from the page's loaded script sources, and the found card's
 * Copy-as-exclusion row copies its served path into WP Rocket's Delay JS
 * exclusion field.
 *
 * The assignment's shape is deliberate: the name preceded by the `.` of a
 * member access, then ` =` — the assignment form the definition search
 * matches (a bare `var` under the same identifier would equally match, but a
 * member assignment survives minification without renaming questions).
 */
window.fdtDelayTypedDependency = function () {};
