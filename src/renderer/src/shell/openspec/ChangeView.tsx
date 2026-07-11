import { useState } from 'react'
import { MarkdownView } from '../files/MarkdownView'
import type { ChangeArtifactView, DeltaSpecView, ParsedTasks } from '../types'
import { useChange } from './data'
import { parseDelta } from './delta'
import {
  DeltaBadge,
  Empty,
  ErrorNote,
  Loading,
  ProgressBar,
  SectionTitle,
  StatusBadge,
  TaskCount,
} from './ui'

interface ChangeViewProps {
  folderId: string
  /** 當前 focused session 錨定的 change。null＝無錨定。 */
  slug: string | null
  onOpenFile: (relPath: string) => void
  onGoToChanges: () => void
}

/**
 * 「本 change」視圖 —— 側欄的主角。
 *
 * **每個 artifact 一個分頁**（Proposal │ Design │ Tasks │ Specs），一次只顯示一個 —— 與 spek web
 * 的 `ChangeDetail`（`artifacts.map(...)` 餵給 `TabView`）同一個編排。
 *
 * 一度改成「一路往下堆的區塊」（tasks + spec deltas 攤開、proposal/design 收合），實測難用：
 * 要找一段內容得先想它在第幾個區塊、再捲過前面所有東西。**並排的分頁讓「找」變成一次點擊，
 * 而不是一次搜尋。**
 *
 * 它顯示的是**當前 focused session 錨定的那個 change**，而錨定由使用者建立、系統不猜
 *（design D3）。因此「沒有錨定」是個正常狀態，不是錯誤。
 */
export function ChangeView({
  folderId,
  slug,
  onOpenFile,
  onGoToChanges,
}: ChangeViewProps): React.JSX.Element {
  const { data, loading, error } = useChange(folderId, slug)
  const [activeId, setActiveId] = useState<string | null>(null)

  if (slug === null) {
    return (
      <Empty>
        <p>這個 session 還沒有錨定的 change。</p>
        <button
          type="button"
          onClick={onGoToChanges}
          className="rounded border border-hairline px-3 py-1 text-[12px] text-ink-dim hover:border-accent hover:text-accent"
        >
          到 Changes 選一個
        </button>
      </Empty>
    )
  }

  if (error) return <ErrorNote message={error} />
  if (loading || !data) return <Loading />

  const artifacts = orderArtifacts(data.artifacts, data.schemaOrder)

  if (artifacts.length === 0) {
    return <p className="px-4 py-3 text-xs text-ink-faint">這個 change 還沒有任何 artifact。</p>
  }

  // 預設停在 tasks —— 駕駛 agent 時要盯的是它。沒有 tasks 就退回第一個 artifact。
  const fallbackId = artifacts.find((a) => a.kind === 'tasks')?.id ?? artifacts[0].id
  const active = artifacts.find((a) => a.id === activeId) ?? artifacts.find((a) => a.id === fallbackId)

  const tasks = artifacts.find((a) => a.kind === 'tasks')?.tasks

  return (
    <div className="flex h-full flex-col">
      <div className="shrink-0 px-4 pt-4">
        <div className="flex items-center gap-2">
          <h2
            className="min-w-0 truncate font-mono text-[16px] font-bold text-ink"
            title={data.slug}
          >
            {data.slug}
          </h2>
          <StatusBadge status={data.status} />
        </div>

        {/*
          進度條**留在標題底下、不進分頁** —— 它是這個 change 的狀態摘要，不論你正在讀
          proposal 還是 spec deltas 都想看得到它。
        */}
        {tasks && (
          <div className="mt-2 flex items-center gap-2">
            <ProgressBar completed={tasks.completed} total={tasks.total} />
            <TaskCount completed={tasks.completed} total={tasks.total} />
          </div>
        )}
      </div>

      <nav
        aria-label="Change artifact"
        role="tablist"
        className="mt-3 flex shrink-0 overflow-x-auto border-b border-hairline px-2"
      >
        {artifacts.map((artifact) => {
          const selected = artifact.id === active?.id
          return (
            <button
              key={artifact.id}
              type="button"
              role="tab"
              aria-selected={selected}
              onClick={() => setActiveId(artifact.id)}
              className={`-mb-px shrink-0 border-b-2 px-3 py-[6px] text-[12px] transition-colors ${
                selected
                  ? 'border-accent font-bold text-accent'
                  : 'border-transparent text-ink-dim hover:text-ink'
              }`}
            >
              {artifact.title}
            </button>
          )
        })}
      </nav>

      <div className="min-h-0 flex-1 overflow-auto px-4 py-3">
        {active && <ArtifactContent artifact={active} onOpenFile={onOpenFile} />}
      </div>
    </div>
  )
}

