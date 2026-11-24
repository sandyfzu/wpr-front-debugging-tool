/**
 * The Lazyload page's lazy entry: the panel imports the page through this
 * module only, so the page's chunk is named after it (`lazyload-*.js`, its
 * own budget row) rather than the generic `page`.
 */
export { LazyloadPage } from './page';
