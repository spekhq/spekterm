import { type Heading, extractHeadings } from '@spekjs/core/headings'
import { useMemo, useState } from 'react'
import type { ChangeInfo } from '../types'
import { useChanges, useSpec, useSpecs } from './data'
import { ErrorNote, Loading, ProgressBar, TaskCount, WorktreeBadge } from './ui'
import { useTranslation } from 'react-i18next'

interface BrowseViewProps {
  folderId: string
  /** 當前 focused session 錨定的 change —— 它的節點會被標示。 */
  anchoredChange: string | null
  /** 觸發一個 change＝錨定它並切到本 change。 */
  onAnchor: (slug: string) => void
  /** 觸發一個 spec topic＝檢視它的內容。 */
  onOpenSpec: (topic: string) => void
}

/**
 * 「瀏覽」視圖：上下堆疊的兩棵樹。
 *
 * **藍本是 VSCode extension 的 tree provider，不是 spek web 的 Sidebar。** web 的 Sidebar 只是
 * 五個扁平的 nav link（Overview / Specs / Changes / Graph / Timeline），內容全在主頁面裡 ——
 * 那個結構對我們沒用。VSCode 的兩棵樹才是**為 ~300px 窄側欄設計的**：
 *
 * - Specs：`topic → heading(h2/h3)`
 * - Changes：`Active / Archived → change`
 *
 * 兩棵樹同時可見（各自可收合），使用者不必在兩個分頁之間來回切換才能看見全貌（design D11）。
 */
export function BrowseView({
  folderId,
  anchoredChange,
  onAnchor,
  onOpenSpec,
}: BrowseViewProps): React.JSX.Element {
  return (
    <div className="flex flex-col gap-1 px-2 py-2">
      <SpecsTree folderId={folderId} onOpenSpec={onOpenSpec} />
      <ChangesTree folderId={folderId} anchoredChange={anchoredChange} onAnchor={onAnchor} />
    </div>
  )
}

/** 樹的頂層區段（SPECS / CHANGES），可收合，右側顯示數量。 */
function TreeSection({
  label,
  count,
  children,
}: {
  label: string
  count: number | null
  children: React.ReactNode
}): React.JSX.Element {
  const [open, setOpen] = useState(true)

  return (
    <section aria-label={label}>
      <button
        type="button"
        onClick={() => setOpen((previous) => !previous)}
        aria-expanded={open}
        className="flex w-full items-center gap-1 rounded px-1 py-[3px] hover:bg-hover"
      >
        <Chevron open={open} />
        <span className="flex-1 text-left text-2xs font-bold uppercase tracking-wider text-ink-faint">
          {label}
        </span>
        {count !== null && (
          <span className="shrink-0 font-mono text-2xs text-ink-faint">{count}</span>
        )}
      </button>

      {open && <div className="pb-2">{children}</div>}
    </section>
  )
}

function Chevron({ open }: { open: boolean }): React.JSX.Element {
  return <span className="w-[10px] shrink-0 text-2xs text-ink-faint">{open ? '▾' : '▸'}</span>
}

/** 樹上的一列。`depth` 決定縮排，`role="treeitem"` 讓探針以角色定位。 */
function Row({
  depth,
  expandable,
  expanded,
  selected,
  onActivate,
  onToggle,
  title,
  children,
}: {
  depth: number
  expandable?: boolean
  expanded?: boolean
  selected?: boolean
  onActivate: () => void
  onToggle?: () => void
  title?: string
  children: React.ReactNode
}): React.JSX.Element {
  const { t } = useTranslation()

  return (
    <div
      role="treeitem"
      aria-level={depth + 1}
      aria-expanded={expandable ? expanded : undefined}
      aria-selected={selected}
      title={title}
      className={`flex items-center rounded ${selected ? 'bg-accent-soft' : 'hover:bg-hover'}`}
      style={{ paddingLeft: `${depth * 12}px` }}
    >
      {/* 展開鈕與「開啟」是**兩個不同的動作** —— 點箭頭只展開，不要順手把內容也換掉。 */}
      {expandable ? (
        <button
          type="button"
          onClick={onToggle}
          aria-label={expanded ? t('openspec.collapse') : t('openspec.expand')}
          className="shrink-0 px-1 py-[3px]"
        >
          <Chevron open={Boolean(expanded)} />
        </button>
      ) : (
        <span className="w-[18px] shrink-0" />
      )}

      <button
        type="button"
        onClick={onActivate}
        className="flex min-w-0 flex-1 items-center gap-2 py-[3px] pr-2 text-left"
      >
        {children}
      </button>
    </div>
  )
}

