/**
 * Acting on the window from outside it — a notification click, opening the inbox, revealing a handoff
 * brief — when there may be no window, or no renderer ready to hear (`workspace-app-shell`: "On macOS,
 * closing the window leaves the application running and activating it reopens the window").
 *
 * On Linux the process ends with its window, so "no window" never happened. On macOS the application
 * keeps running with none, and the old `bringToFront()` simply returned: a click on a notification did
 * nothing at all. Creating the window is not enough either — the messages that follow are delivered to
 * renderers that have mounted their listeners (`openInbox` broadcasts to those that listed the inbox,
 * `revealHandoffBrief` sends to every window), and a message sent before React has mounted them is lost.
 * `did-finish-load` fires before that, so the renderer says when it is ready (`app:rendererReady`).
 *
 * **No Electron import** — the window is reached through the injected functions, so the waiting rules are
 * unit-tested (`window-presence.test.ts`).
 */

export interface PresenceDeps {
  /** The live window's `webContents.id`, or `null` when there is none. */
  existing(): number | null
  /** Create a window; returns its `webContents.id`. */
  create(): number
  /** Show and focus the live window. */
  bringToFront(): void
  /** How long to wait for a renderer that never says it is ready before acting anyway. */
  readyTimeoutMs?: number
}

export interface WindowPresence {
  /** A window exists, is in front, and its renderer is ready; resolves when all three are true. */
  ensure(): Promise<void>
  /** The renderer of `contentsId` has mounted the listeners that outside actions talk to. */
  rendererReady(contentsId: number): void
  /** The renderer of `contentsId` is gone (destroyed or reloaded); it must say it is ready again. */
  rendererGone(contentsId: number): void
}

const DEFAULT_READY_TIMEOUT_MS = 15_000

export function createWindowPresence(deps: PresenceDeps): WindowPresence {
  const ready = new Set<number>()
  const waiting = new Map<number, (() => void)[]>()

  const whenReady = (contentsId: number): Promise<void> => {
    if (ready.has(contentsId)) return Promise.resolve()
    return new Promise((resolve) => {
      // A renderer that never says so (an older page, a crash) must not leave the action hanging for ever.
      const timer = setTimeout(resolve, deps.readyTimeoutMs ?? DEFAULT_READY_TIMEOUT_MS)
      const done = () => {
        clearTimeout(timer)
        resolve()
      }
      waiting.set(contentsId, [...(waiting.get(contentsId) ?? []), done])
    })
  }

  return {
    async ensure() {
      const contentsId = deps.existing() ?? deps.create()
      deps.bringToFront()
      await whenReady(contentsId)
    },
    rendererReady(contentsId) {
      ready.add(contentsId)
      for (const done of waiting.get(contentsId) ?? []) done()
      waiting.delete(contentsId)
    },
    rendererGone(contentsId) {
      ready.delete(contentsId)
    },
  }
}
