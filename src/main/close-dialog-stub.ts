import fs from 'node:fs'
import path from 'node:path'

import type { AskClose } from './close-guard'
import type { CloseRole, ClosePrompt } from './close-prompt'
import { createWatcher } from './watcher'

/**
 * The acceptance stand-in for the close confirmation's native dialog (design C6 of
 * `maximize-panel-and-confirm-close`).
 *
 * A native dialog cannot be read or answered over CDP, and the close button cannot be clicked on a
 * virtual display. So, under a throwaway profile only (the gate `intake-notify-stub.ts` uses — not an
 * environment variable, because `ptyEnv()` spreads `process.env` into every pty):
 *
 * - every prompt is appended to `dialogs.jsonl` (roles, default, cancel, message, detail);
 * - it is answered with the role written in `answer` (default `cancel`) — at once, or, while a
 *   `hold` file exists, only when `answer` is written again (the only way to have a prompt open
 *   while a second close or a signal arrives);
 * - writing the `close` file makes the main process close the window with `BrowserWindow.close()`,
 *   the documented equivalent of the close button. The renderer's `window.close()` is not: it
 *   closes the window without emitting `close`, past every guard (measured). The file is consumed
 *   and each firing is recorded in `closes.jsonl`, so a relaunch on the same profile does not close
 *   itself, and "the trigger was seen" can be told from "nothing happened".
 *
 * The watcher follows the four rules in `intake-notify-stub.ts`: watch the directory, subscribe to
 * `add` and `change`, check for files after `ready`, filter by basename.
 */

const DIALOGS = 'dialogs.jsonl'
const ANSWER = 'answer'
const HOLD = 'hold'
const CLOSE = 'close'
const CLOSES = 'closes.jsonl'

const ROLES: readonly CloseRole[] = ['saveAll', 'discard', 'quit', 'cancel']

export function stubCloseRoot(userData: string): string {
  return path.join(userData, 'close-stub')
}

export interface CloseDialogStub {
  ask: AskClose
}

export function createCloseDialogStub({
  root,
  closeWindow,
}: {
  root: string
  /** Close the window the way its close button does. */
  closeWindow: () => void
}): CloseDialogStub {
  fs.mkdirSync(root, { recursive: true })
  const answerPath = path.join(root, ANSWER)
  const holdPath = path.join(root, HOLD)
  const closePath = path.join(root, CLOSE)

  /** Prompts waiting for an answer in hold mode. */
  const waiting: { prompt: ClosePrompt; resolve: (role: CloseRole) => void }[] = []

  const readAnswer = (prompt: ClosePrompt): CloseRole => {
    let raw = ''
    try {
      raw = fs.readFileSync(answerPath, 'utf8').trim()
    } catch {
      // No answer file — the default below.
    }
    const role = ROLES.find((candidate) => candidate === raw)
    // An answer the prompt does not offer is treated as cancelling, never as closing.
    return role && prompt.buttons.some((button) => button.role === role) ? role : 'cancel'
  }

  const releaseHeld = (): void => {
    for (const entry of waiting.splice(0)) entry.resolve(readAnswer(entry.prompt))
  }

  const fireClose = (): void => {
    if (!fs.existsSync(closePath)) return
    fs.rmSync(closePath, { force: true })
    fs.appendFileSync(path.join(root, CLOSES), `${JSON.stringify({ at: Date.now() })}\n`, 'utf8')
    closeWindow()
  }

  const watcher = createWatcher({ target: root, depth: 0, label: 'close-stub' })
  const onEvent = (full: string): void => {
    const name = path.basename(full)
    if (name === CLOSE) fireClose()
    else if (name === ANSWER) releaseHeld()
  }
  watcher.on('add', onEvent)
  watcher.on('change', onEvent)
  // A trigger written between creating the watcher and `ready` is swallowed by `ignoreInitial`.
  watcher.on('ready', fireClose)

  return {
    ask: (prompt) => {
      fs.appendFileSync(
        path.join(root, DIALOGS),
        `${JSON.stringify({
          at: Date.now(),
          roles: prompt.buttons.map((button) => button.role),
          defaultRole: prompt.defaultRole,
          cancelRole: prompt.cancelRole,
          message: prompt.message,
          detail: prompt.detail,
        })}\n`,
        'utf8',
      )
      if (!fs.existsSync(holdPath)) return Promise.resolve(readAnswer(prompt))
      return new Promise((resolve) => waiting.push({ prompt, resolve }))
    },
  }
}
