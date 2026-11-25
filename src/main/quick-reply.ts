import type { WaitState } from './agent-events'
import { cleanReply, deliverReply } from './remote-conversation'
import { RemoteError } from './remote-frames'
import { type QuickReplyResult, sentenceProblem } from '@shared/quick-replies/rules'

/**
 * The desktop's quick reply (`quick-replies`): a kept sentence sent to an agent session with one click, through the
 * gate and the writes of a device's reply (`deliverReply`), bound to no watched conversation, with no phone origin
 * note and no armed model switch (D1). A key typed between the text and the submit key withholds the key.
 *
 * **Nothing the user typed earlier is checked**: whatever the agent's input box holds, the sentence joins it. A gate
 * that refused while the user's typing might be in the box refused nearly every click (keys answering a permission
 * prompt, Esc, Shift+Tab and typed slash commands counted as typing), and the agent has no key that reliably empties
 * the box (`docs/lessons/transcript.md`, "What is in the agent's input box, from outside").
 *
 * **The quick reply's writes are keystrokes like any other** — a waiting close or hibernate is dropped by them, and
 * `inTurnOf` sees them (`agent-session-control`).
 */

export type { QuickReplyCode, QuickReplyResult } from '@shared/quick-replies/rules'

export interface QuickReplyDeps {
  /** A running agent (`claude`) session of the sender's terminal service. */
  isRunningAgent: (sessionId: string) => boolean
  /** Writes to the session's pty; `false` when it has none. */
  write: (sessionId: string, data: string) => boolean
  waitStateOf: (sessionId: string) => WaitState
  refresh: (sessionId: string) => void
  /** A filled-in prompt waits unsent in the session (`intake-prefill.ts`). */
  prefillPending: (sessionId: string) => boolean
  keystrokeSeq: (sessionId: string) => number
  delay: (ms: number) => Promise<void>
  submitDelayMs: number
}

export async function sendQuickReply(deps: QuickReplyDeps, sessionId: unknown, text: unknown): Promise<QuickReplyResult> {
  if (typeof sessionId !== 'string' || typeof text !== 'string') return { ok: false, code: 'BAD_PARAMS' }
  if (sentenceProblem(cleanReply(text)) !== null) return { ok: false, code: 'BAD_PARAMS' }
  if (!deps.isRunningAgent(sessionId)) return { ok: false, code: 'NOT_FOUND' }
  try {
    const { outcome } = await deliverReply(
      {
        waitStateOf: deps.waitStateOf,
        write: deps.write,
        delay: deps.delay,
        submitDelayMs: deps.submitDelayMs,
        prefillPending: (id) => (deps.prefillPending(id) ? { edited: false } : null),
        keystrokeSeq: deps.keystrokeSeq,
        refresh: deps.refresh,
        holdSubmit: (id, afterText) => deps.keystrokeSeq(id) !== afterText,
      },
      sessionId,
      text.trim(),
    )
    return { ok: true, outcome }
  } catch (error) {
    if (error instanceof RemoteError) {
      if (error.code === 'WAIT_STATE') return { ok: false, code: 'WAIT_STATE', state: error.detail?.state as WaitState }
      if (error.code === 'PREFILL_PENDING') return { ok: false, code: 'PREFILL_PENDING' }
      if (error.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' }
      return { ok: false, code: 'BAD_PARAMS' }
    }
    throw error
  }
}
