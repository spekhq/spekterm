import { useCallback, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { useTranslation } from 'react-i18next'

import type { IntakeView } from '../../../../main/ipc/intake'
import { useSessions } from '../terminal/sessions'
import { useWorkspaceFolders } from '../useWorkspaceFolders'
import { useIntake } from './intake-state'
import { RulesEditor } from './RulesEditor'
import { SlackSettings } from './SlackSettings'

/**
 * 收件匣的全視窗 overlay。
 *
 * ## 形狀與對話計量同構，而那是刻意的
 *
 * 活動列入口 ＋ 全視窗 overlay。已排除的兩個替代方案：**側欄的第三個身分**（側欄的身分被
 * `workspace-layout` 定義為 OpenSpec 與 Files **兩個**互斥的身分，且它們的座標隸屬於當下選中的
 * folder，而收件匣的範圍是整個 workspace、其項目尚未歸屬於任何 folder）；
 * **Settings 對話框的一個區段**（Settings 是放旋鈕的地方，而收件匣是內容）。
 *
 * ## 本文以純文字呈現
 *
 * 這是這個 app **第一次把第三方逐字撰寫的文字渲染進自己的介面**。此前 Files 面板渲染的 markdown
 * 來自使用者自己的 repo、終端渲染的是 pty 輸出。
 *
 * 因此：**不套用任何標記語言的渲染、不載入遠端資源、不產生可點選的連結**。
 * CSP 的 `img-src` 放行 `https:`，其既有理由是「markdown 本就該能載入遠端圖片，而使用者本就在
 * 這些 repo 裡跑 agent」—— **對一則陌生人推來的 intake，那個前提整條不成立**：
 * 一個遠端圖片會讓投遞者在使用者只是掃一眼收件匣的那一刻拿到回條。
 *
 * （不可列印字元與雙向覆寫的移除發生在**攝入**，不在這裡 —— 在呈現層做會讓交付的那一份與它
 * 不同，而「交給 agent 的內容逐字元等於呈現給使用者的內容」就在建構上不成立。）
 *
 * ## 接受的流程
 *
 * 主行程的 `accept` 只回一個**指示**（在哪個 folder 建立），建立本身走 renderer 既有的
 * `create` 路徑 —— session 清單的權威在 renderer，主行程自行建立的 session 會在 500ms 後被
 * 抹掉，**而 pty 還活著**。建好之後以 `attach` 回報，主行程才寫 context 檔並排定預填。
 */

type Tab = 'inbox' | 'rules' | 'slack'

export interface IntakeOverlayProps {
  onClose: () => void
  /** 開啟它的那個元素 —— 關閉時把焦點還回去。 */
  opener: HTMLElement | null
}

export function IntakeOverlay({ onClose, opener }: IntakeOverlayProps): React.JSX.Element {
  const { t } = useTranslation()
  const sessions = useSessions()
  // **folder 的名字住在 renderer。** 主行程的投影刻意只給識別碼（送路徑會破壞邊界語彙），
  // 而「Opens in <uuid>」對使用者不構成資訊 —— 那個字串要回答的是「它會開在我的哪個 repo」。
  const { folders } = useWorkspaceFolders()
  // **快照來自常駐的 provider，不是這裡自己拉的。** 兩份的話，計數與內容可以無聲分岔
  // （見 `intake-state.tsx` 的檔頭）。`reload` 仍然保留 —— 主行程那幾條路徑都有推送，
  // 但顯式的重新拉取是第二條防線。
  const { snapshot, refresh: reload } = useIntake()
  const [tab, setTab] = useState<Tab>('inbox')
  const [failure, setFailure] = useState<string | null>(null)
  const closeRef = useRef<HTMLButtonElement>(null)

  // 使用者打開了收件匣 —— 通知上界的重置點。**掛載時一次**，不隨重繪。
  useEffect(() => {
    window.workspace.intake.opened()
  }, [])

  const close = useCallback(() => {
    onClose()
    if (opener?.isConnected) opener.focus()
  }, [onClose, opener])

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') close()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [close])

  /**
   * 初始焦點 —— **掛載時的一次性動作，因此依賴陣列是空的**。
   *
   * 併進上面那個 effect 的話它會跟著 `close` 走，而 `close` 跟著父層每次渲染重建的 `onClose`
   * 走 ⇒ **父層每重繪一次，焦點就被搶回關閉鈕一次**。活動列一旦訂閱收件匣狀態（計數），
   * 儲存一次 routing 規則就會觸發它 —— 使用者正在編輯的欄位當場失去焦點。
   * 「掛載」不是「改變」。
   */
  useEffect(() => {
    closeRef.current?.focus()
  }, [])

  const accept = useCallback(
    async (item: IntakeView) => {
      setFailure(null)
      const decision = await window.workspace.intake.accept(item.id, item.adapter)
      if (!decision.ok) {
        setFailure(
          decision.reason === 'prefillUnavailable'
            ? t('intake.prefillUnavailable')
            : decision.reason === 'FOLDER_GONE'
              ? t('intake.unresolvedFolderGone')
              : t('intake.unresolved'),
        )
        return
      }
      const outcome = await sessions.create(decision.folderId, 'claude')
      if (outcome.status !== 'created') {
        setFailure(outcome.failure.message)
        return
      }
      await window.workspace.intake.attach(item.id, item.adapter, outcome.sessionId)
      close()
    },
    [close, sessions, t],
  )

  const items = snapshot.items.filter((item) => item.state === 'pending')
  const notices = snapshot.notices

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={t('intake.label')}
      className="fixed inset-0 z-50 flex flex-col overflow-y-auto bg-stage"
    >
      <header className="sticky top-0 z-10 flex shrink-0 items-center gap-3 border-b border-hairline bg-stage px-4 py-2">
        <h2 className="text-sm font-bold text-ink">{t('intake.title')}</h2>
        <div role="tablist" aria-label={t('intake.label')} className="flex gap-1">
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'inbox'}
            onClick={() => setTab('inbox')}
            className={tabClass(tab === 'inbox')}
          >
            {t('intake.title')}
          </button>
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'rules'}
            onClick={() => setTab('rules')}
            className={tabClass(tab === 'rules')}
          >
            {t('intake.rules.label')}
          </button>
          {/*
            Slack 連線設定的家。**刻意不放在終端偏好對話框裡** —— 那個對話框的內容由
            `terminal-preferences` 以列舉的方式規定，往其中加入本能力的區段將構成對該能力的修改
            （`intake-routing` 已就規則的編輯入口立下同一條約束）。
            兩份既有規格都沒有列舉這個 overlay 的分頁，因此加在這裡不構成對它們的修改。
          */}
          <button
            type="button"
            role="tab"
            aria-selected={tab === 'slack'}
            onClick={() => setTab('slack')}
            className={tabClass(tab === 'slack')}
          >
            {t('slack.label')}
          </button>
        </div>
        <span className="flex-1" />
        <span className="text-2xs text-ink-faint">
          {t('intake.pendingCount', { count: items.length })}
        </span>
        <button
          ref={closeRef}
          type="button"
          aria-label={t('intake.close')}
          onClick={close}
          className="rounded px-2 py-1 text-2xs text-ink-muted hover:bg-hairline/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          ✕
        </button>
      </header>

      <div className="flex-1 px-4 py-3">
        {failure ? (
          <p className="mb-3 rounded border border-hairline bg-shell px-3 py-2 text-2xs text-ink">
            {failure}
          </p>
        ) : null}

        {/*
          **拒絕的呈現是彙整的，不是逐則一條訊息。** 投遞者控制投遞的數量，而使用者的注意力是
          這條管線僅有的兩道人類防線之一（另一道是讀本文）。
        */}
        {notices.length > 0 ? (
          <div className="mb-3 flex items-center gap-2 rounded border border-hairline bg-shell px-3 py-2">
            <span className="text-2xs text-ink">
              {t('intake.rejected', {
                count: notices.reduce((total, notice) => total + notice.count, 0),
              })}
            </span>
            <span className="flex-1" />
            <button
              type="button"
              aria-label={t('intake.dismissNotices')}
              onClick={() => void window.workspace.intake.dismissNotices().then(reload)}
              className="rounded px-2 py-0.5 text-2xs text-ink-muted hover:bg-hairline/40"
            >
              {t('intake.dismissNotices')}
            </button>
          </div>
        ) : null}

        {tab === 'slack' ? (
          <SlackSettings />
        ) : tab === 'rules' ? (
          <RulesEditor />
        ) : items.length === 0 ? (
          <p className="text-2xs text-ink-faint">{t('intake.empty')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {items.map((item) => (
              <IntakeCard
                key={`${item.adapter} ${item.id}`}
                item={item}
                folderName={folders.find((folder) => folder.id === item.folderId)?.name ?? null}
                onAccept={accept}
                onChanged={reload}
              />
            ))}
          </ul>
        )}
      </div>
    </div>,
    document.body,
  )
}

