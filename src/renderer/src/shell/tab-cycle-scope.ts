/**
 * Who gets `Ctrl+Tab` / `Ctrl+Shift+Tab` when focus is not on the sessions (`change-view-keyboard`).
 *
 * `KeyboardNavigation` owns these keys from a **window capture** listener, which runs before any
 * listener a view could attach (React's `onKeyDownCapture` is dispatched from the root container,
 * later in the same capture phase) and stops the event there. So a view cannot take the key by
 * listening for it; it registers here, and `KeyboardNavigation` hands the key over when the event
 * was dispatched inside the registered element.
 *
 * That keeps one place deciding "a dialog or menu is open, do nothing" and one place consuming the
 * key. A second handler with its own copy of that rule would drift from the first without anything
 * turning red (design D3).
 *
 * One registration at a time: only the OpenSpec change view uses it, and only one is mounted.
 */
export interface TabCycleScope {
  element: HTMLElement
  cycle: (delta: 1 | -1) => void
}

let current: TabCycleScope | null = null

/** Registers `scope`; the returned function unregisters it (and nothing registered after it). */
export function registerTabCycleScope(scope: TabCycleScope): () => void {
  current = scope
  return () => {
    if (current === scope) current = null
  }
}

/** The registered scope if `target` lies inside its element, otherwise `null`. */
export function tabCycleScopeFor(target: EventTarget | null): TabCycleScope | null {
  if (!current || !(target instanceof Node)) return null
  return current.element.contains(target) ? current : null
}
