import { useCallback, useRef, useState } from 'react'
import { ContextMenu, type MenuItem } from './files/dialogs'
import { SessionNameDialog } from './terminal/SessionNameDialog'
import { StatusDot, sessionLabel, sessionTitle, statusTitle } from './terminal/session-badge'
import { type SessionState, useSessions } from './terminal/sessions'
import { useDragReorder } from './terminal/useDragReorder'
import { useSpawnMenu } from './terminal/useSpawnMenu'
import type { SpawnTarget, WorkspaceFolder } from './types'

interface WorkspaceRailProps {
  folders: WorkspaceFolder[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}

const ICON_BUTTON_CLASS = 'shrink-0 rounded px-1.5 py-0.5 text-xs opacity-0 group-hover:opacity-100'

function FolderIcon(): React.JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      className="h-4 w-4 shrink-0 text-ink-faint"
      aria-hidden="true"
    >
      <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7z" />
    </svg>
  )
}

function FolderRow({
  folder,
  selected,
  sessions,
  focusedSessionId,
  expanded,
  onToggle,
  onSelect,
  onSelectSession,
  onCloseSession,
  onCreateSession,
  onRenameSession,
  onReorderSessions,
  onRemove,
}: {
  folder: WorkspaceFolder
  selected: boolean
  sessions: SessionState[]
  focusedSessionId: string | null
  expanded: boolean
  onToggle: () => void
  onSelect: () => void
  onSelectSession: (sessionId: string) => void
  onCloseSession: (sessionId: string) => void
  onCreateSession: (spawnTarget: SpawnTarget) => void
  onRenameSession: (sessionId: string, name: string) => void
  onReorderSessions: (fromIndex: number, toIndex: number) => void
  onRemove: () => void
}): React.JSX.Element {
  // 每個 folder 各持有自己的選單狀態 —— rail 上有很多列，共用一份會錨錯位置。
  const spawn = useSpawnMenu(onCreateSession)
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionState } | null>(null)
  const [renaming, setRenaming] = useState<SessionState | null>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())

  const rectOf = useCallback((index: number) => {
    return rowRefs.current.get(index)?.getBoundingClientRect() ?? null
  }, [])

  const reorder = useDragReorder(sessions.length, 'vertical', rectOf, onReorderSessions)

  const openSpecTitle = folder.hasOpenSpec
    ? `${folder.name} — 以 OpenSpec 身分開啟`
    : `${folder.name} — 沒有 openspec/，只能用 Files 身分`

  const items: MenuItem[] = menu
    ? [
        {
          label: '重新命名',
          onSelect: () => {
            setRenaming(menu.session)
            setMenu(null)
          },
        },
        {
          label: '關閉',
          tone: 'danger',
          onSelect: () => {
            onCloseSession(menu.session.id)
            setMenu(null)
          },
        },
      ]
    : []

  return (
    <li className="group">
      <div
        role="button"
        tabIndex={0}
        onClick={onSelect}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') onSelect()
        }}
        title={folder.path}
        className={
          'flex cursor-pointer items-center gap-2 px-3 py-2 text-sm ' +
          (selected ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-hover/60')
        }
      >
        {sessions.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={expanded ? `收合 ${folder.name} 的 session` : `展開 ${folder.name} 的 session`}
            title={expanded ? '收合 session' : '展開 session'}
            onClick={(event) => {
              // 展開／收合不該順手改變選中的 repo。
              event.stopPropagation()
              onToggle()
            }}
            className="w-3 shrink-0 text-[11px] text-ink-faint hover:text-ink"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}

        <FolderIcon />

        <div className="min-w-0 flex-1">
          <div className="truncate">{folder.name}</div>
          <div className="truncate text-[12px] text-ink-faint">
            {folder.status === 'missing' ? '路徑失效' : folder.hasOpenSpec ? 'OpenSpec' : 'Files only'}
          </div>
        </div>

        {sessions.length > 0 && (
          <span
            title={`${sessions.length} 個 session`}
            className="shrink-0 rounded bg-hover px-1 text-[11px] text-ink-faint"
          >
            {sessions.length}
          </span>
        )}

        {folder.status === 'missing' && (
          <span
            title={`路徑已不存在或不是目錄：${folder.path}`}
            className="shrink-0 rounded border border-danger/40 px-1 text-[11px] text-danger"
          >
            失效
          </span>
        )}

        {/* 在 rail 上看得到 session，就該能在原地開一個 —— 不必先切到主舞台。 */}
        <button
          type="button"
          disabled={folder.status !== 'ok'}
          aria-label={`新增 session — ${folder.name}`}
          title={folder.status === 'ok' ? '新增 session' : '路徑失效，無法開啟 session'}
          onClick={spawn.open}
          className={`${ICON_BUTTON_CLASS} ${
            folder.status === 'ok' ? 'text-ink-faint hover:text-accent' : 'text-ink-faint opacity-40'
          }`}
        >
          ＋
        </button>

        <button
          type="button"
          disabled={!folder.hasOpenSpec}
          title={openSpecTitle}
          aria-label={`OpenSpec — ${folder.name}`}
          onClick={(event) => event.stopPropagation()}
          className={
            'shrink-0 rounded px-1.5 py-0.5 text-xs ' +
            (folder.hasOpenSpec ? 'text-accent hover:bg-accent/10' : 'text-ink-faint opacity-40')
          }
        >
          ◈
        </button>

        <button
          type="button"
          aria-label={`自 workspace 移除 ${folder.name}`}
          title={`自 workspace 移除 ${folder.name}（不會刪除磁碟上的目錄）`}
          onClick={(event) => {
            event.stopPropagation()
            onRemove()
          }}
          className={`${ICON_BUTTON_CLASS} text-ink-faint hover:text-danger`}
        >
          ✕
        </button>
      </div>

      {expanded && sessions.length > 0 && (
        <ul aria-label={`${folder.name} 的 session`} className="pb-1">
          {sessions.map((session, index) => {
            const isFocused = session.id === focusedSessionId
            const label = sessionLabel(session)
            const full = sessionTitle(session)
            const dragging = reorder.drag?.fromIndex === index

            return (
              <li key={session.id} className="group/session">
                <div
                  ref={(el) => {
                    if (el) rowRefs.current.set(index, el)
                    else rowRefs.current.delete(index)
                  }}
                  role="button"
                  tabIndex={0}
                  onMouseDown={(event) => reorder.onMouseDown(index, event)}
                  onClick={() => onSelectSession(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectSession(session.id)
                  }}
                  onContextMenu={(event) => {
                    event.preventDefault()
                    event.stopPropagation()
                    setMenu({ x: event.clientX, y: event.clientY, session })
                  }}
                  title={`${full} — ${statusTitle(session)}`}
                  className={
                    // 縮排造出樹狀層次（mockup 的 .ws-session-row）
                    // select-none：拖曳時不該把標籤的文字反白選起來（實測體感很差）。
                    'flex items-center gap-2 py-1.5 pr-1 pl-9 text-[12px] select-none ' +
                    (reorder.dragging ? 'cursor-grabbing ' : 'cursor-grab ') +
                    // 插入指示：拖到這裡放開，就會插在它前面
                    (reorder.isDropTarget(index) ? 'border-t-2 border-t-accent ' : '') +
                    (dragging ? 'opacity-40 ' : '') +
                    (isFocused ? 'bg-stage text-ink' : 'text-ink-dim hover:bg-hover/60')
                  }
                >
                  <StatusDot session={session} />
                  <span className="min-w-0 flex-1 truncate font-mono">{label}</span>

                  <button
                    type="button"
                    aria-label={`關閉 session ${label}`}
                    title={`關閉 session ${full}`}
                    onClick={(event) => {
                      event.stopPropagation()
                      onCloseSession(session.id)
                    }}
                    className="shrink-0 rounded px-1 text-ink-faint opacity-0 group-hover/session:opacity-100 hover:text-danger"
                  >
                    ✕
                  </button>
                </div>
              </li>
            )
          })}
        </ul>
      )}

      {spawn.menu}
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
      {renaming && (
        <SessionNameDialog
          initialValue={sessionTitle(renaming)}
          onCancel={() => setRenaming(null)}
          onSubmit={(name) => {
            onRenameSession(renaming.id, name)
            setRenaming(null)
          }}
        />
      )}
    </li>
  )
}

