import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { type EditProblem, editProblem } from '@shared/quick-replies/edits'
import { QUICK_REPLY_MAX_COUNT, QUICK_REPLY_MAX_LENGTH } from '@shared/quick-replies/rules'
import { usePreferences } from '../PreferencesProvider'
import { BUTTON_CLASS, FieldError, HINT_CLASS, INPUT_CLASS, LABEL_CLASS, useWrite } from './fields'

const PROBLEM_KEY = {
  empty: 'settings.quickReplyEmpty',
  tooLong: 'settings.quickReplyTooLong',
  control: 'settings.quickReplyControl',
  duplicate: 'settings.quickReplyDuplicate',
  full: 'settings.quickReplyFull',
} as const satisfies Record<EditProblem, string>

/**
 * The quick replies in Settings → Agents & sessions (`quick-replies` D6). Each sentence applies on Enter or blur, Esc
 * restoring it; one that breaks a rule or repeats another is not applied and says why; an existing row emptied and
 * left is restored (removing is the remove button's job). Every edit names its row by the sentence and is applied to
 * the list in effect when it runs (`updateQuickReplies`).
 */
export function QuickRepliesEditor(): React.JSX.Element {
  const { t } = useTranslation()
  const { quickReplies, updateQuickReplies } = usePreferences()
  const { failure, run } = useWrite()
  const [adding, setAdding] = useState(false)

  return (
    <>
      <span className={LABEL_CLASS}>{t('settings.quickReplies')}</span>
      <p className={HINT_CLASS}>{t('settings.quickRepliesHint')}</p>
      <ul className="mt-2 flex flex-col gap-1">
        {quickReplies.map((sentence, index) => (
          <li key={sentence} className="flex items-start gap-1">
            <SentenceInput
              label={t('settings.quickReplyField', { index: index + 1 })}
              initial={sentence}
              list={quickReplies}
              replacing={sentence}
              onApply={(text) => run(() => updateQuickReplies({ kind: 'replace', from: sentence, to: text }))}
            />
            <button
              type="button"
              className={BUTTON_CLASS}
              aria-label={t('settings.quickReplyUp', { sentence })}
              disabled={index === 0}
              onClick={() => void run(() => updateQuickReplies({ kind: 'move', sentence, by: -1 }))}
            >
              ↑
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              aria-label={t('settings.quickReplyDown', { sentence })}
              disabled={index === quickReplies.length - 1}
              onClick={() => void run(() => updateQuickReplies({ kind: 'move', sentence, by: 1 }))}
            >
              ↓
            </button>
            <button
              type="button"
              className={BUTTON_CLASS}
              aria-label={t('settings.quickReplyRemove', { sentence })}
              onClick={() => void run(() => updateQuickReplies({ kind: 'remove', sentence }))}
            >
              ×
            </button>
          </li>
        ))}
        {adding && (
          <li className="flex items-start gap-1">
            <SentenceInput
              label={t('settings.quickReplyNew')}
              initial=""
              list={quickReplies}
              autoFocus
              // An added row is not saved until it holds text; leaving it empty drops it.
              onEmpty={() => setAdding(false)}
              onApply={async (text) => {
                const ok = await run(() => updateQuickReplies({ kind: 'add', sentence: text }))
                if (ok) setAdding(false)
                return ok
              }}
            />
          </li>
        )}
      </ul>
      {!adding && quickReplies.length < QUICK_REPLY_MAX_COUNT && (
        <button type="button" className={`${BUTTON_CLASS} mt-2`} onClick={() => setAdding(true)}>
          {t('settings.quickReplyAdd')}
        </button>
      )}
      <FieldError message={failure} />
    </>
  )
}

function SentenceInput({
  label,
  initial,
  list,
  replacing,
  autoFocus,
  onApply,
  onEmpty,
}: {
  label: string
  initial: string
  list: readonly string[]
  replacing?: string
  autoFocus?: boolean
  onApply: (text: string) => Promise<boolean>
  onEmpty?: () => void
}): React.JSX.Element {
  const { t } = useTranslation()
  const [text, setText] = useState(initial)
  const [problem, setProblem] = useState<EditProblem | null>(null)

  const commit = (): void => {
    const trimmed = text.trim()
    if (trimmed === (replacing ?? '')) {
      // Nothing changed, or an existing row emptied: show its sentence again; an empty new row goes away.
      if (trimmed === '' && replacing === undefined) onEmpty?.()
      setText(initial)
      setProblem(null)
      return
    }
    if (trimmed === '' && replacing !== undefined) {
      setText(initial)
      setProblem(null)
      return
    }
    const found = editProblem(list, trimmed, replacing)
    setProblem(found)
    if (found) return
    void onApply(trimmed).then((ok) => {
      if (!ok) setText(initial)
    })
  }

  return (
    <div className="flex min-w-0 flex-1 flex-col">
      <input
        type="text"
        value={text}
        aria-label={label}
        maxLength={QUICK_REPLY_MAX_LENGTH}
        autoFocus={autoFocus}
        onChange={(event) => {
          setText(event.target.value)
          setProblem(null)
        }}
        onBlur={commit}
        onKeyDown={(event) => {
          if (event.key === 'Enter') commit()
          if (event.key === 'Escape' && event.currentTarget.value !== initial) {
            // Restores the edit and stops there, so Esc does not also close Settings.
            event.stopPropagation()
            setText(initial)
            setProblem(null)
          }
        }}
        className={`${INPUT_CLASS} block w-full`}
      />
      <FieldError message={problem ? t(PROBLEM_KEY[problem]) : null} />
    </div>
  )
}
