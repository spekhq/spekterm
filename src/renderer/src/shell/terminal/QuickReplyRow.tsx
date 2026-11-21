import type { TFunction } from 'i18next'
import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Attention } from '@shared/wait/attention'
import type { QuickReplyResult } from '@shared/quick-replies/rules'
import { usePreferences } from '../PreferencesProvider'
import { openSettingsAt } from '../settings/settings-opener'
import { useAttention } from './wait'

/** What takes the buttons' place in the row: a refusal or the not-sent notice (`quick-replies` D5). */
type Notice =
  | { kind: 'typed'; sentence: string; seq: number }
  | { kind: 'reason'; text: string; attention: Attention | undefined }
  | { kind: 'notSent'; attention: Attention | undefined }

const BUTTON =
  'max-w-[16rem] shrink-0 cursor-pointer truncate rounded border border-hairline px-2 py-[1px] text-xs text-ink-dim hover:border-accent/40 hover:text-accent focus:outline-none focus-visible:ring-1 focus-visible:ring-accent disabled:cursor-default disabled:opacity-50'

/**
 * The quick replies under an agent session's view (`quick-replies` D5): one click sends a kept sentence as the user's
 * reply. **The row keeps one height** — a refusal or a notice takes the buttons' place, never a line under them, so the
 * terminal is not resized by it. **A click never takes keyboard focus** from the terminal or the composer
 * (`preventDefault` on `mousedown`), so a key typed during the send goes where the user was typing. The main process
 * gates every send (D3); the disabled state here is only a hint.
 */
export function QuickReplyRow({ sessionId, dormant }: { sessionId: string; dormant: boolean }): React.JSX.Element | null {
  const { t } = useTranslation()
  const { quickReplies } = usePreferences()
  const attention = useAttention().attentionOf(sessionId)
  const [pending, setPending] = useState<string | null>(null)
  const [notice, setNotice] = useState<Notice | null>(null)

  // A refusal for the agent's state and the not-sent notice go when the state next changes; a typing refusal stays
  // until the user sends anyway or dismisses it. Adjusted during render, not in an effect.
  if (notice && notice.kind !== 'typed' && notice.attention !== attention) setNotice(null)

  if (quickReplies.length === 0) return null

  const blocked: string | null = dormant
    ? t('quickReplies.dormant')
    : attention === 'choice'
      ? t('quickReplies.refused.choice')
      : attention === 'unknown' || attention === undefined
        ? t('quickReplies.refused.unknown')
        : null

  const send = (sentence: string, typedSeq?: number): void => {
    if (pending !== null) return
    setPending(sentence)
    setNotice(null)
    void window.workspace.conversation
      .quickReply(sessionId, sentence, typedSeq)
      .then((result) => setNotice(noticeOf(result, sentence, attention, t)))
      .catch(() => setNotice({ kind: 'reason', text: t('quickReplies.refused.badParams'), attention }))
      .finally(() => setPending(null))
  }

  const keepFocus = (event: React.MouseEvent): void => event.preventDefault()

  return (
    <div
      role="toolbar"
      aria-label={t('quickReplies.toolbar')}
      className="flex h-8 shrink-0 items-center gap-1 overflow-x-auto border-t border-hairline bg-shell px-2"
    >
      {notice ? (
        <>
          <span role="status" className="min-w-0 truncate text-xs text-ink-faint">
            {notice.kind === 'typed' ? t('quickReplies.refused.typed') : notice.kind === 'notSent' ? t('quickReplies.notSent') : notice.text}
          </span>
          {notice.kind === 'typed' && (
            <button type="button" className={BUTTON} onMouseDown={keepFocus} onClick={() => send(notice.sentence, notice.seq)}>
              {t('quickReplies.sendAnyway')}
            </button>
          )}
          <button type="button" className={BUTTON} onMouseDown={keepFocus} onClick={() => setNotice(null)}>
            {t('quickReplies.dismiss')}
          </button>
        </>
      ) : (
        <>
          {quickReplies.map((sentence) => (
            <button
              key={sentence}
              type="button"
              className={BUTTON}
              aria-label={sentence}
              title={blocked ?? sentence}
              disabled={blocked !== null || pending !== null}
              onMouseDown={keepFocus}
              onClick={() => send(sentence)}
            >
              {sentence}
            </button>
          ))}
          <button
            type="button"
            className={`${BUTTON} ml-auto`}
            aria-label={t('quickReplies.edit')}
            title={t('quickReplies.edit')}
            onMouseDown={keepFocus}
            onClick={() => openSettingsAt('agents')}
          >
            ✎
          </button>
        </>
      )}
    </div>
  )
}

function noticeOf(result: QuickReplyResult, sentence: string, attention: Attention | undefined, t: TFunction): Notice | null {
  if (result.ok) return result.outcome === 'submitted' ? null : { kind: 'notSent', attention }
  switch (result.code) {
    case 'TYPED':
      return { kind: 'typed', sentence, seq: result.seq ?? 0 }
    case 'WAIT_STATE':
      return {
        kind: 'reason',
        text: t(result.state === 'awaiting-choice' ? 'quickReplies.refused.choice' : result.state === 'unknown' ? 'quickReplies.refused.unknown' : 'quickReplies.refused.busy'),
        attention,
      }
    case 'PREFILL_PENDING':
      return { kind: 'reason', text: t('quickReplies.refused.prefill'), attention }
    case 'NOT_FOUND':
      return { kind: 'reason', text: t('quickReplies.refused.notFound'), attention }
    default:
      return { kind: 'reason', text: t('quickReplies.refused.badParams'), attention }
  }
}