export function WorkspaceRail({
  folders,
  selectedId,
  onSelect,
  onAdd,
  onRemove,
}: WorkspaceRailProps): React.JSX.Element {
  const sessions = useSessions()
  // 預設展開；記錄的是「被收合的」，因此新出現的 folder 自然是展開的。
  const [collapsed, setCollapsed] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = useCallback((folderId: string) => {
    setCollapsed((previous) => {
      const next = new Set(previous)
      if (next.has(folderId)) next.delete(folderId)
      else next.add(folderId)
      return next
    })
  }, [])

  // 點 session 子列＝選中它所屬的 repo，並把它設為該 repo 的 focused session。
  const selectSession = useCallback(
    (folderId: string, sessionId: string) => {
      onSelect(folderId)
      sessions.focus(folderId, sessionId)
    },
    [onSelect, sessions],
  )

  // 自 rail 建立 session：必然要看到它，因此也選中該 folder（create 內部會聚焦新 session）。
  const createSession = useCallback(
    (folderId: string, spawnTarget: SpawnTarget) => {
      onSelect(folderId)
      void sessions.create(folderId, spawnTarget)
    },
    [onSelect, sessions],
  )

  return (
    <aside aria-label="工作區" className="flex h-full flex-col border-r border-hairline bg-rail">
      <h2 className="px-3 pt-3 pb-2 text-[12px] tracking-widest text-ink-faint">WORKSPACE</h2>

      <ul className="flex-1 overflow-y-auto">
        {folders.length === 0 ? (
          <li className="px-3 py-6 text-xs text-ink-faint">尚未加入任何 folder</li>
        ) : (
          folders.map((folder) => (
            <FolderRow
              key={folder.id}
              folder={folder}
              selected={folder.id === selectedId}
              sessions={sessions.forFolder(folder.id)}
              focusedSessionId={sessions.focusedIdFor(folder.id)}
              expanded={!collapsed.has(folder.id)}
              onToggle={() => toggle(folder.id)}
              onSelect={() => onSelect(folder.id)}
              onSelectSession={(sessionId) => selectSession(folder.id, sessionId)}
              onCloseSession={sessions.close}
              onCreateSession={(spawnTarget) => createSession(folder.id, spawnTarget)}
              onRenameSession={sessions.rename}
              onReorderSessions={(fromIndex, toIndex) =>
                sessions.reorder(folder.id, fromIndex, toIndex)
              }
              onRemove={() => onRemove(folder.id)}
            />
          ))
        )}
      </ul>

      <button
        type="button"
        onClick={onAdd}
        className="m-2 rounded border border-dashed border-hairline px-3 py-2 text-xs text-ink-dim hover:border-accent/40 hover:text-accent"
      >
        + Add folder
      </button>
    </aside>
  )
}
