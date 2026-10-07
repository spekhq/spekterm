import { type CloseRole, type ClosePrompt, type LiveSession, closePrompt } from './close-prompt'
import type { DirtyEntry } from './dirty-state'

/**
 * The window's one `close` handler (`workspace-app-shell`, design C1 and C3 of
 * `maximize-panel-and-confirm-close`).
 *
 * It replaces the unsaved-changes guard rather than sitting beside it: two handlers on the same
 * event would each `preventDefault()` and each show a dialog.
 *
 * **No Electron import.** The window, the dialog and the save round trip are injected, so the
 * re-entrancy and quit-flag rules can be unit-tested with a fake window (`close-guard.test.ts`).
 */

/** The part of a `BrowserWindow` the guard uses. */
export interface ClosableWindow {
  on(event: 'close', listener: (event: { preventDefault(): void }) => void): unknown
  close(): void
  isDestroyed(): boolean
  readonly webContents: { readonly id: number }
}

/** Shows a prompt and resolves with the chosen role. */
export type AskClose = (prompt: ClosePrompt) => Promise<CloseRole>

/**
 * Set on `before-quit` by `index.ts`.
 *
 * A close the user starts emits `close` **before** any `before-quit`; a quit started by a signal or
 * the OS emits `before-quit` first (measured with Electron 43.5.0). So `quitting === true` inside
 * the `close` handler means "this close is part of a quit that did not start with closing the
 * window" — the session question is skipped (C3).
 */
export interface QuitState {
  quitting: boolean
}

export interface CloseGuardDeps {
  dirty: { list(contentsId: number): DirtyEntry[] }
  /** The window's sessions that hold a pty, in rail order. Read synchronously. */
  liveSessions: (contentsId: number) => LiveSession[]
  ask: AskClose
  /** Ask the renderer to save everything; `false` on failure or timeout. */
  saveAll: () => Promise<boolean>
  quit: QuitState
}

export function guardWindowClose(window: ClosableWindow, deps: CloseGuardDeps): void {
  const contentsId = window.webContents.id
  let allowClose = false
  /** A prompt is open. Any further close waits for its answer — one question at a time. */
  let asking = false

  const factsFor = (quitting: boolean) => ({
    dirty: deps.dirty.list(contentsId),
    sessions: quitting ? [] : deps.liveSessions(contentsId),
  })

  /** Whether the window may close. Save All that fails asks again rather than deciding to discard. */
  const resolve = async (first: ClosePrompt, quitting: boolean): Promise<boolean> => {
    let prompt: ClosePrompt | null = first
    while (prompt) {
      const role = await deps.ask(prompt)
      if (role === 'cancel') return false
      if (role !== 'saveAll') return true
      if (window.isDestroyed()) return false
      if (await deps.saveAll()) return true
      // Saving failed or timed out (a conflict, a renderer that does not answer). Ask again with
      // what is true now; if nothing is left to ask about, closing loses nothing.
      prompt = closePrompt(factsFor(quitting))
    }
    return true
  }

  window.on('close', (event) => {
    if (allowClose) return

    // Electron cancels a quit the moment a `close` is prevented. A `quitting` flag left set after
    // that would make a later click on ✕ skip the session question — so every prevented close
    // reads the flag and clears it.
    if (asking) {
      event.preventDefault()
      deps.quit.quitting = false
      return
    }

    // The decision must be synchronous: `preventDefault()` only counts inside this call.
    const quitting = deps.quit.quitting
    const prompt = closePrompt(factsFor(quitting))
    if (!prompt) return

    event.preventDefault()
    deps.quit.quitting = false
    asking = true

    void resolve(prompt, quitting)
      .catch((error: unknown) => {
        console.error(`[close] the close confirmation failed: ${String(error)}`)
        return false
      })
      .then((shouldClose) => {
        asking = false
        if (!shouldClose || window.isDestroyed()) return
        allowClose = true
        window.close()
      })
  })
}
