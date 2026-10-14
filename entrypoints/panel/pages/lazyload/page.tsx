/**
 * The Lazyload route's page body — the shared placeholder until the page ships.
 * `pages.tsx` already maps the route to this export: the page's work replaces
 * this body (same export name) and adds its tests beside it in this folder.
 */
import { placeholderPage } from '../placeholder';

/** The Lazyload page body (placeholder for now). */
export const LazyloadPage = placeholderPage('lazyload');
