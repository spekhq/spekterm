import { useCallback, useEffect, useState } from 'react'
import type { FsFailure, FsResult, WorkspaceFolder } from '../types'
import { ConfirmDelete, ContextMenu, type MenuItem, NameDialog } from './dialogs'
import { FileTree } from './FileTree'
import { FileViewer } from './FileViewer'
import { useDirtyBuffers } from './dirty-buffers'
import { ROOT_PATH, baseNameOf, joinRelPath, parentOf } from './paths'
import { type TreeRow, useFileTree } from './useFileTree'

/** 相對時間會過期。面板開著的時候，每分鐘讓它重算一次。 */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
}

/** 檔案操作的失敗要說得出原因。UI 讀 `code`，不解析錯誤訊息。 */
function describeOperationFailure(failure: FsFailure): string {
  switch (failure.code) {
    case 'ALREADY_EXISTS':
      return '這個名稱已經被使用了'
    case 'INVALID_NAME':
      return '這個名稱在某些平台上無法使用'
    case 'NOT_FOUND':
      return '目標已不存在'
    case 'ESCAPES_ROOT':
      return '這個路徑超出 workspace 邊界'
    case 'PROTECTED_ROOT':
      return '不能對 workspace folder 本身做這件事'
    default:
      return failure.message
  }
}

type Dialog =
  | { kind: 'newFile' | 'newDirectory'; parent: string }
  | { kind: 'rename'; target: string }

interface MenuState {
  /** `null` 代表 folder 的根目錄 —— 它在樹上沒有對應的列。 */
  row: TreeRow | null
  x: number
  y: number
}

interface FilesPanelProps {
  folder: WorkspaceFolder | null
}

/**
 * side panel 的 Files 身分。
 *
 * 它有兩個**狀態**（樹、單一檔案），不是兩個並列的區域 —— side panel 的寬度不足以
 * 同時容納兩者。換頁而非開新 tab：主舞台屬於 terminal，檔案檢視是它旁邊的上下文。
 *
 * `useFileTree` 一律保持掛載（即使正在看檔案）—— 監看集合由它持有，卸載它會連帶撤掉
 * 檔案所在目錄的監看，檢視器就再也收不到「檔案已變更」。
 *
 * 呼叫端以 `folder.id` 為 key 掛載本元件，因此換 folder 時展開狀態與開啟的檔案
 * 隨重新掛載自然歸零。**未存的變更不在此列** —— 它們由 `DirtyBuffersProvider` 持有，
 * 位於本元件之上（design D9）。
 */