function SpecsTree({
  folderId,
  onOpenSpec,
}: {
  folderId: string
  onOpenSpec: (topic: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const { data, loading, error } = useSpecs(folderId)
  const [expanded, setExpanded] = useState<ReadonlySet<string>>(() => new Set())

  const toggle = (topic: string): void => {
    setExpanded((previous) => {
      const next = new Set(previous)
      if (next.has(topic)) next.delete(topic)
      else next.add(topic)
      return next
    })
  }

  return (
    <TreeSection label={t('openspec.specs')} count={data?.length ?? null}>
      {error ? (
        <ErrorNote message={error} />
      ) : loading || !data ? (
        <Loading />
      ) : data.length === 0 ? (
        <p className="px-3 py-1 text-xs text-ink-faint">{t('openspec.noSpecs')}</p>
      ) : (
        data.map((spec) => (
          <div key={spec.topic}>
            <Row
              depth={1}
              expandable
              expanded={expanded.has(spec.topic)}
              onToggle={() => toggle(spec.topic)}
              onActivate={() => onOpenSpec(spec.topic)}
              title={spec.topic}
            >
              <span className="min-w-0 flex-1 truncate font-mono text-sm text-ink">
                {spec.topic}
              </span>
              <span className="shrink-0 text-2xs text-ink-faint">
                {spec.relatedChangeCount}
              </span>
            </Row>

            {expanded.has(spec.topic) && (
              <SpecHeadings
                folderId={folderId}
                topic={spec.topic}
                onOpenSpec={() => onOpenSpec(spec.topic)}
              />
            )}
          </div>
        ))
      )}
    </TreeSection>
  )
}

/**
 * 一個 spec 的 heading 子層。
 *
 * heading 由 core 的 `extractHeadings` 解析 —— 那是 **node-free 的 subpath**（`@spekjs/core/headings`），
 * renderer 可以 runtime import，**因此不需要為它新增 IPC**。內容經既有的 `getSpec` 取得，
 * 展開才載入（lazy）。
 */
function SpecHeadings({
  folderId,
  topic,
  onOpenSpec,
}: {
  folderId: string
  topic: string
  onOpenSpec: () => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const { data, loading, error } = useSpec(folderId, topic)

  const headings = useMemo<Heading[]>(
    () => (data ? extractHeadings(data.content) : []),
    [data],
  )

  if (error) return <ErrorNote message={error} />
  if (loading || !data) return <p className="py-1 pl-8 text-xs text-ink-faint">{t('common.loading')}</p>
  if (headings.length === 0) {
    return <p className="py-1 pl-8 text-xs text-ink-faint">{t('openspec.noHeadings')}</p>
  }

  return (
    <>
      {headings.map((heading) => (
        <Row
          key={heading.slug}
          depth={heading.level === 2 ? 2 : 3}
          onActivate={onOpenSpec}
          title={heading.text}
        >
          <span className="min-w-0 flex-1 truncate text-xs text-ink-dim">{heading.text}</span>
          {heading.level === 3 && (
            <span className="shrink-0 font-mono text-2xs text-ink-faint">h3</span>
          )}
        </Row>
      ))}
    </>
  )
}

function ChangesTree({
  folderId,
  anchoredChange,
  onAnchor,
}: {
  folderId: string
  anchoredChange: string | null
  onAnchor: (slug: string) => void
}): React.JSX.Element {
  const { t } = useTranslation()

  const { data, loading, error } = useChanges(folderId)

  const total = data ? data.active.length + data.archived.length : null

  return (
    <TreeSection label={t('openspec.changes')} count={total}>
      {error ? (
        <ErrorNote message={error} />
      ) : loading || !data ? (
        <Loading />
      ) : total === 0 ? (
        <p className="px-3 py-1 text-xs text-ink-faint">{t('openspec.noChanges')}</p>
      ) : (
        <>
          <ChangeGroup
            label={t('openspec.active')}
            changes={data.active}
            anchoredChange={anchoredChange}
            onAnchor={onAnchor}
            defaultOpen
          />
          <ChangeGroup
            label={t('openspec.archived')}
            changes={data.archived}
            anchoredChange={anchoredChange}
            onAnchor={onAnchor}
            defaultOpen={false}
          />
        </>
      )}
    </TreeSection>
  )
}

function ChangeGroup({
  label,
  changes,
  anchoredChange,
  onAnchor,
  defaultOpen,
}: {
  label: string
  changes: ChangeInfo[]
  anchoredChange: string | null
  onAnchor: (slug: string) => void
  defaultOpen: boolean
}): React.JSX.Element | null {
  const { t } = useTranslation()
  const [open, setOpen] = useState(defaultOpen)

  if (changes.length === 0) return null

  return (
    <section aria-label={t('openspec.changeGroup', { group: label })}>
      <Row
        depth={1}
        expandable
        expanded={open}
        onToggle={() => setOpen((previous) => !previous)}
        onActivate={() => setOpen((previous) => !previous)}
        title={label}
      >
        <span className="min-w-0 flex-1 truncate text-xs font-bold text-ink-dim">{label}</span>
        <span className="shrink-0 font-mono text-2xs text-ink-faint">{changes.length}</span>
      </Row>

      {open &&
        changes.map((change) => {
          const anchored = change.slug === anchoredChange
          return (
            <div key={change.slug}>
              <Row
                depth={2}
                selected={anchored}
                onActivate={() => onAnchor(change.slug)}
                title={change.slug}
              >
                <span
                  className={`min-w-0 flex-1 truncate font-mono text-xs ${
                    anchored ? 'text-accent' : 'text-ink'
                  }`}
                >
                  {change.slug}
                </span>
                <WorktreeBadge worktree={change.worktree} />
                {change.taskStats && (
                  <TaskCount
                    completed={change.taskStats.completed}
                    total={change.taskStats.total}
                  />
                )}
              </Row>

              {/* 進度條在 slug 底下自成一列 —— 窄欄裡與文字並排會把 slug 擠到只剩幾個字。 */}
              {change.taskStats && change.taskStats.total > 0 && (
                <div className="py-[2px] pl-[42px] pr-2">
                  <ProgressBar
                    completed={change.taskStats.completed}
                    total={change.taskStats.total}
                  />
                </div>
              )}
            </div>
          )
        })}
    </section>
  )
}
