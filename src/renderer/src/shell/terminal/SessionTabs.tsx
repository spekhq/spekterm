import type { SpawnTarget } from '../types'
import { StatusDot, sessionLabel, sessionTitle, statusTitle } from './session-badge'
import type { SessionState } from './sessions'
import { useSpawnMenu } from './useSpawnMenu'

interface SessionTabsProps {
  sessions: SessionState[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onCreate: (spawnTarget: SpawnTarget) => void
  /** 建立失敗的訊息（folder 失效、pty 配置不出來等）。 */
  error: string | null
}

const NEW_BUTTON_CLASS =
  'shrink-0 self-center rounded border border-hairline px-2 py-1 text-[11px] text-ink-dim hover:border-accent/40 hover:text-accent'

export function SessionTabs({
  sessions,
  focusedId,
  onFocus,
  onClose,
  onCreate,
  error,
}: SessionTabsProps): React.JSX.Element {
  const spawn = useSpawnMenu(onCreate)

  if (sessions.length === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-hairline bg-panel px-3 py-2">
        <span className="text-xs text-ink-faint">尚無 session</span>
        <button
          type="button"
          onClick={spawn.open}
          aria-label="新增 session"
          className={NEW_BUTTON_CLASS}
        >
          + session
        </button>
        {error && <span className="truncate text-[11px] text-danger">{error}</span>}
        {spawn.menu}
      </div>
    )
  }

  return (
    <div className="flex items-stretch border-b border-hairline bg-panel">
      {/*
        `tablist` 不佔 flex-1 —— 否則它會把建立入口一路推到分頁列的另一端，開第二個分頁之後
        滑鼠得橫越整條列才點得到。剩餘空間交給後面的 spacer 吸收，`+ session` 因此緊貼最後
        一個分頁（像瀏覽器分頁旁的那顆鈕）。分頁多到溢出時 tablist 自己捲動，按鈕仍在可視區。
      */}
      <div
        role="tablist"
        aria-label="Session 分頁"
        className="flex min-w-0 items-stretch overflow-x-auto"
      >
        {sessions.map((session) => {
          const selected = session.id === focusedId
          const label = sessionLabel(session)
          const full = sessionTitle(session)

          return (
            <div
              key={session.id}
              role="presentation"
              className={
                'group flex shrink-0 items-center gap-1 border-b-2 pr-1 ' +
                (selected
                  ? 'border-accent bg-stage text-ink'
                  : 'border-transparent text-ink-dim hover:bg-hover')
              }
            >
              <button
                type="button"
                role="tab"
                aria-selected={selected}
                // 截斷的是呈現，不是資料 —— 完整標題在這裡拿得到。
                title={`${full} — ${statusTitle(session)}`}
                onClick={() => onFocus(session.id)}
                className="flex items-center gap-2 py-2 pr-1 pl-3 text-xs"
              >
                <StatusDot session={session} />
                <span className="whitespace-nowrap font-mono">{label}</span>
                {session.status === 'exited' && (
                  <span className="text-[10px] text-ink-faint">已結束</span>
                )}
              </button>

              <button
                type="button"
                aria-label={`關閉 session ${label}`}
                title={`關閉 session ${full}`}
                onClick={() => onClose(session.id)}
                className="rounded px-1 text-xs text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      <button
        type="button"
        onClick={spawn.open}
        aria-label="新增 session"
        className={`${NEW_BUTTON_CLASS} mx-2`}
      >
        + session
      </button>

      {/* 剩餘空間由它吸收，好讓建立入口留在分頁旁邊。 */}
      <span className="flex-1" />

      {error && (
        <span className="max-w-[240px] self-center truncate px-2 text-[11px] text-danger">
          {error}
        </span>
      )}

      {spawn.menu}
    </div>
  )
}
