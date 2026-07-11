import { ChangeTimeline, SpecGraph, buildLanes } from '@spekjs/ui'
import { useEffect, useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import type { ChangeInfo } from '../types'
import { useChanges, useGraphData } from './data'
import { ErrorNote, Loading } from './ui'

/** overlay 裡的兩個視覺化。**它們是不同的東西** —— Graph 是關聯結構，Timeline 是生命週期。 */
export type VizKind = 'graph' | 'timeline'

interface VizOverlayProps {
  folderId: string
  folderName: string
  kind: VizKind
  onChangeKind: (kind: VizKind) => void
  onClose: () => void
  /** 在圖上選一個 change＝錨定它並關閉 overlay。 */
  onSelectChange: (slug: string) => void
  /** 在圖上選一個 spec＝關閉 overlay 並在側欄檢視它。 */
  onSelectSpec: (topic: string) => void
}

const TABS: { id: VizKind; label: string }[] = [
  { id: 'graph', label: '◈ Graph' },
  { id: 'timeline', label: '▤ Timeline' },
]

/**
 * Graph 與 Timeline 的全視窗 overlay。
 *
 * **它們不屬於 side panel。** Timeline 的最小可用寬度是 920px（label 欄 200 + 圖表區 720，都是
 * `@spekjs/ui` 的預設值），而側欄上限是 620px —— 硬塞的話只看得到時間軸的一小段。而它們是
 * 「**搞懂全局**」的動作，不是「一邊駕駛 agent 一邊盯著」的動作，沒有與 terminal 並存的需求
 *（design D12）。
 *
 * 兩個視覺化本身來自 **`@spekjs/ui`** —— 與 spek web 用的是同一份程式碼。這裡只做宿主的事：
 * 取數、loading／error、把使用者的選擇接回錨定。**不傳 `themeKey`**：這個 app 只有深色主題，
 * 沒有換膚可言。
 *
 * 以 portal 掛到 `document.body`：`position: fixed` 若有祖先帶 `transform` / `filter` 就會改以
 * 那個祖先為定位基準 —— 而它上面是 `react-resizable-panels`。不賭這件事。
 */
export function VizOverlay({
  folderId,
  folderName,
  kind,
  onChangeKind,
  onClose,
  onSelectChange,
  onSelectSpec,
}: VizOverlayProps): React.JSX.Element {
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent): void => {
      if (event.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [onClose])

  return createPortal(
    <div
      role="dialog"
      aria-modal="true"
      aria-label={kind === 'graph' ? 'Graph' : 'Timeline'}
      className="fixed inset-0 z-50 flex flex-col bg-stage"
    >
      <header className="flex shrink-0 items-center gap-2 border-b border-hairline px-4 py-2">
        <span className="text-xs text-ink-faint">{folderName}</span>

        <nav aria-label="視覺化" role="tablist" className="ml-3 flex gap-1">
          {TABS.map(({ id, label }) => (
            <button
              key={id}
              type="button"
              role="tab"
              aria-selected={kind === id}
              onClick={() => onChangeKind(id)}
              className={`rounded px-3 py-1 text-[12px] transition-colors ${
                kind === id
                  ? 'bg-accent-soft font-bold text-accent'
                  : 'text-ink-dim hover:bg-hover hover:text-ink'
              }`}
            >
              {label}
            </button>
          ))}
        </nav>

        <span className="flex-1" />

        <button
          type="button"
          onClick={onClose}
          aria-label="關閉"
          title="關閉（Esc）"
          className="rounded border border-hairline px-2 py-1 text-[12px] text-ink-dim hover:border-accent hover:text-accent"
        >
          ✕ Esc
        </button>
      </header>

      <div className="min-h-0 flex-1 overflow-auto p-4">
        {kind === 'graph' ? (
          <GraphPane folderId={folderId} onSelectChange={onSelectChange} onSelectSpec={onSelectSpec} />
        ) : (
          <TimelinePane folderId={folderId} onSelectChange={onSelectChange} />
        )}
      </div>
    </div>,
    document.body,
  )
}

function GraphPane({
  folderId,
  onSelectChange,
  onSelectSpec,
}: {
  folderId: string
  onSelectChange: (slug: string) => void
  onSelectSpec: (topic: string) => void
}): React.JSX.Element {
  const { data, loading, error } = useGraphData(folderId)

  if (error) return <ErrorNote message={error} />
  if (loading || !data) return <Loading />
  if (data.edges.length === 0) {
    return <p className="px-4 py-3 text-xs text-ink-faint">沒有 spec 與 change 的關聯可以呈現。</p>
  }

  // 圖會填滿父容器 —— 父容器要有明確高度，且 relative 才放得下圖例。
  return (
    <div className="relative h-full min-h-[400px] overflow-hidden rounded border border-hairline bg-shell">
      <SpecGraph data={data} onSelectSpec={onSelectSpec} onSelectChange={onSelectChange} />
    </div>
  )
}

function TimelinePane({
  folderId,
  onSelectChange,
}: {
  folderId: string
  onSelectChange: (slug: string) => void
}): React.JSX.Element {
  const changes = useChanges(folderId)
  const graph = useGraphData(folderId)
  const [groupByTopic, setGroupByTopic] = useState(false)
  const [hideActive, setHideActive] = useState(false)
  const [hideArchived, setHideArchived] = useState(false)

  const all = useMemo<ChangeInfo[]>(
    () => (changes.data ? [...changes.data.active, ...changes.data.archived] : []),
    [changes.data],
  )

  const filtered = useMemo(
    () =>
      all.filter((change) => {
        if (hideActive && change.status === 'active') return false
        if (hideArchived && change.status === 'archived') return false
        return true
      }),
    [all, hideActive, hideArchived],
  )

  // group by topic 才需要關係圖（它用來推 change → topic 的對應）。
  const { lanes, unknownCreated } = useMemo(
    () => buildLanes(filtered, groupByTopic ? (graph.data ?? null) : null, groupByTopic),
    [filtered, graph.data, groupByTopic],
  )

  if (changes.error) return <ErrorNote message={changes.error} />
  if (changes.loading || !changes.data) return <Loading />

  const laneItems = lanes.reduce((total, lane) => total + lane.items.length, 0)

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center gap-2">
        <Chip
          label={groupByTopic ? '已依 topic 分組' : '依 topic 分組'}
          active={groupByTopic}
          onClick={() => setGroupByTopic((v) => !v)}
        />
        <span className="h-4 w-px bg-hairline" />
        <Chip label="隱藏 active" active={hideActive} onClick={() => setHideActive((v) => !v)} />
        <Chip
          label="隱藏 archived"
          active={hideArchived}
          onClick={() => setHideArchived((v) => !v)}
        />
      </div>

      {laneItems === 0 ? (
        <p className="rounded border border-hairline px-4 py-6 text-xs text-ink-faint">
          沒有可以放上時間軸的 change。
        </p>
      ) : (
        <ChangeTimeline
          lanes={lanes}
          groupByTopic={groupByTopic}
          onSelectChange={(change) => onSelectChange(change.slug)}
        />
      )}

      {/* 沒有 createdDate 的 change 放不上時間軸 —— 它們不該就這樣消失。 */}
      {unknownCreated.length > 0 && (
        <section aria-label="沒有建立日期的 change">
          <h3 className="mb-1 text-[12px] font-bold text-ink-dim">
            沒有建立日期（{unknownCreated.length}）
          </h3>
          <ul className="flex flex-col gap-[2px]">
            {unknownCreated.map((change) => (
              <li key={change.slug}>
                <button
                  type="button"
                  onClick={() => onSelectChange(change.slug)}
                  className="font-mono text-[12px] text-ink-faint hover:text-accent"
                  title={change.description}
                >
                  {change.slug}
                </button>
              </li>
            ))}
          </ul>
        </section>
      )}
    </div>
  )
}

function Chip({
  label,
  active,
  onClick,
}: {
  label: string
  active: boolean
  onClick: () => void
}): React.JSX.Element {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded border px-2 py-[3px] text-[12px] transition-colors ${
        active
          ? 'border-accent bg-accent-soft text-accent'
          : 'border-hairline text-ink-dim hover:text-ink'
      }`}
    >
      {label}
    </button>
  )
}
