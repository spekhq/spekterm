import { QUICK_REPLY_MAX_COUNT, sentenceProblem, type SentenceProblem } from './rules'

/**
 * The edits Settings makes to the quick replies (`quick-replies` D4, D6). **An edit names its row by the sentence,
 * never by index**, and is applied to the list in effect when it runs — the last one applied, not the one on screen
 * when it was made — so a quick "move up" then "remove" applies both (`preferences-queue.ts`).
 */
export type QuickReplyEdit =
  | { kind: 'add'; sentence: string }
  | { kind: 'replace'; from: string; to: string }
  | { kind: 'remove'; sentence: string }
  | { kind: 'move'; sentence: string; by: -1 | 1 }

export type EditProblem = SentenceProblem | 'duplicate' | 'full'

/** Why a sentence cannot be saved into `list` (in place of `replacing`, if given), or `null`. */
export function editProblem(list: readonly string[], sentence: string, replacing?: string): EditProblem | null {
  const problem = sentenceProblem(sentence)
  if (problem) return problem
  const trimmed = sentence.trim()
  if (trimmed !== replacing && list.includes(trimmed)) return 'duplicate'
  if (replacing === undefined && list.length >= QUICK_REPLY_MAX_COUNT) return 'full'
  return null
}

/** The list after `edit`, or `null` when it no longer applies (its row is gone) or breaks a rule. */
export function applyQuickReplyEdit(list: readonly string[], edit: QuickReplyEdit): string[] | null {
  switch (edit.kind) {
    case 'add':
      return editProblem(list, edit.sentence) ? null : [...list, edit.sentence.trim()]
    case 'replace': {
      const at = list.indexOf(edit.from)
      if (at < 0 || editProblem(list, edit.to, edit.from)) return null
      const next = [...list]
      next[at] = edit.to.trim()
      return next
    }
    case 'remove': {
      const at = list.indexOf(edit.sentence)
      return at < 0 ? null : list.filter((_, i) => i !== at)
    }
    case 'move': {
      const at = list.indexOf(edit.sentence)
      const to = at + edit.by
      if (at < 0 || to < 0 || to >= list.length) return null
      const next = [...list]
      next[at] = next[to]
      next[to] = edit.sentence
      return next
    }
  }
}