function tabClass(active: boolean): string {
  return (
    'rounded px-2 py-1 text-2xs transition-colors focus:outline-none focus-visible:ring-1 focus-visible:ring-accent ' +
    (active ? 'bg-accent/10 text-accent' : 'text-ink-muted hover:bg-hairline/40')
  )
}

function IntakeCard({
  item,
  folderName,
  onAccept,
  onChanged,
}: {
  item: IntakeView
  /** 解析到的 folder 在 rail 上的名字。清單尚未抵達時為 `null` —— 那時退回識別碼。 */
  folderName: string | null
  onAccept: (item: IntakeView) => Promise<void>
  onChanged: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <li
      aria-label={t('intake.itemLabel', { title: item.title })}
      className="rounded border border-hairline bg-shell px-3 py-2"
    >
      <div className="flex items-baseline gap-2">
        {/* 標題也是第三方撰寫的 —— 與本文同樣只當文字呈現。 */}
        <span className="text-sm text-ink">{item.title}</span>
        <span className="text-2xs text-ink-faint">{item.actor}</span>
        <span className="text-2xs text-ink-faint">{item.originLabel}</span>
        <span className="flex-1" />
        {/*
          識別碼是投遞者挑的，字元集白名單只保證它路徑安全、不保證它不是一句話 ——
          因此以等寬、截短、可辨識為機器識別碼的方式呈現。
        */}
        <code className="max-w-[14rem] truncate font-mono text-2xs text-ink-faint">{item.id}</code>
      </div>

      {/*
        **本文全文，純文字。** `whitespace-pre-wrap` 保留換行；沒有任何 markdown 渲染，
        因此文中的圖片與連結語法就是字面文字。
      */}
      <p className="mt-2 whitespace-pre-wrap break-words text-2xs text-ink-muted">{item.body}</p>
      <p className="mt-1 text-2xs text-ink-faint">{t('intake.bodyLength', { count: item.bodyLength })}</p>

      <div className="mt-2 flex items-center gap-2">
        {item.folderId ? (
          <span className="text-2xs text-ink-muted">
            {t('intake.opensIn', { folder: folderName ?? item.folderId })}
          </span>
        ) : (
          <span className="text-2xs text-ink-faint">
            {item.unresolved === 'FOLDER_GONE' ? t('intake.unresolvedFolderGone') : t('intake.unresolved')}
          </span>
        )}
        <span className="flex-1" />
        <button
          type="button"
          aria-label={t('intake.dismiss')}
          onClick={() => void window.workspace.intake.dismiss(item.id, item.adapter).then(onChanged)}
          className="cursor-pointer rounded px-2 py-1 text-2xs text-ink-muted hover:bg-hairline/40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {t('intake.dismiss')}
        </button>
        <button
          type="button"
          aria-label={t('intake.accept')}
          disabled={!item.folderId}
          onClick={() => void onAccept(item)}
          className="cursor-pointer rounded bg-accent/10 px-2 py-1 text-2xs text-accent disabled:cursor-default disabled:opacity-40 focus:outline-none focus-visible:ring-1 focus-visible:ring-accent"
        >
          {t('intake.accept')}
        </button>
      </div>
    </li>
  )
}
