import { useState } from 'react'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { SpawnTarget } from '../types'
import { StatusDot, sessionLabel, statusTitle } from './session-badge'
import type { SessionState } from './sessions'

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
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 自按鈕的左下角展開。ContextMenu 會把位置夾進 viewport，並延一個 tick 才掛 dismiss ——
  // 否則開啟它的那次 click 冒泡到 window，會把它自己關掉（見 dialogs.tsx 的實測註解）。
  const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom + 4 })
  }

  const items: MenuItem[] = [
    {
      label: '跑 claude',
      onSelect: () => {
        setMenu(null)
        onCreate('claude')
      },
    },
    {
      label: '進 login shell',
      onSelect: () => {
        setMenu(null)
        onCreate('shell')
      },
    },
  ]

  const menuNode = menu && (
    <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
  )

  if (sessions.length === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-hairline bg-panel px-3 py-2">
        <span className="text-xs text-ink-faint">尚無 session</span>
        <button type="button" onClick={openMenu} aria-label="新增 session" className={NEW_BUTTON_CLASS}>
          + session
        </button>
        {error && <span className="truncate text-[11px] text-danger">{error}</span>}
        {menuNode}
      </div>
    )
  }

  return (
    <div className="flex items-stretch border-b border-hairline bg-panel">
      <div
        role="tablist"
        aria-label="Session 分頁"
        className="flex flex-1 items-stretch overflow-x-auto"
      >
        {sessions.map((session) => {
          const selected = session.id === focusedId
          const label = sessionLabel(session)

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
                title={`${label} — ${statusTitle(session)}`}
                onClick={() => onFocus(session.id)}
                className="flex items-center gap-2 py-2 pl-3 pr-1 text-xs"
              >
                <StatusDot session={session} />
                <span className="font-mono whitespace-nowrap">{label}</span>
                {session.status === 'exited' && (
                  <span className="text-[10px] text-ink-faint">已結束</span>
                )}
              </button>

              <button
                type="button"
                aria-label={`關閉 session ${label}`}
                title={`關閉 session ${label}`}
                onClick={() => onClose(session.id)}
                className="rounded px-1 text-xs text-ink-faint opacity-0 hover:text-danger group-hover:opacity-100"
              >
                ✕
              </button>
            </div>
          )
        })}
      </div>

      {error && (
        <span className="max-w-[240px] truncate self-center px-2 text-[11px] text-danger">
          {error}
        </span>
      )}

      <button
        type="button"
        onClick={openMenu}
        aria-label="新增 session"
        className={`${NEW_BUTTON_CLASS} mx-2`}
      >
        + session
      </button>

      {menuNode}
    </div>
  )
}