export function FilesPanel({ folder }: FilesPanelProps): React.JSX.Element {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const [menu, setMenu] = useState<MenuState | null>(null)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const [pendingDelete, setPendingDelete] = useState<TreeRow | null>(null)
  const [serverError, setServerError] = useState<string | null>(null)
  const now = useNow()

  const dirty = useDirtyBuffers()
  const folderId = folder?.id ?? ''

  const openFile = useCallback((relPath: string) => setOpenPath(relPath), [])
  const tree = useFileTree(folder?.id ?? null, openFile)

  const closeMenu = useCallback(() => setMenu(null), [])
  const closeDialog = useCallback(() => {
    setDialog(null)
    setServerError(null)
  }, [])

  const openContextMenu = useCallback((row: TreeRow, x: number, y: number) => {
    setMenu({ row, x, y })
  }, [])

  /** 統一處理失敗：留在對話框裡把原因說出來，而不是靜默關閉。 */
  const run = useCallback(
    async (result: Promise<FsResult<void>>, onSuccess: () => void): Promise<void> => {
      const outcome = await result
      if (!outcome.ok) {
        setServerError(describeOperationFailure(outcome))
        return
      }
      setServerError(null)
      onSuccess()
    },
    [],
  )

  const submitDialog = useCallback(
    (name: string): void => {
      if (!folder || !dialog) return

      if (dialog.kind === 'rename') {
        const to = joinRelPath(parentOf(dialog.target), name)
        void run(window.workspace.fs.rename(folder.id, dialog.target, to), () => {
          // 未存的變更跟著新的路徑走；改到目錄時，其下的 buffer 一併重寫。
          dirty.moveBuffer(folder.id, dialog.target, to)
          if (openPath === dialog.target) setOpenPath(to)
          else if (openPath?.startsWith(`${dialog.target}/`)) {
            setOpenPath(`${to}${openPath.slice(dialog.target.length)}`)
          }
          closeDialog()
        })
        return
      }

      const relPath = joinRelPath(dialog.parent, name)
      const create =
        dialog.kind === 'newFile'
          ? window.workspace.fs.createFile(folder.id, relPath)
          : window.workspace.fs.createDirectory(folder.id, relPath)

      void run(create, closeDialog)
    },
    [closeDialog, dialog, dirty, folder, openPath, run],
  )

  const confirmDelete = useCallback((): void => {
    if (!folder || !pendingDelete) return
    const { relPath } = pendingDelete

    void run(window.workspace.fs.deleteEntry(folder.id, relPath), () => {
      // 目標沒了，它底下的未存變更也就沒有歸宿。
      dirty.discardUnder(folder.id, relPath)
      if (openPath === relPath || openPath?.startsWith(`${relPath}/`)) setOpenPath(null)
      setPendingDelete(null)
    })
  }, [dirty, folder, openPath, pendingDelete, run])

  if (!folder) {
    return (
      <section
        aria-label="Files"
        className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint"
      >
        尚未選擇 repo —— 於左側的 workspace 選一個，或加入新的 folder
      </section>
    )
  }

  const dirtyCount = dirty.countFor(folderId)

  // 目錄的新增目標是它自己，檔案的新增目標是它的父目錄。根目錄由 header 的入口負責。
  const menuItems = ((): MenuItem[] => {
    if (!menu) return []
    const row = menu.row
    const parent = row === null ? ROOT_PATH : row.kind === 'directory' ? row.relPath : parentOf(row.relPath)

    const items: MenuItem[] = [
      {
        label: '新增檔案',
        onSelect: () => {
          setDialog({ kind: 'newFile', parent })
          closeMenu()
        },
      },
      {
        label: '新增資料夾',
        onSelect: () => {
          setDialog({ kind: 'newDirectory', parent })
          closeMenu()
        },
      },
    ]

    if (row) {
      items.push(
        {
          label: '重新命名',
          onSelect: () => {
            setDialog({ kind: 'rename', target: row.relPath })
            closeMenu()
          },
        },
        {
          label: '刪除',
          tone: 'danger',
          onSelect: () => {
            setPendingDelete(row)
            closeMenu()
          },
        },
      )
    }

    return items
  })()

  return (
    <section aria-label="Files" className="relative flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
        <nav aria-label="路徑" className="min-w-0 flex-1 truncate text-ink-faint">
          <span>{folder.name}</span>
          <span className="px-1">/</span>
          {openPath === null ? (
            <span className="text-ink">files</span>
          ) : (
            <>
              <button
                type="button"
                onClick={() => setOpenPath(null)}
                className="text-ink-dim underline decoration-dotted underline-offset-2 hover:text-accent"
              >
                files
              </button>
              <span className="px-1">/</span>
              <span className="text-ink" title={openPath}>
                {openPath}
              </span>
            </>
          )}
        </nav>

        {/* 未存的檔案可能藏在一個尚未展開的目錄裡，樹上的標記那時看不到。 */}
        {dirtyCount > 0 && (
          <span className="shrink-0 text-[10px] text-accent" title="未存的變更">
            ● {dirtyCount}
          </span>
        )}

        {openPath === null ? (
          <>
            <span className="shrink-0 font-mono text-[10px] text-ink-faint">
              {tree.visibleCount} 個項目
            </span>
            {/* 根目錄在樹上沒有列可以右鍵，因此入口在這裡。 */}
            <button
              type="button"
              aria-label="在根目錄新增"
              title="在根目錄新增"
              onClick={(event) => {
                event.stopPropagation()
                setMenu({ row: null, x: event.clientX, y: event.clientY })
              }}
              className="shrink-0 rounded border border-hairline px-2 py-[2px] text-[11px] text-ink-dim hover:text-accent"
            >
              ＋
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setOpenPath(null)}
            className="shrink-0 rounded border border-hairline px-2 py-[2px] text-[11px] text-ink-dim hover:text-accent"
          >
            ‹ 返回
          </button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-hidden">
        {openPath === null ? (
          <div className="h-full overflow-auto px-1 py-1">
            {tree.rootError ? (
              <p className="px-3 py-2 text-xs text-danger">{tree.rootError}</p>
            ) : tree.rootLoading && tree.rows.length === 0 ? (
              <p className="px-3 py-2 text-xs text-ink-faint">載入中…</p>
            ) : (
              <FileTree
                rows={tree.rows}
                now={now}
                dirtyPaths={dirty.pathsFor(folderId)}
                onActivate={tree.activate}
                onContextMenu={openContextMenu}
              />
            )}
          </div>
        ) : (
          // key：換檔案等於換一份內容，讓它重新掛載而非在 effect 裡把狀態清乾淨
          <FileViewer key={openPath} folderId={folder.id} relPath={openPath} />
        )}
      </div>

      {menu && <ContextMenu x={menu.x} y={menu.y} items={menuItems} onClose={closeMenu} />}

      {dialog && (
        <NameDialog
          title={
            dialog.kind === 'rename'
              ? '重新命名'
              : dialog.kind === 'newFile'
                ? '新增檔案'
                : '新增資料夾'
          }
          initialValue={dialog.kind === 'rename' ? baseNameOf(dialog.target) : ''}
          serverError={serverError}
          onSubmit={submitDialog}
          onCancel={closeDialog}
        />
      )}

      {pendingDelete && (
        <ConfirmDelete
          relPath={pendingDelete.relPath}
          isDirectory={pendingDelete.kind === 'directory'}
          hasUnsaved={dirty.hasUnsavedUnder(folderId, pendingDelete.relPath)}
          onConfirm={confirmDelete}
          onCancel={() => {
            setPendingDelete(null)
            setServerError(null)
          }}
        />
      )}

      {serverError && !dialog && (
        <p className="border-t border-hairline px-3 py-2 text-[11px] text-danger">{serverError}</p>
      )}
    </section>
  )
}
