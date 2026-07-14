import { MarkdownView } from '../files/MarkdownView'
import { useSpec } from './data'
import { ErrorNote, Loading } from './ui'
import { useTranslation } from 'react-i18next'

interface SpecDetailProps {
  folderId: string
  topic: string
  onBack: () => void
  onOpenFile: (relPath: string) => void
}

/**
 * 單一 spec 的內容。
 *
 * 它是「瀏覽」視圖的第二個**狀態**（樹 ↔ 內容），不是與樹並列的區域 —— side panel 的寬度不允許
 * 並列（與 Files 身分同一條約束）。
 */
export function SpecDetail({
  folderId,
  topic,
  onBack,
  onOpenFile,
}: SpecDetailProps): React.JSX.Element {
  const { t } = useTranslation()

  const { data, loading, error } = useSpec(folderId, topic)

  return (
    <div className="flex h-full flex-col">
      <div className="flex shrink-0 items-center gap-2 px-3 py-2">
        <button
          type="button"
          onClick={onBack}
          className="rounded border border-hairline px-2 py-[2px] text-xs text-ink-dim hover:text-accent"
        >
          {t('common.back')}
        </button>
        <span className="flex-1" />
        {data?.relPath && (
          <button
            type="button"
            onClick={() => onOpenFile(data.relPath as string)}
            aria-label={t('openspec.openInFiles', { path: data.relPath })}
            title={t('openspec.openInFiles', { path: data.relPath })}
            className="shrink-0 rounded border border-hairline px-[6px] py-[2px] text-2xs text-ink-faint hover:border-accent hover:text-accent"
          >
            ▤
          </button>
        )}
      </div>

      <div className="min-h-0 flex-1 overflow-auto px-3 pb-4">
        {error ? (
          <ErrorNote message={error} />
        ) : loading || !data ? (
          <Loading />
        ) : (
          <>
            <MarkdownView text={data.content} />
            {data.relatedChanges.length > 0 && (
              <p className="mt-4 border-t border-hairline pt-3 text-xs text-ink-faint">
                {t('openspec.relatedChanges', { changes: data.relatedChanges.join(', ') })}
              </p>
            )}
          </>
        )}
      </div>
    </div>
  )
}
