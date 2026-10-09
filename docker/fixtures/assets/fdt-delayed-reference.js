/**
 * Fixture: `?fdt-delay=1` — delayed script that throws only when WP Rocket executes it.
 *
 * WP Rocket's Delay JS holds this file (type moves to `text/rocketlazyloadscript`,
 * src to `data-rocket-src`) until user interaction. When the delay queue runs it,
 * the identifier below — deliberately undefined on purpose — fails with
 * `ReferenceError: fdtDelayTypedDependency is not defined`. This is the scripted
 * reproduction of the classic delayed-execution support scenario: the page is quiet,
 * the error appears exactly when Delay JS executes.
 */
fdtDelayTypedDependency();
