/**
 * The devtools panel page's mount (placeholder): the devtools entrypoint
 * registers `panel.html` as the `WPR FDT` panel's target, so the path has to
 * exist from this sub-phase on. The real shell replaces this file's content
 * wholesale (boot + theme-before-mount, hash router, data layer) — nothing
 * worth keeping here.
 */

import { render } from 'solid-js/web';

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing from panel/index.html');

render(() => <h1>WPR FDT — panel placeholder</h1>, root);
