import { useCallback, useEffect, useState } from 'react'
import { CodeViewer } from '../../editor'
import type { FileContent, FsFailure, FsResult } from '../types'
import { MarkdownView } from './MarkdownView'
import { baseNameOf, isMarkdown } from './paths'
import { formatBytes } from './relative-time'

type ViewerState =
  | { status: 'loading' }
  | { status: 'ready'; content: FileContent }
  | { status: 'failed'; failure: FsFailure }
  | { status: 'deleted' }

/**
 * 拒絕的理由要能被讀懂。`detail` 由主行程隨結果送來 —— UI 不去解析錯誤訊息的字串。
 */
function describeFailure(failure: FsFailure): { title: string; hint?: string } {
  switch (failure.code) {
    case 'TOO_LARGE': {
      const size = failure.detail?.size
      const limit = failure.detail?.limit
      return {
        title: '檔案過大，無法檢視',
        hint:
          size !== undefined && limit !== undefined
            ? `這個檔案是 ${formatBytes(size)}，檢視器的上限是 ${formatBytes(limit)}。`
            : undefined,
      }
    }
    case 'BINARY':
      return { title: '二進位檔案，無法以文字檢視' }
    case 'NOT_A_FILE':
      return { title: '目標不是檔案' }
    case 'ESCAPES_ROOT':
      return { title: '超出 workspace 邊界', hint: '這個路徑指向已加入的 folder 之外。' }
    case 'NOT_FOUND':
      return { title: '檔案不存在' }
    default:
      return { title: '無法開啟檔案', hint: failure.message }
  }
}

interface NoticeProps {
  title: string
  hint?: string
  tone?: 'neutral' | 'danger'
}

function Notice({ title, hint, tone = 'neutral' }: NoticeProps): React.JSX.Element {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 px-6 text-center">
      <p className={`text-sm ${tone === 'danger' ? 'text-danger' : 'text-ink-dim'}`}>{title}</p>
      {hint && <p className="text-xs text-ink-faint">{hint}</p>}
    </div>
  )
}

interface FileViewerProps {
  folderId: string
  relPath: string
}

/** 呼叫端以 `relPath` 為 key 掛載，因此初始狀態就是 `loading`，不需要 effect 去設它。 */
export function FileViewer({ folderId, relPath }: FileViewerProps): React.JSX.Element {
  const [state, setState] = useState<ViewerState>({ status: 'loading' })
  const [stale, setStale] = useState(false)

  const applyResult = useCallback((result: FsResult<FileContent>): void => {
    setStale(false)
    setState(
      result.ok ? { status: 'ready', content: result.value } : { status: 'failed', failure: result },
    )
  }, [])

  const reload = useCallback((): void => {
    setState({ status: 'loading' })
    void window.workspace.fs.readFile(folderId, relPath).then(applyResult)
  }, [applyResult, folderId, relPath])

  // 初次載入。`cancelled` 不只是為了消 lint —— 元件在回應抵達之前就可能被換掉
  //（使用者連點兩個檔案），那時舊的回應不該覆寫新的內容。
  useEffect(() => {
    let cancelled = false

    void window.workspace.fs.readFile(folderId, relPath).then((result) => {
      if (!cancelled) applyResult(result)
    })

    return () => {
      cancelled = true
    }
  }, [applyResult, folderId, relPath])

  // 檢視中的檔案被外部改動 → 提示過期。唯讀，沒有未儲存的變更，因此不需要衝突解決。
  useEffect(() => {
    return window.workspace.fs.onWatchEvent((batch) => {
      if (batch.folderId !== folderId) return

      for (const event of batch.events) {
        if (event.relPath !== relPath) continue
        if (event.type === 'unlink') setState({ status: 'deleted' })
        else if (event.type === 'change') setStale(true)
      }
    })
  }, [folderId, relPath])

  if (state.status === 'loading') {
    return <Notice title="載入中…" />
  }

  if (state.status === 'deleted') {
    return <Notice title="這個檔案已被刪除" tone="danger" />
  }

  if (state.status === 'failed') {
    const { title, hint } = describeFailure(state.failure)
    return <Notice title={title} hint={hint} tone="danger" />
  }

  return (
    <div className="flex h-full flex-col">
      {stale && (
        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-hover px-3 py-2 text-xs text-ink-dim">
          <span>檔案已在磁碟上變更</span>
          <button
            type="button"
            onClick={reload}
            className="rounded border border-hairline px-2 py-[2px] text-[11px] text-accent hover:bg-stage"
          >
            重新載入
          </button>
        </div>
      )}

      {/* markdown 需要外層捲動；編輯器自己捲動，包上 overflow-auto 會讓它量不到高度 */}
      <div className="min-h-0 flex-1">
        {isMarkdown(relPath) ? (
          <div className="h-full overflow-auto">
            <MarkdownView text={state.content.text} />
          </div>
        ) : (
          <CodeViewer
            value={state.content.text}
            fileName={baseNameOf(relPath)}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  )
}
