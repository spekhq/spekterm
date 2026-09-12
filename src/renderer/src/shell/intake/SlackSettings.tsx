import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { SlackState, SlackTokenKind } from '../types'

/**
 * Slack 連線設定。**不置於終端偏好對話框之內** —— 那個對話框的內容由 `terminal-preferences`
 * 以列舉的方式規定，往其中加入本能力的區段將構成對該能力的修改（`intake-routing` 已就規則的
 * 編輯入口立下同一條約束）。它住在收件匣 overlay 的第三個分頁：
 * 兩份既有規格都沒有列舉那個 overlay 的分頁，因此這不構成對它們的修改。
 *
 * ## 介面上沒有讀取憑證的方法
 *
 * 憑證在 `SlackState` 裡只是 `configured: { appToken: boolean, userToken: boolean }`。
 * 輸入框是**唯寫**的：送出後清空，重新載入時不回填 —— 於是「已設定」這個事實看得到，
 * 值本身連在 DOM 裡都不存在。
 *
 * ## 沒有「要偵測誰」與「哪個工作區」的輸入框
 *
 * 兩者自憑證推導（design D14）。一個填錯的「要偵測誰」，其症狀是**什麼都不會發生** ——
 * 與「沒有人提及我」和「連線已失效」在畫面上完全相同，而讓後兩者可區分正是這條能力花了
 * 一整條 requirement 在做的事。因此這裡只呈現推導出來的身分，不提供編輯。
 *
 * ## 端點非預設值時必須看得見
 *
 * 憑證的目的地是一個資料欄位（使用者的裁決，見 design D11），那個代價只有在他看得見時才可接受
 * —— **一個沉默的端點欄位比沒有這個欄位更糟**。因此非預設值時呈現一段明確的警示文字，
 * 而不只是把值填在輸入框裡。
 */
