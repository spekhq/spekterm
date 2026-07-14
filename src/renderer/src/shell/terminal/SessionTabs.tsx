import { useCallback, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { SpawnTarget } from '../types'
import { SessionNameDialog } from './SessionNameDialog'
import { StatusDot, sessionLabel, sessionTitle, statusTitle } from './session-badge'
import type { SessionState } from './sessions'
import { useDragReorder } from './useDragReorder'
import { useSpawnMenu } from './useSpawnMenu'
import { useTranslation } from 'react-i18next'

interface SessionTabsProps {
  sessions: SessionState[]
  focusedId: string | null
  onFocus: (sessionId: string) => void
  onClose: (sessionId: string) => void
  onCreate: (spawnTarget: SpawnTarget) => void
  onRename: (sessionId: string, name: string) => void
  onReorder: (fromIndex: number, toIndex: number) => void
  /** 建立失敗的訊息（folder 失效、pty 配置不出來等）。 */
  error: string | null
}

const NEW_BUTTON_CLASS =
  'shrink-0 self-center rounded border border-hairline px-2 py-1 text-xs text-ink-dim hover:border-accent/40 hover:text-accent'

export function SessionTabs({
  sessions,
  focusedId,
  onFocus,
  onClose,
  onCreate,
  onRename,
  onReorder,
  error,
}: SessionTabsProps): React.JSX.Element {
  const { t } = useTranslation()

  const spawn = useSpawnMenu(onCreate)
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionState } | null>(null)
  const [renaming, setRenaming] = useState<SessionState | null>(null)
  const tabRefs = useRef(new Map<number, HTMLDivElement>())

  const rectOf = useCallback((index: number) => {
    return tabRefs.current.get(index)?.getBoundingClientRect() ?? null
  }, [])

  const reorder = useDragReorder(sessions.length, 'horizontal', rectOf, onReorder)

  const items: MenuItem[] = menu
    ? [
        {
          label: t('sessions.rename'),
          onSelect: () => {
            setRenaming(menu.session)
            setMenu(null)
          },
        },
        {
          label: t('sessions.close'),
          tone: 'danger',
          onSelect: () => {
            onClose(menu.session.id)
            setMenu(null)
          },
        },
      ]
    : []

  if (sessions.length === 0) {
    return (
      <div className="flex items-center gap-3 border-b border-hairline bg-panel px-3 py-2">
        <span className="text-sm text-ink-faint">{t('sessions.empty')}</span>
        <button
          type="button"
          onClick={spawn.open}
          aria-label={t('sessions.new')}
          className={NEW_BUTTON_CLASS}
        >
          + session
        </button>
        {error && <span className="truncate text-xs text-danger">{error}</span>}
        {spawn.menu}
      </div>
    )
  }

  return (
    <div className="flex items-stretch border-b border-hairline bg-panel">
      {/*
        `tablist` 不佔 flex-1 —— 否則它會把建立入口一路推到分頁列的另一端，開第二個分頁之後
        滑鼠得橫越整條列才點得到。剩餘空間交給後面的 spacer 吸收。
      */}
      <div
        role="tablist"
        aria-label={t('sessions.tabs')}
        className="flex min-w-0 items-stretch overflow-x-auto"
      >
        {sessions.map((session, index) => {
          const selected = session.id === focusedId
          const label = sessionLabel(session)
          const full = sessionTitle(session)
          const dragging = reorder.drag?.fromIndex === index

          return (
            <div
              key={session.id}
              role="presentation"
              ref={(el) => {
                if (el) tabRefs.current.set(index, el)
                else tabRefs.current.delete(index)
              }}
              onMouseDown={(event) => reorder.onMouseDown(index, event)}
              onContextMenu={(event) => {
                event.preventDefault()
                setMenu({ x: event.clientX, y: event.clientY, session })
              }}
              className={
                // select-none：拖曳時不該把分頁的文字反白選起來。
                'group flex shrink-0 items-center gap-1 border-b-2 pr-1 select-none ' +
                (reorder.dragging ? 'cursor-grabbing ' : 'cursor-grab ') +
                // 插入指示：拖到這個位置放開，就會插在它前面
                (reorder.isDropTarget(index) ? 'border-l-2 border-l-accent ' : '') +
                (dragging ? 'opacity-40 ' : '') +
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
                className="flex items-center gap-2 py-2 pr-1 pl-3 text-sm"
              >
                <StatusDot session={session} />
                <span className="whitespace-nowrap font-mono">{label}</span>
                {session.status === 'exited' && (
                  <span className="text-2xs text-ink-faint">{t('sessions.exitedBadge')}</span>
                )}
              </button>

              <button
                type="button"
                aria-label={t('sessions.closeSession', { label })}
                title={t('sessions.closeSession', { label: full })}
                onClick={() => onClose(session.id)}
                className="rounded px-1 text-sm text-ink-faint opacity-0 group-hover:opacity-100 hover:text-danger"
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
        aria-label={t('sessions.new')}
        className={`${NEW_BUTTON_CLASS} mx-2`}
      >
        + session
      </button>

      {/* 剩餘空間由它吸收，好讓建立入口留在分頁旁邊。 */}
      <span className="flex-1" />

      {error && (
        <span className="max-w-[240px] self-center truncate px-2 text-xs text-danger">
          {error}
        </span>
      )}

      {spawn.menu}
      {menu && (
        <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />
      )}
      {renaming && (
        <SessionNameDialog
          initialValue={sessionTitle(renaming)}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            onRename(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
    </div>
  )
}
