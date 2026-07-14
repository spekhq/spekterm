import { useCallback, useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { t } from '@shared/i18n'
import { CodeEditor } from '../../editor'
import type { FsFailure, FsResult, FileContent } from '../types'
import { MarkdownView } from './MarkdownView'
import { useDirtyBuffers } from './dirty-buffers'
import { baseNameOf, isMarkdown } from './paths'
import { formatBytes } from './relative-time'

type ViewerState =
  | { status: 'loading' }
  | { status: 'ready'; diskText: string; diskMtimeMs: number }
  | { status: 'failed'; failure: FsFailure }
  | { status: 'deleted' }

/** markdown 的兩個互斥模式。非 markdown 的檔案永遠是 source。 */
type Mode = 'preview' | 'source'

/**
 * 拒絕的理由要能被讀懂。`detail` 由主行程隨結果送來 —— UI 不去解析錯誤訊息的字串。
 */
function describeFailure(failure: FsFailure): { title: string; hint?: string } {
  switch (failure.code) {
    case 'TOO_LARGE': {
      const size = failure.detail?.size
      const limit = failure.detail?.limit
      return {
        title: t('viewer.tooLarge'),
        hint:
          size !== undefined && limit !== undefined
            ? t('viewer.tooLargeHint', {
                size: formatBytes(size),
                limit: formatBytes(limit),
              })
            : undefined,
      }
    }
    case 'BINARY':
      return { title: t('viewer.binary') }
    case 'NOT_A_FILE':
      return { title: t('viewer.notAFile') }
    case 'ESCAPES_ROOT':
      return { title: t('viewer.escapesRoot'), hint: t('viewer.escapesRootHint') }
    case 'NOT_FOUND':
      return { title: t('viewer.notFound') }
    default:
      return { title: t('viewer.openFailed'), hint: failure.message }
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
      <p className={`text-base ${tone === 'danger' ? 'text-danger' : 'text-ink-dim'}`}>{title}</p>
      {hint && <p className="text-sm text-ink-faint">{hint}</p>}
    </div>
  )
}

interface FileViewerProps {
  folderId: string
  relPath: string
}

/** 呼叫端以 `relPath` 為 key 掛載，因此初始狀態就是 `loading`，不需要 effect 去設它。 */
export function FileViewer({ folderId, relPath }: FileViewerProps): React.JSX.Element {
  const { t } = useTranslation()
  const [state, setState] = useState<ViewerState>({ status: 'loading' })
  const [stale, setStale] = useState(false)
  /** 存檔時偵測到磁碟已被改動。保留 buffer，等使用者決定。 */
  const [conflict, setConflict] = useState(false)
  const [saveError, setSaveError] = useState<FsFailure | null>(null)
  const [mode, setMode] = useState<Mode>(() => (isMarkdown(relPath) ? 'preview' : 'source'))

  const dirty = useDirtyBuffers()
  const buffer = dirty.get(folderId, relPath)

  const applyResult = useCallback((result: FsResult<FileContent>): void => {
    setStale(false)
    setState(
      result.ok
        ? { status: 'ready', diskText: result.value.text, diskMtimeMs: result.value.mtimeMs }
        : { status: 'failed', failure: result },
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

  // 檢視中的檔案被外部改動 → 提示過期。**我們自己的存檔不會走到這裡**：主行程已抑制
  // 自寫事件，否則每存一次檔就會警告使用者磁碟被外部改動了。
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

  const diskText = state.status === 'ready' ? state.diskText : null
  const diskMtimeMs = state.status === 'ready' ? state.diskMtimeMs : 0
  const text = buffer?.text ?? diskText ?? ''

  const handleChange = useCallback(
    (next: string) => {
      if (diskText === null) return
      // 改回與磁碟一致 → 不再是未存的變更。
      if (next === diskText) dirty.discard(folderId, relPath)
      else
        dirty.set(folderId, relPath, {
          text: next,
          baseMtimeMs: buffer?.baseMtimeMs ?? diskMtimeMs,
        })
    },
    [buffer?.baseMtimeMs, diskMtimeMs, diskText, dirty, folderId, relPath],
  )

  const save = useCallback(
    async (force = false): Promise<void> => {
      setSaveError(null)
      const outcome = await dirty.save(folderId, relPath, force)

      if (outcome.status === 'saved') {
        setConflict(false)
        setStale(false)
        // 磁碟現在就是我們剛寫的內容。少了這一步，下一次「改回原內容」的比對會用舊值。
        setState((previous) =>
          previous.status === 'ready' || previous.status === 'deleted'
            ? { status: 'ready', diskText: text, diskMtimeMs: outcome.mtimeMs }
            : previous,
        )
        return
      }

      if (outcome.status === 'conflict') setConflict(true)
      else if (outcome.status === 'failed') setSaveError(outcome.failure)
    },
    [dirty, folderId, relPath, text],
  )

  // 焦點不在編輯器時（markdown 預覽）也要能存檔。編輯器內的 Cmd/Ctrl+S 由 wrapper 註冊 ——
  // monaco 會攔下該按鍵並 preventDefault，因此這裡看到的是「它沒處理」的那些情況。
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.defaultPrevented) return
      if (event.key !== 's' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      void save()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [save])

  const discardAndReload = useCallback((): void => {
    dirty.discard(folderId, relPath)
    setConflict(false)
    reload()
  }, [dirty, folderId, relPath, reload])

  if (state.status === 'loading') {
    return <Notice title={t('common.loading')} />
  }

  if (state.status === 'deleted') {
    return (
      <Notice
        title={t('viewer.deleted')}
        hint={buffer ? t('viewer.deletedDirty') : undefined}
        tone="danger"
      />
    )
  }

  if (state.status === 'failed') {
    const { title, hint } = describeFailure(state.failure)
    return <Notice title={title} hint={hint} tone="danger" />
  }

  const markdown = isMarkdown(relPath)
  const isDirty = buffer !== undefined

  return (
    <div className="flex h-full flex-col">
      {markdown && (
        <div className="flex items-center gap-1 border-b border-hairline px-3 py-1.5 text-xs">
          {(['preview', 'source'] as const).map((candidate) => (
            <button
              key={candidate}
              type="button"
              aria-pressed={mode === candidate}
              onClick={() => setMode(candidate)}
              className={`rounded px-2 py-[2px] ${
                mode === candidate ? 'bg-hover text-ink' : 'text-ink-faint hover:text-ink-dim'
              }`}
            >
              {candidate === 'preview' ? t('viewer.preview') : t('viewer.source')}
            </button>
          ))}
          {isDirty && <span className="ml-1 text-accent">●</span>}
        </div>
      )}

      {conflict && (
        <div className="border-b border-hairline bg-hover px-3 py-2 text-sm">
          <p className="text-danger">{t('viewer.conflict')}</p>
          <p className="mt-1 text-ink-faint">{t('viewer.conflictHint')}</p>
          <div className="mt-2 flex gap-2">
            <button
              type="button"
              onClick={() => void save(true)}
              className="rounded border border-hairline px-2 py-[2px] text-xs text-danger hover:bg-stage"
            >
              {t('viewer.overwrite')}
            </button>
            <button
              type="button"
              onClick={discardAndReload}
              className="rounded border border-hairline px-2 py-[2px] text-xs text-ink-dim hover:bg-stage"
            >
              {t('viewer.discardAndReload')}
            </button>
            <button
              type="button"
              onClick={() => setConflict(false)}
              className="rounded border border-hairline px-2 py-[2px] text-xs text-ink-faint hover:bg-stage"
            >
              {t('common.cancel')}
            </button>
          </div>
        </div>
      )}

      {saveError && (
        <div className="border-b border-hairline bg-hover px-3 py-2 text-sm text-danger">
          {t('viewer.saveFailed', { reason: describeFailure(saveError).title })}
        </div>
      )}

      {stale && !conflict && (
        <div className="flex items-center justify-between gap-2 border-b border-hairline bg-hover px-3 py-2 text-sm text-ink-dim">
          <span>
            {t('viewer.stale')}
            {isDirty && <span className="text-danger"> {t('viewer.staleDirty')}</span>}
          </span>
          <button
            type="button"
            onClick={isDirty ? discardAndReload : reload}
            className="rounded border border-hairline px-2 py-[2px] text-xs text-accent hover:bg-stage"
          >
            {t('viewer.reload')}
          </button>
        </div>
      )}

      {/* markdown 需要外層捲動；編輯器自己捲動，包上 overflow-auto 會讓它量不到高度 */}
      <div className="min-h-0 flex-1">
        {markdown && mode === 'preview' ? (
          <div className="h-full overflow-auto">
            {/* 渲染 buffer 的內容而非磁碟的內容 —— 切到預覽不該看見自己剛打的字消失 */}
            <MarkdownView text={text} />
          </div>
        ) : (
          <CodeEditor
            value={text}
            fileName={baseNameOf(relPath)}
            onChange={handleChange}
            onSave={() => void save()}
            className="h-full w-full"
          />
        )}
      </div>
    </div>
  )
}
