/**
 * Whether the detection widget shows on this page: the on-page UI gate
 * outranks the per-site opt-in. The widget shows only while the gate's
 * surface runs AND this origin's effective opt-in (its stored entry, else
 * the global default) is on; an opt-in not read yet hides it. The opt-in
 * itself is never touched by the gate, so a site's choice holds across a
 * gate off → on.
 *
 * @param pageUiRunning Whether the gate lets on-page UI show here now.
 * @param siteEnabled The origin's effective opt-in; null while unknown.
 * @returns Whether to mount the widget.
 */
export function widgetVisible(pageUiRunning: boolean, siteEnabled: boolean | null): boolean {
  return pageUiRunning && siteEnabled === true;
}
