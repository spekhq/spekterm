import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFolder } from '../types'
import { BrowseView } from './BrowseView'
import { ChangeView } from './ChangeView'
import type { ContinuationBlock } from './continuation'
import { SpecDetail } from './SpecDetail'
import type { OpenSpecRequest } from './nav'
import type { VizKind } from './VizOverlay'

/** OpenSpec 身分**內部**的第二層導航。與 side panel 的身分切換（OpenSpec │ Files）不同層級。 */
export type OpenSpecTab = 'change' | 'browse'

const TABS: { id: OpenSpecTab; labelKey: 'openspec.tabChange' | 'openspec.tabBrowse' }[] = [
  { id: 'change', labelKey: 'openspec.tabChange' },
  { id: 'browse', labelKey: 'openspec.tabBrowse' },
]

/**
 * 呈現哪些視圖 —— **沒有可解析的 change 時，「本 change」連入口都不呈現**（`openspec-panel`）。
 *
 * 一個永遠只能顯示「你還沒有選 change」的視圖，佔著一個入口卻沒有內容；而選 change 的地方
 * 本來就在瀏覽視圖裡。此前它是一個帶著「Pick one from Changes」按鈕的空狀態，dogfood 時使用者
 * 看到的卻是一行 `unknown change slug: …`（落盤的錨定在該 change 被封存改名後永久失效）。
 */
function viewsFor(anchoredChange: string | null): typeof TABS {
  return anchoredChange === null ? TABS.filter((tab) => tab.id !== 'change') : TABS
}

interface OpenSpecPanelProps {
  folder: WorkspaceFolder
  /** 當前 focused session 錨定的 change。沒有 session 或沒有錨定時為 null。 */
  anchoredChange: string | null
  /** 把一個 change 錨定到當前 focused session。 */
  onAnchor: (slug: string) => void
  /** 續寫入口不可用的原因；`null` ＝ 可用。 */
  continuationBlock: ContinuationBlock | null
  sessionWorktreeKey?: string
  onOpenSessionHere: (worktreeKey: string) => void
  /** 請 agent 續寫下一個 artifact。 */
  onContinue: () => void
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
  continuationBlock,
  sessionWorktreeKey,
  onContinue,
  onOpenSessionHere,
  onOpenFile,
  request,
  onOpenViz,
}: OpenSpecPanelProps): React.JSX.Element {
  const { t } = useTranslation()

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

  /**
   * 當前視圖是**衍生**出來的，不把 `tab` 這個 state 壓成 `browse`。
   *
   * **這是承重的**：啟動時 change 清單尚未載入 ⇒ `anchoredChange` 暫為 `null`。若此刻把 state
   * 改掉，清單到達後 `tab` 已經是 `browse`，「本 change」**不會自己回來** —— 於是每次啟動都停在
   * 瀏覽視圖。純衍生沒有這個入口：暫態過去，畫面自己回到 `tab` 說的那個視圖。
   */
  const views = viewsFor(anchoredChange)
  const activeTab: OpenSpecTab = anchoredChange === null ? 'browse' : tab

  return (
    <section aria-label={t('openspec.label')} className="flex h-full flex-col overflow-hidden">
      <header className="flex items-center gap-2 border-b border-hairline px-3 py-2 text-sm">
        <nav aria-label={t('openspec.pathNav')} className="min-w-0 flex-1 truncate text-ink-faint">
          <span>{folder.name}</span>
          <span className="px-1">/</span>
          <Crumb tab={activeTab} anchoredChange={anchoredChange} openSpec={openSpec} />
        </nav>
      </header>

      <nav
        aria-label={t('openspec.views')}
        role="tablist"
        className="flex shrink-0 items-center gap-1 border-b border-hairline px-2 py-1"
      >
        {views.map(({ id, labelKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={activeTab === id}
            onClick={() => {
              setTab(id)
              if (id === 'browse') setOpenSpec(null)
            }}
            className={`rounded px-2 py-[3px] text-xs transition-colors ${
              activeTab === id
                ? 'bg-accent-soft font-bold text-accent'
                : 'text-ink-dim hover:bg-hover hover:text-ink'
            }`}
          >
            {t(labelKey)}
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
          aria-label={t('openspec.openGraph')}
          title={t('openspec.graphTooltip')}
          className="rounded px-2 py-[3px] text-xs text-ink-dim hover:bg-hover hover:text-accent"
        >
          ◈
        </button>
        <button
          type="button"
          onClick={() => onOpenViz('timeline')}
          aria-label={t('openspec.openTimeline')}
          title={t('openspec.timelineTooltip')}
          className="rounded px-2 py-[3px] text-xs text-ink-dim hover:bg-hover hover:text-accent"
        >
          ▤
        </button>
      </nav>

      <div className="min-h-0 flex-1 overflow-auto">
        {/*
          `activeTab === 'change'` 不會讓 TypeScript 知道 `anchoredChange` 非 null —— 兩者的
          關聯在 `activeTab` 的推導裡，而編譯器看不見。明寫那個判斷。
        */}
        {activeTab === 'change' && anchoredChange !== null && (
          <ChangeView
            folderId={folder.id}
            slug={anchoredChange}
            continuationBlock={continuationBlock}
            sessionWorktreeKey={sessionWorktreeKey}
            onContinue={onContinue}
            onOpenSessionHere={onOpenSessionHere}
            onOpenFile={onOpenFile}
          />
        )}

        {activeTab === 'browse' &&
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
  const { t } = useTranslation()

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

  return <span>{t('openspec.tabBrowse')}</span>
}
