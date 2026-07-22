import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { MarkdownView } from '../files/MarkdownView'
import type { ChangeArtifactView, DeltaSpecView, ParsedTasks } from '../types'
import type { ContinuationBlock } from './continuation'
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
  WorktreeBadge,
} from './ui'

interface ChangeViewProps {
  folderId: string
  /** 當前 focused session 錨定的 change。null＝無錨定。 */
  slug: string | null
  /** 續寫入口不可用的原因；`null` ＝ 可用。 */
  continuationBlock: ContinuationBlock | null
  /** 請 agent 續寫下一個 artifact。 */
  onContinue: () => void
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
  continuationBlock,
  onContinue,
  onOpenFile,
  onGoToChanges,
}: ChangeViewProps): React.JSX.Element {
  const { t } = useTranslation()

  const { data, loading, error } = useChange(folderId, slug)
  const [activeId, setActiveId] = useState<string | null>(null)

  if (slug === null) {
    return (
      <Empty>
        <p>{t('openspec.noAnchoredChange')}</p>
        <button
          type="button"
          onClick={onGoToChanges}
          className="rounded border border-hairline px-3 py-1 text-xs text-ink-dim hover:border-accent hover:text-accent"
        >
          {t('openspec.goToChanges')}
        </button>
      </Empty>
    )
  }

  if (error) return <ErrorNote message={error} />
  if (loading || !data) return <Loading />

  const artifacts = orderArtifacts(data.artifacts, data.schemaOrder)

  if (artifacts.length === 0) {
    return <p className="px-4 py-3 text-sm text-ink-faint">{t('openspec.noArtifacts')}</p>
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
            className="min-w-0 truncate font-mono text-lg font-bold text-ink"
            title={data.slug}
          >
            {data.slug}
          </h2>
          <StatusBadge status={data.status} />
          <WorktreeBadge worktree={data.worktree} />
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
        aria-label={t('openspec.changeArtifact')}
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
              className={`-mb-px shrink-0 border-b-2 px-3 py-[6px] text-xs transition-colors ${
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

      {/*
        條件 4（change 住在另一個工作目錄）在**這裡**判定，不在 MainStage —— 那裡只有 session
        資料，拿不到 change 的來源。分工是：MainStage 管「有沒有對的對象」，這裡管「這個 change
        是不是它搆得著的」。session 的條件優先回報（先看有沒有對象，再看對象搆不搆得著）。
      */}
      <ContinuationBar
        missing={data.missingArtifacts}
        blocked={
          continuationBlock ??
          (data.worktree && !data.worktree.isFolderRoot ? 'foreignWorktree' : null)
        }
        onContinue={onContinue}
      />
    </div>
  )
}

/**
 * 「請 agent 續寫下一個 artifact」的入口 —— 側欄第一次對 session **發話**（此前只有跟隨）。
 *
 * **一顆按鈕，不是每個缺漏的 artifact 各一顆。** 使用者原本要的是後者，但續寫流程一次只產生
 * 一個、且**由它自己挑**：排四顆按鈕會承諾一個它給不出的選擇（按「specs」那顆，寫出來的可能
 * 是 design）。而「下一個會是哪一個」我們刻意不算 —— readiness 取決於 schema 的依賴規則，
 * 側欄複製那套規則就是複製一份**會過期**的權威。因此只誠實列出「還缺哪些」（design D4）。
 *
 * 不可用時**停用而非消失**：消失會讓人以為這個功能不存在或壞了。
 */
function ContinuationBar({
  missing,
  blocked,
  onContinue,
}: {
  missing: string[]
  blocked: ContinuationBlock | null
  onContinue: () => void
}): React.JSX.Element | null {
  const { t } = useTranslation()

  // artifact 齊備 —— 沒有東西要續寫，不佔位置。
  if (missing.length === 0) return null

  return (
    <div className="flex shrink-0 items-center gap-2 border-t border-hairline px-4 py-2">
      <button
        type="button"
        disabled={blocked !== null}
        onClick={onContinue}
        aria-label={t('openspec.continueArtifact')}
        title={blocked ? t(`openspec.continueBlocked.${blocked}`) : undefined}
        className={`shrink-0 rounded border px-3 py-1 text-xs ${
          blocked
            ? 'cursor-not-allowed border-hairline text-ink-faint opacity-50'
            : 'border-accent text-accent hover:bg-hover'
        }`}
      >
        {t('openspec.continueArtifact')}
      </button>
      <span className="min-w-0 truncate text-xs text-ink-faint">
        {blocked
          ? t(`openspec.continueBlocked.${blocked}`)
          : t('openspec.continueMissing', { artifacts: missing.join(', ') })}
      </span>
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

/**
 * task 的完成標記。
 *
 * **不用 `☑` / `☐` 這兩個字元** —— 它們是字型的 glyph，長相隨字型而變（與 box-drawing 在終端裡
 * 的問題同源：同一個語意，換一個字型就是另一個樣子，而我們控制不了使用者裝了什麼）。改為內嵌
 * SVG，形狀由我們自己畫。取自 spek web `ChangeDetail` 既有的樣式，兩邊看起來是同一個東西。
 *
 * 不引入 icon 套件 —— 為兩個 16×16 的圖形背一整包相依，不划算。
 */
function TaskMark({ completed }: { completed: boolean }): React.JSX.Element {
  return completed ? (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="mt-1 h-4 w-4 shrink-0 text-green"
    >
      <circle cx="8" cy="8" r="7" fill="currentColor" opacity="0.2" />
      <path
        d="M5 8l2 2 4-4"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  ) : (
    <svg
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
      className="mt-1 h-4 w-4 shrink-0 text-ink-faint"
    >
      <circle cx="8" cy="8" r="7" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

function TaskList({ tasks }: { tasks: ParsedTasks }): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <section aria-label={t('openspec.tasks')} className="flex flex-col gap-3">
      {tasks.sections.map((section) => (
        <div key={section.title}>
          {/*
            標題與 task 都用 `text-base` —— 與 proposal 那些純文字內文（MarkdownView）同一級。
            它一度比它底下的 task 還小，那說不通。層級靠字重與顏色區分，不靠字級。
          */}
          <h4 className="mb-1.5 text-base font-bold text-ink">{section.title}</h4>
          {/*
            task 清單是側欄的**主要閱讀內容** —— 使用者一邊駕駛 agent 一邊盯著的就是它。
            它一度被當成輔助文字：偏小的字級 + 暗灰 + 緊行距，三者疊起來，把字級旋鈕轉到
            底也還是嫌小。主要內容用主要內容的層級（`text-base`）、正常行距、未完成者用
            最亮的前景色 —— 「還沒做的事」才是要讀的東西。
          */}
          <ul className="flex flex-col gap-1">
            {section.tasks.map((task) => (
              <li
                key={task.text}
                className={`flex gap-2 text-base ${
                  task.completed ? 'text-ink-faint line-through' : 'text-ink'
                }`}
              >
                <TaskMark completed={task.completed} />
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
  const { t } = useTranslation()

  return (
    <section aria-label={t('openspec.specDeltas')} className="flex flex-col gap-4">
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
                    <span className="min-w-0 flex-1 text-sm font-bold text-ink">
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
  const { t } = useTranslation()

  if (!relPath) return null

  return (
    <button
      type="button"
      onClick={() => onOpenFile(relPath)}
      aria-label={t('openspec.openInFiles', { path: relPath })}
      title={t('openspec.openInFiles', { path: relPath })}
      className="shrink-0 rounded border border-hairline px-[6px] py-[1px] text-2xs text-ink-faint hover:border-accent hover:text-accent"
    >
      ▤
    </button>
  )
}