/** 分頁順序以 schema 宣告的為準；它拿不到時退回 core 的預設排序（mtime）。 */
function orderArtifacts(
  artifacts: ChangeArtifactView[],
  schemaOrder: string[] | undefined,
): ChangeArtifactView[] {
  if (!schemaOrder) return artifacts

  const rank = (id: string): number => {
    const index = schemaOrder.indexOf(id)
    // schema 沒提到的 artifact 排在最後，彼此維持原順序。
    return index < 0 ? Number.POSITIVE_INFINITY : index
  }

  return [...artifacts].sort((a, b) => rank(a.id) - rank(b.id))
}

function ArtifactContent({
  artifact,
  onOpenFile,
}: {
  artifact: ChangeArtifactView
  onOpenFile: (relPath: string) => void
}): React.JSX.Element {
  return (
    <>
      {/* 跳去 Files 開原始檔的入口。specs 是一整棵子目錄，沒有單一檔案可跳（見下）。 */}
      {artifact.relPath && (
        <div className="mb-2 flex justify-end">
          <OpenFileButton relPath={artifact.relPath} onOpenFile={onOpenFile} />
        </div>
      )}

      {artifact.kind === 'tasks' && artifact.tasks && <TaskList tasks={artifact.tasks} />}

      {artifact.kind === 'specs' && artifact.specs && (
        <DeltaList specs={artifact.specs} onOpenFile={onOpenFile} />
      )}

      {artifact.kind === 'markdown' && artifact.content && <MarkdownView text={artifact.content} />}
    </>
  )
}

function TaskList({ tasks }: { tasks: ParsedTasks }): React.JSX.Element {
  return (
    <section aria-label="Tasks" className="flex flex-col gap-3">
      {tasks.sections.map((section) => (
        <div key={section.title}>
          <h4 className="mb-1 text-[12px] font-bold text-ink-dim">{section.title}</h4>
          <ul className="flex flex-col gap-[2px]">
            {section.tasks.map((task) => (
              <li
                key={task.text}
                className={`flex gap-2 text-[13px] leading-snug ${
                  task.completed ? 'text-ink-faint line-through' : 'text-ink-dim'
                }`}
              >
                <span className={task.completed ? 'text-green' : 'text-ink-faint'}>
                  {task.completed ? '☑' : '☐'}
                </span>
                <span className="min-w-0">{task.text}</span>
              </li>
            ))}
          </ul>
        </div>
      ))}
    </section>
  )
}

function DeltaList({
  specs,
  onOpenFile,
}: {
  specs: DeltaSpecView[]
  onOpenFile: (relPath: string) => void
}): React.JSX.Element {
  return (
    <section aria-label="Spec deltas" className="flex flex-col gap-4">
      {specs.map((spec) => {
        const parsed = parseDelta(spec.content)

        return (
          <div key={spec.topic} className="flex flex-col gap-2">
            <div className="flex items-center gap-2">
              <SectionTitle>{spec.topic}</SectionTitle>
              <span className="flex-1" />
              <OpenFileButton relPath={spec.relPath} onOpenFile={onOpenFile} />
            </div>

            {/* 格式不合預期就原樣渲染 markdown —— delta 的格式不是我們控制的（design D9）。 */}
            {parsed.fallback !== null ? (
              <div className="rounded border border-hairline bg-stage px-3 py-2">
                <MarkdownView text={parsed.fallback} />
              </div>
            ) : (
              parsed.requirements.map((requirement) => (
                <div
                  key={`${requirement.verb}:${requirement.name}`}
                  className="rounded border border-hairline bg-stage px-3 py-2"
                >
                  <div className="mb-1 flex items-start gap-2">
                    <span className="min-w-0 flex-1 text-[13px] font-bold text-ink">
                      {requirement.name}
                    </span>
                    <DeltaBadge verb={requirement.verb} />
                  </div>
                  <MarkdownView text={requirement.body} />
                </div>
              ))
            )}
          </div>
        )
      })}
    </section>
  )
}

/** 跳到 Files 身分開這個檔。推不出路徑（不在 folder 內、或檔案不存在）時不顯示（design D5）。 */
function OpenFileButton({
  relPath,
  onOpenFile,
}: {
  relPath: string | null
  onOpenFile: (relPath: string) => void
}): React.JSX.Element | null {
  if (!relPath) return null

  return (
    <button
      type="button"
      onClick={() => onOpenFile(relPath)}
      aria-label={`在 Files 中開啟 ${relPath}`}
      title={`在 Files 中開啟 ${relPath}`}
      className="shrink-0 rounded border border-hairline px-[6px] py-[1px] text-[11px] text-ink-faint hover:border-accent hover:text-accent"
    >
      ▤
    </button>
  )
}
