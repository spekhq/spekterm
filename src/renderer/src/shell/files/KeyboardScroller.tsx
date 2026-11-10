import { useCallback } from 'react'
import { focusIsNowhere } from '../terminal/focus-nowhere'

interface KeyboardScrollerProps {
  className?: string
  children: React.ReactNode
}

/**
 * A scroll container for rendered reading content (a markdown preview, a spec) that the keyboard can
 * scroll (`file-viewer`, `openspec-panel`).
 *
 * **Focusable, because the browser only scrolls the focused element's own scroll containers.**
 * Without a tab index a click on the text focuses the side-panel section around it — the scroller is
 * inside that element, not around it, so the arrow keys and `PageDown` do nothing.
 *
 * **It takes focus when it appears, only if focus is nowhere.** Opening a file or a spec replaces the
 * tree row that was clicked, and removing a focused element drops focus to `<body>`; without this the
 * first scrolling key after opening reaches nothing. Focus anywhere else (the terminal, the editor, a
 * button such as the preview / source switch) is the user's and is left alone. A ref callback rather
 * than an effect: it runs when this element mounts, not when its content is refreshed.
 */
export function KeyboardScroller({ className = '', children }: KeyboardScrollerProps): React.JSX.Element {
  const takeFocusIfNowhere = useCallback((element: HTMLDivElement | null) => {
    if (element && focusIsNowhere()) element.focus({ preventScroll: true })
  }, [])

  return (
    <div
      ref={takeFocusIfNowhere}
      tabIndex={0}
      className={`overflow-auto outline-none focus-visible:ring-1 focus-visible:ring-inset focus-visible:ring-accent/50 ${className}`}
    >
      {children}
    </div>
  )
}
