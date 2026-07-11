import { useCallback, useState } from 'react'
import { StatusDot, sessionLabel, statusTitle } from './terminal/session-badge'
import { type SessionState, useSessions } from './terminal/sessions'
import type { WorkspaceFolder } from './types'

interface WorkspaceRailProps {
  folders: WorkspaceFolder[]
  selectedId: string | null
  onSelect: (id: string) => void
  onAdd: () => void
  onRemove: (id: string) => void
}

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
  onRemove: () => void
}): React.JSX.Element {
  const openSpecTitle = folder.hasOpenSpec
    ? `${folder.name} — 以 OpenSpec 身分開啟`
    : `${folder.name} — 沒有 openspec/，只能用 Files 身分`

  return (
    // 巢狀形狀沿用雛型：repo 列之下容納 session 子列（mockup 的 .ws-sessions）
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
            className="w-3 shrink-0 text-[10px] text-ink-faint hover:text-ink"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}

        <FolderIcon />

        <div className="min-w-0 flex-1">
          <div className="truncate">{folder.name}</div>
          <div className="truncate text-[11px] text-ink-faint">
            {folder.status === 'missing' ? '路徑失效' : folder.hasOpenSpec ? 'OpenSpec' : 'Files only'}
          </div>
        </div>

        {sessions.length > 0 && (
          <span
            title={`${sessions.length} 個 session`}
            className="shrink-0 rounded bg-hover px-1 text-[10px] text-ink-faint"
          >
            {sessions.length}
          </span>
        )}

        {folder.status === 'missing' && (
          <span
            title={`路徑已不存在或不是目錄：${folder.path}`}
            className="shrink-0 rounded border border-danger/40 px-1 text-[10px] text-danger"
          >
            失效
          </span>
        )}

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
          className="shrink-0 rounded px-1.5 py-0.5 text-xs text-ink-faint opacity-0 hover:text-danger group-hover:opacity-100"
        >
          ✕
        </button>
      </div>

      {expanded && sessions.length > 0 && (
        <ul aria-label={`${folder.name} 的 session`} className="pb-1">
          {sessions.map((session) => {
            const isFocused = session.id === focusedSessionId
            const label = sessionLabel(session)

            return (
              <li key={session.id}>
                <div
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectSession(session.id)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' || event.key === ' ') onSelectSession(session.id)
                  }}
                  title={`${label} — ${statusTitle(session)}`}
                  className={
                    // 縮排造出樹狀層次（mockup 的 .ws-session-row）
                    'flex cursor-pointer items-center gap-2 py-1.5 pr-3 pl-9 text-[11px] ' +
                    (isFocused ? 'bg-stage text-ink' : 'text-ink-dim hover:bg-hover/60')
                  }
                >
                  <StatusDot session={session} />
                  <span className="truncate font-mono">{label}</span>
                </div>
              </li>
            )
          })}
        </ul>
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

  return (
    <aside aria-label="工作區" className="flex h-full flex-col border-r border-hairline bg-rail">
      <h2 className="px-3 pt-3 pb-2 text-[11px] tracking-widest text-ink-faint">WORKSPACE</h2>

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
