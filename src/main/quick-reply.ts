import type { WaitState } from './agent-events'
import { cleanReply, deliverReply, QuickReplyRefusal } from './remote-conversation'
import { RemoteError } from './remote-frames'
import { type QuickReplyResult, sentenceProblem } from '@shared/quick-replies/rules'

/**
 * The desktop's quick reply (`quick-replies`): a kept sentence sent to an agent session with one click, through the
 * gate and the writes of a device's reply (`deliverReply`), bound to no watched conversation, with no phone origin
 * note and no armed model switch (D1), and one more gate: nothing the user typed may still be in the agent's input
 * box (D2).
 *
 * **The quick reply's writes are keystrokes like any other** — a waiting close or hibernate is dropped by them, and
 * `inTurnOf` sees them (`agent-session-control`). The gate looks past them by counts: right after the submit key,
 * `deliverReply` moves the box's baseline (`pty-input.ts` `noteSubmitted`).
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
  submittedSeqOf: (sessionId: string) => number
  noteSubmitted: (sessionId: string) => void
  delay: (ms: number) => Promise<void>
  submitDelayMs: number
}

export async function sendQuickReply(deps: QuickReplyDeps, sessionId: unknown, text: unknown, typedSeq: unknown): Promise<QuickReplyResult> {
  if (typeof sessionId !== 'string' || typeof text !== 'string') return { ok: false, code: 'BAD_PARAMS' }
  if (typedSeq !== undefined && typedSeq !== null && !(Number.isInteger(typedSeq) && (typedSeq as number) >= 0)) {
    return { ok: false, code: 'BAD_PARAMS' }
  }
  if (sentenceProblem(cleanReply(text)) !== null) return { ok: false, code: 'BAD_PARAMS' }
  if (!deps.isRunningAgent(sessionId)) return { ok: false, code: 'NOT_FOUND' }
  const override = typeof typedSeq === 'number' ? typedSeq : null
  try {
    const { outcome } = await deliverReply(
      {
        waitStateOf: deps.waitStateOf,
        write: deps.write,
        delay: deps.delay,
        submitDelayMs: deps.submitDelayMs,
        prefillPending: (id) => (deps.prefillPending(id) ? { edited: false } : null),
        noteSubmitted: deps.noteSubmitted,
        keystrokeSeq: deps.keystrokeSeq,
        refresh: deps.refresh,
        gate: (id) => {
          const seq = deps.keystrokeSeq(id)
          // "Send anyway" holds only while nothing was typed since the user saw the warning (D2).
          if (seq > deps.submittedSeqOf(id) && override !== seq) throw new QuickReplyRefusal('TYPED', seq)
        },
        holdSubmit: (id, afterText) => deps.keystrokeSeq(id) !== afterText,
      },
      sessionId,
      text.trim(),
    )
    return { ok: true, outcome }
  } catch (error) {
    if (error instanceof QuickReplyRefusal) return { ok: false, code: 'TYPED', seq: error.seq }
    if (error instanceof RemoteError) {
      if (error.code === 'WAIT_STATE') return { ok: false, code: 'WAIT_STATE', state: error.detail?.state as WaitState }
      if (error.code === 'PREFILL_PENDING') return { ok: false, code: 'PREFILL_PENDING' }
      if (error.code === 'NOT_FOUND') return { ok: false, code: 'NOT_FOUND' }
      return { ok: false, code: 'BAD_PARAMS' }
    }
    throw error
  }
}
