import { useCallback, useEffect, useState } from 'react'
import type { WorkspaceFolder } from '../types'
import { FileTree } from './FileTree'
import { FileViewer } from './FileViewer'
import { useFileTree } from './useFileTree'

/** 相對時間會過期。面板開著的時候，每分鐘讓它重算一次。 */
function useNow(intervalMs = 60_000): number {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), intervalMs)
    return () => clearInterval(timer)
  }, [intervalMs])

  return now
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
 * 隨重新掛載自然歸零，不需要 effect 去清。
 */
export function FilesPanel({ folder }: FilesPanelProps): React.JSX.Element {
  const [openPath, setOpenPath] = useState<string | null>(null)
  const now = useNow()

  const openFile = useCallback((relPath: string) => setOpenPath(relPath), [])
  const tree = useFileTree(folder?.id ?? null, openFile)

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

  return (
    <section aria-label="Files" className="flex h-full flex-col overflow-hidden">
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

        {openPath === null ? (
          <span className="shrink-0 font-mono text-[10px] text-ink-faint">
            {tree.visibleCount} 個項目
          </span>
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
              <FileTree rows={tree.rows} now={now} onActivate={tree.activate} />
            )}
          </div>
        ) : (
          // key：換檔案等於換一份內容，讓它重新掛載而非在 effect 裡把狀態清乾淨
          <FileViewer key={openPath} folderId={folder.id} relPath={openPath} />
        )}
      </div>
    </section>
  )
}