export function SlackSettings(): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<SlackState | null>(null)
  const [drafts, setDrafts] = useState<Record<SlackTokenKind, string>>({
    appToken: '',
    userToken: '',
  })
  const [endpointDraft, setEndpointDraft] = useState('')

  const reload = useCallback(() => {
    void window.workspace.slack.get().then(setState)
  }, [])

  useEffect(reload, [reload])

  const applyToken = useCallback((kind: SlackTokenKind, value: string | null) => {
    void window.workspace.slack.setToken(kind, value).then((next) => {
      setState(next)
      // **送出後清空** —— 輸入框是唯寫的，值不留在 DOM 裡。
      setDrafts((current) => ({ ...current, [kind]: '' }))
    })
  }, [])

  if (state === null) return <p className="text-2xs text-ink-faint">{t('common.loading')}</p>

  const identity =
    state.settings.selfUserId !== undefined && state.settings.teamId !== undefined
      ? t('slack.connectedAs', { user: state.settings.selfUserId, team: state.settings.teamId })
      : t('slack.notConnected')

  return (
    <section className="flex flex-col gap-4" aria-label={t('slack.title')}>
      <p className="text-2xs text-ink-muted">{t('slack.description')}</p>

      {/* 憑證 —— 唯寫的輸入框，狀態只以「已設定／未設定」呈現。 */}
      <div className="flex flex-col gap-2">
        {(['appToken', 'userToken'] as const).map((kind) => (
          <div key={kind} className="flex items-center gap-2">
            <span className="w-32 shrink-0 text-2xs text-ink">{t(`slack.${kind}`)}</span>
            <span className="w-16 shrink-0 text-2xs text-ink-faint">
              {state.configured[kind] ? t('slack.tokenSet') : t('slack.tokenUnset')}
            </span>
            <input
              type="password"
              value={drafts[kind]}
              placeholder={t('slack.tokenPlaceholder')}
              aria-label={t(`slack.${kind}`)}
              onChange={(event) =>
                setDrafts((current) => ({ ...current, [kind]: event.target.value }))
              }
              className="min-w-0 flex-1 rounded border border-hairline bg-shell px-2 py-1 text-2xs text-ink"
            />
            <button
              type="button"
              aria-label={t('slack.saveToken', { name: t(`slack.${kind}`) })}
              disabled={drafts[kind].trim() === ''}
              onClick={() => applyToken(kind, drafts[kind])}
              className="shrink-0 rounded px-2 py-1 text-2xs text-ink-muted hover:bg-hairline/40 disabled:opacity-40"
            >
              {t('common.save')}
            </button>
            <button
              type="button"
              aria-label={t('slack.clearToken', { name: t(`slack.${kind}`) })}
              disabled={!state.configured[kind]}
              onClick={() => applyToken(kind, null)}
              className="shrink-0 rounded px-2 py-1 text-2xs text-ink-muted hover:bg-hairline/40 disabled:opacity-40"
            >
              {t('common.clear')}
            </button>
          </div>
        ))}
      </div>

      {/* 身分 —— 推導出來的，沒有輸入框。 */}
      <div className="flex flex-col gap-1">
        <span className="text-2xs font-bold text-ink">{t('slack.identity')}</span>
        <span className="text-2xs text-ink-muted">{identity}</span>
      </div>

      {/* 回看範圍。 */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-2xs text-ink">{t('slack.lookback')}</span>
          <input
            type="number"
            min={1}
            max={30}
            value={state.effective.lookbackDays}
            aria-label={t('slack.lookback')}
            onChange={(event) =>
              void window.workspace.slack
                .setLookbackDays(Number(event.target.value))
                .then(setState)
            }
            className="w-20 rounded border border-hairline bg-shell px-2 py-1 text-2xs text-ink"
          />
          <span className="text-2xs text-ink-faint">
            {t('slack.lookbackDays', { count: state.effective.lookbackDays })}
          </span>
        </div>
        <p className="text-2xs text-ink-faint">{t('slack.lookbackHint')}</p>
      </div>

      {/* 端點。**非預設值時的警示是一條 requirement，不是裝飾。** */}
      <div className="flex flex-col gap-1">
        <div className="flex items-center gap-2">
          <span className="w-32 shrink-0 text-2xs text-ink">{t('slack.endpoint')}</span>
          <input
            type="text"
            value={endpointDraft}
            placeholder={state.effective.apiBaseUrl}
            aria-label={t('slack.endpoint')}
            onChange={(event) => setEndpointDraft(event.target.value)}
            onBlur={() => {
              if (endpointDraft.trim() === '') return
              void window.workspace.slack.setApiBaseUrl(endpointDraft).then((next) => {
                setState(next)
                setEndpointDraft('')
              })
            }}
            className="min-w-0 flex-1 rounded border border-hairline bg-shell px-2 py-1 text-2xs text-ink"
          />
          <button
            type="button"
            aria-label={t('slack.resetEndpoint')}
            disabled={state.usesDefaultEndpoint}
            onClick={() =>
              void window.workspace.slack.setApiBaseUrl(null).then((next) => {
                setState(next)
                setEndpointDraft('')
              })
            }
            className="shrink-0 rounded px-2 py-1 text-2xs text-ink-muted hover:bg-hairline/40 disabled:opacity-40"
          >
            {t('common.reset')}
          </button>
        </div>
        <p className="text-2xs text-ink-faint">
          {state.usesDefaultEndpoint ? t('slack.endpointDefault') : t('slack.endpointCustom')}
        </p>
        <p className="text-2xs text-ink-faint">{t('slack.endpointHint')}</p>
      </div>

      {/* routing 的 fallback —— 第一次使用時規則多半是空的，而那時每一則提及都解析不出 folder。 */}
      <p className="rounded border border-hairline bg-shell px-3 py-2 text-2xs text-ink">
        {t('slack.routingHint')}
      </p>
    </section>
  )
}
