/**
 * The rules of a quick reply and of the list, shared by the main process (the preference's cleaner, the IPC's
 * check) and the renderer (the Settings editor) (`quick-replies` D4).
 *
 * A sentence: after trimming, 1 to 200 UTF-16 units (JavaScript `length`, as the phone's Kotlin counts), no line
 * break or other control character. A list: valid sentences, at most 12, no two equal after trimming.
 */

export type QuickReplyCode = 'WAIT_STATE' | 'PREFILL_PENDING' | 'TYPED' | 'NOT_FOUND' | 'BAD_PARAMS'

/** What the main process answers a quick reply (`quick-replies` D3). `state` is a wait state; `seq` a keystroke count. */
export type QuickReplyResult =
  | { ok: true; outcome: 'submitted' | 'filled-not-submitted' }
  | { ok: false; code: QuickReplyCode; state?: 'ready' | 'busy' | 'awaiting-choice' | 'unknown'; seq?: number }

export const QUICK_REPLY_MAX_LENGTH = 200
export const QUICK_REPLY_MAX_COUNT = 12

/** The dictionary keys of the three defaults, in order; their text is the UI language's. */
export const QUICK_REPLY_DEFAULT_KEYS = [
  'quickReplies.default.close',
  'quickReplies.default.risk',
  'quickReplies.default.remaining',
] as const

export type SentenceProblem = 'empty' | 'tooLong' | 'control'

/** Why a sentence breaks a rule, or `null`. `sentence` is judged trimmed. */
export function sentenceProblem(sentence: string): SentenceProblem | null {
  const trimmed = sentence.trim()
  if (trimmed === '') return 'empty'
  // eslint-disable-next-line no-control-regex
  if (/[\x00-\x1f\x7f-\x9f\u2028\u2029]/.test(trimmed)) return 'control'
  if (trimmed.length > QUICK_REPLY_MAX_LENGTH) return 'tooLong'
  return null
}

/**
 * The list as stored, or `undefined` when anything about it breaks a rule: never repaired in part (the editor cannot
 * write such a list; only a hand edit or a damaged file can).
 */
export function cleanQuickReplies(value: unknown): string[] | undefined {
  if (!Array.isArray(value) || value.length > QUICK_REPLY_MAX_COUNT) return undefined
  const seen = new Set<string>()
  const out: string[] = []
  for (const item of value) {
    if (typeof item !== 'string' || sentenceProblem(item) !== null) return undefined
    const trimmed = item.trim()
    if (seen.has(trimmed)) return undefined
    seen.add(trimmed)
    out.push(trimmed)
  }
  return out
}

/**
 * The list in effect: the stored one, or — while unset — the three defaults in the language `translate` speaks, so
 * a change of UI language changes them only while the user has not set the list.
 */
export function effectiveQuickReplies(stored: readonly string[] | undefined, translate: (key: (typeof QUICK_REPLY_DEFAULT_KEYS)[number]) => string): string[] {
  return stored ? [...stored] : QUICK_REPLY_DEFAULT_KEYS.map((key) => translate(key))
}
