/**
 * The document engine's wall-time budget, in a module of its own: the
 * engine (worker included) and the session's time table both read it, and
 * neither pulls the other's imports in for one number.
 */

/**
 * The engine's wall-time budget per document (ms). Measured 2026-10-20 on
 * the local WP site's home page (84 KiB) repeated to size, five-feature
 * set: 84 KiB ≈ 1 ms, 844 KiB ≈ 14 ms, 4.1 MiB ≈ 270 ms — the budget keeps
 * ~7× headroom over a worst-case-sized document on a slower machine while
 * capping what a pathological row can add to a navigation.
 */
export const DOCUMENT_TRANSFORM_BUDGET_MS = 2_000;
