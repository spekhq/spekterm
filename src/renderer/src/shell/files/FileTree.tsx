import type { TreeRow } from './useFileTree'
import { formatRelativeTime } from './relative-time'

const INDENT_PX = 18

/** 目錄展開／收合的字符，其餘為葉節點的點 —— 取自雛型的 `.file-row .ico`。 */
function glyphFor(row: TreeRow): string {
  if (row.loading) return '⋯'
  if (row.kind === 'directory') return row.expanded ? '▾' : '▸'
  if (row.kind === 'symlink') return '↳'
  return '·'
}

interface FileRowProps {
  row: TreeRow
  now: number
  dirty: boolean
  onActivate: (row: TreeRow) => void
  onContextMenu: (row: TreeRow, x: number, y: number) => void
}

function FileRow({ row, now, dirty, onActivate, onContextMenu }: FileRowProps): React.JSX.Element {
  const isDirectory = row.kind === 'directory'

  return (
    <div
      role="treeitem"
      aria-expanded={isDirectory ? row.expanded : undefined}
      aria-level={row.depth + 1}
      aria-selected={false}
      tabIndex={0}
      title={row.error ?? row.relPath}
      onClick={() => onActivate(row)}
      onContextMenu={(event) => {
        event.preventDefault()
        onContextMenu(row, event.clientX, event.clientY)
      }}
      onKeyDown={(event) => {
        if (event.key === 'Enter' || event.key === ' ') {
          event.preventDefault()
          onActivate(row)
        }
      }}
      style={{ paddingLeft: 5 + row.depth * INDENT_PX }}
      className="flex cursor-default items-center gap-[7px] rounded-[5px] py-[4px] pr-[5px] text-sm text-ink-dim hover:bg-hover focus:outline-none focus-visible:bg-hover"
    >
      <span className="w-[13px] shrink-0 text-center text-2xs text-ink-faint">
        {glyphFor(row)}
      </span>
      <span
        className={`min-w-0 flex-1 truncate ${isDirectory ? 'font-semibold text-ink' : ''}`}
      >
        {row.name}
        {isDirectory ? '/' : ''}
      </span>
      {/* side panel 沒有分頁列。少了這個點，使用者無從得知自己還有未存的變更。 */}
      {dirty && (
        <span aria-label="有未存的變更" title="有未存的變更" className="shrink-0 text-accent">
          ●
        </span>
      )}
      {row.error ? (
        <span className="shrink-0 text-2xs text-danger">{row.error}</span>
      ) : (
        <span className="shrink-0 font-mono text-2xs text-ink-faint opacity-65">
          {formatRelativeTime(row.mtimeMs, now)}
        </span>
      )}
    </div>
  )
}

interface FileTreeProps {
  rows: TreeRow[]
  now: number
  /** 有未存變更的檔案路徑。 */
  dirtyPaths: ReadonlySet<string>
  onActivate: (row: TreeRow) => void
  onContextMenu: (row: TreeRow, x: number, y: number) => void
}

export function FileTree({
  rows,
  now,
  dirtyPaths,
  onActivate,
  onContextMenu,
}: FileTreeProps): React.JSX.Element {
  return (
    <div role="tree" aria-label="檔案樹" className="flex flex-col font-mono">
      {rows.map((row) => (
        <FileRow
          key={row.relPath}
          row={row}
          now={now}
          dirty={dirtyPaths.has(row.relPath)}
          onActivate={onActivate}
          onContextMenu={onContextMenu}
        />
      ))}
    </div>
  )
}
