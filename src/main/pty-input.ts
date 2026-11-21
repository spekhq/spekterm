/**
 * When something last typed into each session (`remote-protocol`, D3 of `remote-prompts-attachments-rename`).
 *
 * A device may answer an open permission prompt only while nothing was typed into the session since the
 * prompt's tool call started, or, when its user confirmed a warning, while only moving keys were
 * (`remote-answer-despite-typed`). A prompt answered, dismissed or half-answered on the desktop reports nothing
 * until its tool ends, or nothing at all, but it always took a key. Every pty write goes through
 * `TerminalService.write`, which reports here.
 *
 * **A keystroke is moving or deciding** (`remote-answer-despite-typed` D4). Moving: a write of only unmodified
 * arrows, Tab, ASCII letters and Space, the keys measured (CLI 2.1.325, `docs/lessons/transcript.md`) to answer and
 * dismiss no prompt. Deciding: every other write — a digit, Enter or Esc may have answered or dismissed it, and a key
 * not measured counts as one too (the cost is only the device's override). A paste is always deciding: the agent
 * turns bracketed paste on, so xterm.js wraps it in escape sequences.
 *
 * **A keystroke is any write except two kinds:**
 * - a device answer's own keys (`origin: 'answer'`): the answer must not make its own prompt unanswerable;
 * - the terminal's own reports: focus in/out, which the agent turns on (`ESC [ ? 1004 h`, measured), mouse
 *   reports (the agent turns mouse tracking on, measured CLI 2.1.301), and the terminal's answers to the agent's
 *   startup queries (`REPORT`). A click, a window switch or a query's answer is not someone typing.
 *
 * The time is wall-clock ms, the clock of the event files' names (`agent-events.ts` `fileTimeOf`).
 */

const lastKeystroke = new Map<string, number>()
/** When a deciding keystroke was last written into each session. */
const lastDecisive = new Map<string, number>()
/**
 * How many keystrokes each session received (`remote-prefill-send` D4). A count, not a time: a key in the same
 * millisecond as the desktop's own write is still told apart, and no clock step can hide one.
 */
const keystrokeCount = new Map<string, number>()
const listeners = new Set<(sessionId: string) => void>()

/**
 * **What may still be in the agent's input box** (`quick-replies` D2). The desktop cannot see the box; it can tell
 * which keystrokes were submitted. Text typed during a turn stays in the box after `Stop` and after a permission
 * prompt answered with Enter, and a finished background task's notice is reported as a submission that no keystroke
 * preceded (measured CLI 2.1.330, `docs/lessons/transcript.md`). So the box is judged by counts, not by events alone:
 *
 * - `enters`: the last few **submitting Enters** — a write ending with `\r` whose `\r` does not follow ESC (Alt+Enter,
 *   a line break) and is not inside a bracketed paste (xterm turns a pasted line break into `\r`), written while no
 *   own request of the agent is open (an Enter then answers the prompt).
 * - `submitted`: the keystroke count up to which everything typed was submitted. It moves only when an own
 *   submission is drained with a submitting Enter at or before its time (`confirmSubmit`), when a reply's submit key
 *   was written (`noteSubmitted`), and at a spawn (`noteSubmitted`: a new agent's box is empty).
 *
 * Every exclusion errs toward "the box may hold something", which costs a quick reply one more click.
 */
const ENTER_HISTORY = 8
const enters = new Map<string, { seq: number; at: number }[]>()
const submitted = new Map<string, number>()
let ownRequestOpen: (sessionId: string) => boolean = () => false

/** Set once by `agent-wait.ts`, which holds the open requests (an import the other way would be a cycle). */
export function setOwnRequestSource(source: (sessionId: string) => boolean): void {
  ownRequestOpen = source
}

const PASTE_START = '\x1b[200~'
const PASTE_END = '\x1b[201~'

/** Whether a write submits the agent's box when nothing else is open (see `enters`). */
export function isSubmittingEnter(data: string): boolean {
  if (!data.endsWith('\r')) return false
  if (data.length >= 2 && data[data.length - 2] === '\x1b') return false
  return data.lastIndexOf(PASTE_START) <= data.lastIndexOf(PASTE_END)
}

export type WriteOrigin = 'answer'

