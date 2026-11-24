/**
 * The exclusion pipeline's step ids, declared without its transforms: a
 * host that only names steps (a worker's host billing an overrun, a display)
 * imports these and never pulls the engine into its bundle. `__PURE__`
 * marks let a bundle that names no step drop the tables.
 */
import { EXCLUSION_FEATURES, type ExclusionFeatureId } from './set';

/** The pipeline's feature order (the set registry's), for consumers that display it. */
export const EXCLUSION_PIPELINE_IDS: readonly ExclusionFeatureId[] =
  /*#__PURE__*/ EXCLUSION_FEATURES.map((spec) => spec.id);

/** The feature whose work the inline-pass replay is (WP Rocket's Defer JS). */
export const INLINE_PASS_FEATURE: ExclusionFeatureId = 'defer_all_js';

/**
 * The ids of the pipeline's steps, in execution order: the inline-pass
 * replay (as Defer JS), then the features.
 */
export const EXCLUSION_PIPELINE_STEP_IDS: readonly ExclusionFeatureId[] = /*#__PURE__*/ [
  // Widened: the const's use narrows to its literal, and `concat` takes the array's element type.
  INLINE_PASS_FEATURE as ExclusionFeatureId
].concat(EXCLUSION_PIPELINE_IDS);
