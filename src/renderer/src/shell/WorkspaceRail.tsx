import { useCallback, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
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

const ICON_BUTTON_CLASS = 'shrink-0 rounded px-1.5 py-0.5 text-sm opacity-0 group-hover:opacity-100'

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
  const { t } = useTranslation()
  // 每個 folder 各持有自己的選單狀態 —— rail 上有很多列，共用一份會錨錯位置。
  const spawn = useSpawnMenu(onCreateSession)
  const [menu, setMenu] = useState<{ x: number; y: number; session: SessionState } | null>(null)
  const [renaming, setRenaming] = useState<SessionState | null>(null)
  const rowRefs = useRef(new Map<number, HTMLDivElement>())

  const rectOf = useCallback((index: number) => {
    return rowRefs.current.get(index)?.getBoundingClientRect() ?? null
  }, [])

  const reorder = useDragReorder(sessions.length, 'vertical', rectOf, onReorderSessions)

  /**
   * 副標只說**非常態**的事。
   *
   * 「含有 `openspec/`」是常態 —— 每一列都喊一次的訊息不傳達任何資訊，只是噪音（而它一度
   * 還與最右邊那顆 `◈` 是同一個布林值的兩次呈現）。因此有 openspec 時它沉默，只在**缺少**
   * 時附註；分支則是常時呈現的事實。
   */
  const subtitle =
    folder.status === 'missing'
      ? t('rail.pathMissing')
      : [folder.branch, folder.hasOpenSpec ? null : t('rail.noOpenspec')]
          .filter(Boolean)
          .join(' · ')

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
          'flex cursor-pointer items-center gap-2 px-3 py-2 text-base ' +
          (selected ? 'bg-hover text-ink' : 'text-ink-dim hover:bg-hover/60')
        }
      >
        {sessions.length > 0 ? (
          <button
            type="button"
            aria-expanded={expanded}
            aria-label={
              expanded
                ? t('rail.collapseSessions', { name: folder.name })
                : t('rail.expandSessions', { name: folder.name })
            }
            title={expanded ? t('rail.collapseTooltip') : t('rail.expandTooltip')}
            onClick={(event) => {
              // 展開／收合不該順手改變選中的 repo。
              event.stopPropagation()
              onToggle()
            }}
            className="w-3 shrink-0 text-2xs text-ink-faint hover:text-ink"
          >
            {expanded ? '▾' : '▸'}
          </button>
        ) : (
          <span className="w-3 shrink-0" aria-hidden="true" />
        )}

        <FolderIcon />

        <div className="min-w-0 flex-1">
          {/*
            名稱是使用者用來辨識 repo 的東西，必須是這一列視覺權重最高的元素。它一度是
            normal weight + 未選中時暗灰，於是雖然字級比副標大，卻被副標平分了注意力 ——
            字重與顏色比 px 更能解決「不夠突出」。
          */}
          <div className={`truncate font-bold ${selected ? 'text-accent' : 'text-ink'}`}>
            {folder.name}
          </div>
          {subtitle && <div className="truncate font-mono text-xs text-ink-faint">{subtitle}</div>}
        </div>

        {sessions.length > 0 && (
          <span
            title={t('rail.sessionCount', { count: sessions.length })}
            className="shrink-0 rounded bg-hover px-1 text-2xs text-ink-faint"
          >
            {sessions.length}
          </span>
        )}

        {folder.status === 'missing' && (
          <span
            title={t('rail.missingTooltip', { path: folder.path })}
            className="shrink-0 rounded border border-danger/40 px-1 text-2xs text-danger"
          >
            {t('rail.missingBadge')}
          </span>
        )}

        {/* 在 rail 上看得到 session，就該能在原地開一個 —— 不必先切到主舞台。 */}
        <button
          type="button"
          disabled={folder.status !== 'ok'}
          aria-label={t('rail.newSessionIn', { name: folder.name })}
          title={folder.status === 'ok' ? t('sessions.new') : t('rail.newSessionDisabled')}
          onClick={spawn.open}
          className={`${ICON_BUTTON_CLASS} ${
            folder.status === 'ok' ? 'text-ink-faint hover:text-accent' : 'text-ink-faint opacity-40'
          }`}
        >
          ＋
        </button>

        {/*
          這裡曾有一顆 `◈`。它的 onClick 裡**只有 stopPropagation()** —— 一顆長得像按鈕、
          按下去卻什麼都不發生的指示燈，會反覆消耗使用者的注意力去確認它是不是壞了。而且
          OpenSpec 身分的**真入口**是主舞台 header 的 PanelSwitch（那裡本來就有一個 ◈），
          雛型的 rail 裡從來沒有這顆。已移除 —— rail 不呈現不可操作的控制項。
        */}
        <button
          type="button"
          aria-label={t('rail.removeFolder', { name: folder.name })}
          title={t('rail.removeFolderTooltip', { name: folder.name })}
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
        <ul aria-label={t('rail.folderSessions', { name: folder.name })} className="pb-1">
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
                    'flex items-center gap-2 py-1.5 pr-1 pl-9 text-xs select-none ' +
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
                    aria-label={t('sessions.closeSession', { label })}
                    title={t('sessions.closeSession', { label: full })}
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
  const { t } = useTranslation()
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
    <aside
      aria-label={t('rail.label')}
      className="flex h-full min-w-0 flex-col overflow-hidden border-r border-hairline bg-rail"
    >
      {/* 標題不會自己截斷，於是它會撐住 rail 的 min-content —— 拖到最小寬度時就溢出到分界之外。 */}
      <h2 className="truncate px-3 pt-3 pb-2 text-xs tracking-widest text-ink-faint">
        {t('rail.heading')}
      </h2>

      <ul className="flex-1 overflow-y-auto">
        {folders.length === 0 ? (
          <li className="px-3 py-6 text-sm text-ink-faint">{t('rail.empty')}</li>
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
        className="m-2 rounded border border-dashed border-hairline px-3 py-2 text-sm text-ink-dim hover:border-accent/40 hover:text-accent"
      >
        {t('rail.addFolder')}
      </button>
    </aside>
  )
}