/**
 * Focus and mouse reports, plus xterm.js's answers to the queries the agent sends at startup (measured, CLI 2.1.301,
 * `docs/lessons/transcript.md` "Turn boundaries"): DA1 (`CSI ? 1 ; 2 c`), DA2 (`CSI > … c`), XTVERSION
 * (`DCS > | xterm.js(…) ST`) and the kitty keyboard flags (`CSI ? <flags> u`); since CLI 2.1.303 also the private mode
 * reports (DECRPM, `CSI ? <mode> ; <state> $ y`) to its DECRQM queries of synchronized output (2026) and SGR-pixel mouse
 * (1016), one of which can arrive after the agent is ready (measured in the app, `remote-prefill-send`). Without them
 * a session nobody typed
 * into would count as typed into right after its start, and a turn would never be over (`agent-session-control`).
 * None of the answers is a key's encoding: keys never start `CSI ?` or `CSI >`, and a DCS is never a key.
 * The cursor-position answer (`CSI <row> ; <col> R`) is left out on purpose: it is also a modified F3, and the agent
 * was not seen asking for it.
 */
// eslint-disable-next-line no-control-regex
const REPORT = /^(?:\x1b\[[IO]|\x1b\[M[\s\S]{3}|\x1b\[<\d+;\d+;\d+[Mm]|\x1b\[\?[\d;]*c|\x1b\[>[\d;]*c|\x1bP>\|[^\x1b]*\x1b\\|\x1b\[\?\d+u|\x1b\[\?\d+;\d+\$y)+$/

/** Whether `data` is only the terminal's own focus or mouse reports. */
export function isTerminalReport(data: string): boolean {
  return REPORT.test(data)
}

// eslint-disable-next-line no-control-regex
const MOVING = /^(?:\x1b\[[A-D]|\x1bO[A-D]|[\tA-Za-z ])+$/

/** Whether a keystroke can only have moved within a prompt (`remote-answer-despite-typed` D4). */
export function isMovingKey(data: string): boolean {
  return MOVING.test(data)
}

/** Called by `TerminalService.write` for every write. */
export function noteWrite(sessionId: string, data: string, origin?: WriteOrigin, now: number = Date.now()): void {
  if (origin === 'answer' || data === '' || isTerminalReport(data)) return
  // Both times before the listeners: one pokes the follow, which reads the prompt view at once (D4).
  lastKeystroke.set(sessionId, now)
  if (!isMovingKey(data)) lastDecisive.set(sessionId, now)
  const seq = (keystrokeCount.get(sessionId) ?? 0) + 1
  keystrokeCount.set(sessionId, seq)
  if (isSubmittingEnter(data) && !ownRequestOpen(sessionId)) {
    const list = enters.get(sessionId) ?? []
    list.push({ seq, at: now })
    if (list.length > ENTER_HISTORY) list.shift()
    enters.set(sessionId, list)
  }
  for (const listener of listeners) {
    try {
      listener(sessionId)
    } catch (error) {
      console.error(`[pty-input] listener failed: ${String(error)}`)
    }
  }
}

/** The wall-clock ms of the session's last keystroke, or `null`. */
export function lastKeystrokeAt(sessionId: string): number | null {
  return lastKeystroke.get(sessionId) ?? null
}

/** The wall-clock ms of the session's last deciding keystroke, or `null`. */
export function lastDecisiveAt(sessionId: string): number | null {
  return lastDecisive.get(sessionId) ?? null
}

/** How many keystrokes the session received so far; only differences between two reads mean anything. */
export function keystrokeSeq(sessionId: string): number {
  return keystrokeCount.get(sessionId) ?? 0
}

/** Sees every keystroke, after it is recorded. */
export function onKeystroke(listener: (sessionId: string) => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

/**
 * An own submission was reported at `eventAt` (not a notice): the last submitting Enter at or before it is what was
 * submitted. The hook's timestamp is taken after the Enter (57 ms after, measured), never before it.
 */
export function confirmSubmit(sessionId: string, eventAt: number): void {
  const list = enters.get(sessionId)
  if (!list) return
  let enter: { seq: number; at: number } | null = null
  for (const candidate of list) if (candidate.at <= eventAt) enter = candidate
  if (enter && enter.seq > (submitted.get(sessionId) ?? 0)) submitted.set(sessionId, enter.seq)
}

/** Everything typed so far is submitted, or gone: a reply's submit key was just written, or a new process started. */
export function noteSubmitted(sessionId: string): void {
  submitted.set(sessionId, keystrokeCount.get(sessionId) ?? 0)
}

/** The keystroke count up to which everything typed was submitted. */
export function submittedSeqOf(sessionId: string): number {
  return submitted.get(sessionId) ?? 0
}

export function forgetInput(sessionId: string): void {
  lastKeystroke.delete(sessionId)
  lastDecisive.delete(sessionId)
  keystrokeCount.delete(sessionId)
  enters.delete(sessionId)
  submitted.delete(sessionId)
}
