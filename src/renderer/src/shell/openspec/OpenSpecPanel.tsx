import { useCallback, useState } from 'react'
import type { WorkspaceFolder } from '../types'
import { BrowseView } from './BrowseView'
import { ChangeView } from './ChangeView'
import { SpecDetail } from './SpecDetail'
import type { OpenSpecRequest } from './nav'
import type { VizKind } from './VizOverlay'

/** OpenSpec 身分**內部**的第二層導航。與 side panel 的身分切換（OpenSpec │ Files）不同層級。 */
export type OpenSpecTab = 'change' | 'browse'

const TABS: { id: OpenSpecTab; label: string }[] = [
  { id: 'change', label: '本 change' },
  { id: 'browse', label: '瀏覽' },
]

interface OpenSpecPanelProps {
  folder: WorkspaceFolder
  /** 當前 focused session 錨定的 change。沒有 session 或沒有錨定時為 null。 */
  anchoredChange: string | null
  /** 把一個 change 錨定到當前 focused session。 */
  onAnchor: (slug: string) => void
  /** 跳到 Files 身分並開啟該檔（design D7 的跨身分導航）。 */
  onOpenFile: (relPath: string) => void
  /** 自 Files 身分跳過來的目標（「在 OpenSpec 中檢視」）。 */
  request: OpenSpecRequest | null
  /** 開啟全視窗 overlay 的 Graph／Timeline（design D12）。 */
  onOpenViz: (kind: VizKind) => void
}

/**
 * side panel 的 OpenSpec 身分。
 *
 * 兩個視圖：**本 change**（駕駛 agent 時盯的東西）與 **瀏覽**（Specs / Changes 兩棵樹）。
 *
 * 一度是四個視圖（本 change / Specs / Changes / Graph）—— 使用者的判定是「Specs 跟 Changes 這兩個
 * nav 放在這邊感覺太浪費了」。兩棵樹讓他同時看見兩邊的輪廓，而不是在分頁之間來回切換（design D11）。
 *
 * **Graph 與 Timeline 不在這裡** —— 它們在全視窗 overlay（design D12）：Timeline 的最小可用寬度
 * 超過 900px，而側欄上限是 620px。
 */
export function OpenSpecPanel({
  folder,
  anchoredChange,
  onAnchor,
  onOpenFile,
  request,
  onOpenViz,
}: OpenSpecPanelProps): React.JSX.Element {
  // 自 Files 身分跳過來的請求，**初始值就要套用** —— 這個元件在切到 OpenSpec 身分的那一刻
  // 才掛載，若只在「nonce 變了」時才反應，跳過來的那一次會沒有反應。
  const [tab, setTab] = useState<OpenSpecTab>(
    request?.target.kind === 'spec' ? 'browse' : 'change',
  )
  /** 瀏覽視圖的第二層換頁：兩棵樹 ↔ 單一 spec 的內容。 */
  const [openSpec, setOpenSpec] = useState<string | null>(
    request?.target.kind === 'spec' ? request.target.topic : null,
  )

  const anchorAndShow = useCallback(
    (slug: string) => {
      onAnchor(slug)
      setTab('change')
    },
    [onAnchor],
  )

  const showSpec = useCallback((topic: string) => {
    setOpenSpec(topic)
    setTab('browse')
  }, [])

  // 在**渲染期間**調整自己的 state，不用 effect：effect 要等 commit 之後才跑，那一幀畫出去的
  // 會是舊的 tab。這裡只碰自己的 state —— change 的錨定由 `MainStage` 在送出請求時一併完成
  //（在渲染期間呼叫父層的 setState 是不允許的）。
  const nonce = request?.nonce ?? null
  const [seenNonce, setSeenNonce] = useState(nonce)

  if (nonce !== seenNonce) {
    setSeenNonce(nonce)
    if (request?.target.kind === 'change') {
      setTab('change')
    } else if (request?.target.kind === 'spec') {
      setOpenSpec(request.target.topic)
      setTab('browse')
    }
  }

  return (
    <section aria-label="OpenSpec" className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-xs">
        <nav aria-label="路徑" className="min-w-0 flex-1 truncate text-ink-faint">
          <span>{folder.name}</span>
          <span className="px-1">/</span>
          <Crumb tab={tab} anchoredChange={anchoredChange} openSpec={openSpec} />
        </nav>
      </header>

      <nav
        aria-label="OpenSpec 視圖"
        role="tablist"
        className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1"
      >
        {TABS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={tab === id}
            onClick={() => {
              setTab(id)
              if (id === 'browse') setOpenSpec(null)
            }}
            className={`rounded px-2 py-[3px] text-[11px] transition-colors ${
              tab === id
                ? 'bg-accent-soft font-bold text-accent'
                : 'text-ink-dim hover:bg-hover hover:text-ink'
            }`}
          >
            {label}
          </button>
        ))}

        <span className="flex-1" />

        {/*
          Graph 與 Timeline 的入口。它們**不是這一列的視圖** —— 點下去是蓋滿視窗的 overlay
          （Timeline 的最小可用寬度遠超過側欄的上限，design D12）。
        */}
        <button
          type="button"
          onClick={() => onOpenViz('graph')}
          aria-label="開啟 Graph"
          title="Graph —— spec 與 change 的關聯"
          className="rounded px-2 py-[3px] text-[11px] text-ink-dim hover:bg-hover hover:text-accent"
        >
          ◈
        </button>
        <button
          type="button"
          onClick={() => onOpenViz('timeline')}
          aria-label="開啟 Timeline"
          title="Timeline —— change 的生命週期"
          className="rounded px-2 py-[3px] text-[11px] text-ink-dim hover:bg-hover hover:text-accent"
        >
          ▤
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-auto">
        {tab === 'change' && (
          <ChangeView
            folderId={folder.id}
            slug={anchoredChange}
            onOpenFile={onOpenFile}
            onGoToChanges={() => {
              setOpenSpec(null)
              setTab('browse')
            }}
          />
        )}

        {tab === 'browse' &&
          (openSpec === null ? (
            <BrowseView
              folderId={folder.id}
              anchoredChange={anchoredChange}
              onAnchor={anchorAndShow}
              onOpenSpec={showSpec}
            />
          ) : (
            <SpecDetail
              folderId={folder.id}
              topic={openSpec}
              onBack={() => setOpenSpec(null)}
              onOpenFile={onOpenFile}
            />
          ))}
      </div>
    </section>
  )
}

function Crumb({
  tab,
  anchoredChange,
  openSpec,
}: {
  tab: OpenSpecTab
  anchoredChange: string | null
  openSpec: string | null
}): React.JSX.Element {
  if (tab === 'change') {
    return (
      <>
        <span>changes</span>
        {anchoredChange && (
          <>
            <span className="px-1">/</span>
            <span className="font-bold text-accent" title={anchoredChange}>
              {anchoredChange}
            </span>
          </>
        )}
      </>
    )
  }

  if (openSpec) {
    return (
      <>
        <span>specs</span>
        <span className="px-1">/</span>
        <span className="font-bold text-accent" title={openSpec}>
          {openSpec}
        </span>
      </>
    )
  }

  return <span>瀏覽</span>
}
