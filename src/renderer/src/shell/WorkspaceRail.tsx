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
  onSelect,
  onRemove,
}: {
  folder: WorkspaceFolder
  selected: boolean
  onSelect: () => void
  onRemove: () => void
}): React.JSX.Element {
  const openSpecTitle = folder.hasOpenSpec
    ? `${folder.name} — 以 OpenSpec 身分開啟`
    : `${folder.name} — 沒有 openspec/，只能用 Files 身分`

  return (
    // 巢狀形狀沿用雛型（repo 列之下可容納 session 子列），Phase 4 加子層時不需重構
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
        <FolderIcon />

        <div className="min-w-0 flex-1">
          <div className="truncate">{folder.name}</div>
          <div className="truncate text-[11px] text-ink-faint">
            {folder.status === 'missing' ? '路徑失效' : folder.hasOpenSpec ? 'OpenSpec' : 'Files only'}
          </div>
        </div>

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
              onSelect={() => onSelect(folder.id)}
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
