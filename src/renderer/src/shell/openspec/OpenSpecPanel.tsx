import { useCallback, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorkspaceFolder } from '../types'
import { BrowseView } from './BrowseView'
import { ChangeView } from './ChangeView'
import type { ContinuationBlock } from './continuation'
import { SpecDetail } from './SpecDetail'
import type { OpenSpecRequest } from './nav'
import type { VizKind } from '../maximize-state'
import { VizView } from './VizView'

/** OpenSpec 身分**內部**的第二層導航。與 side panel 的身分切換（OpenSpec │ Files）不同層級。 */
export type OpenSpecTab = 'change' | 'browse'

/**
 * Graph and Timeline in the same view switch. They are not `OpenSpecTab`s: they are a layer above
 * the panel's own view, owned by `MainStage` (design M5), so choosing one never touches `tab` —
 * "the view before Graph" is simply `tab`.
 */
const VIZ_TABS: {
  id: VizKind
  icon: string
  labelKey: 'viz.graph' | 'viz.timeline'
  titleKey: 'openspec.graphTooltip' | 'openspec.timelineTooltip'
}[] = [
  { id: 'graph', icon: '◈', labelKey: 'viz.graph', titleKey: 'openspec.graphTooltip' },
  { id: 'timeline', icon: '▤', labelKey: 'viz.timeline', titleKey: 'openspec.timelineTooltip' },
]

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
  /** Graph or Timeline shown on top of this panel's own view; `null` = the panel's own view. */
  viz: VizKind | null
  /** Show Graph or Timeline (this maximizes the side panel). */
  onChooseViz: (kind: VizKind) => void
  /** Back to the panel's own view; the side panel stays maximized. */
  onLeaveViz: () => void
}

/**
 * side panel 的 OpenSpec 身分。
 *
 * 兩個視圖：**本 change**（駕駛 agent 時盯的東西）與 **瀏覽**（Specs / Changes 兩棵樹）。
 *
 * 一度是四個視圖（本 change / Specs / Changes / Graph）—— 使用者的判定是「Specs 跟 Changes 這兩個
 * nav 放在這邊感覺太浪費了」。兩棵樹讓他同時看見兩邊的輪廓，而不是在分頁之間來回切換（design D11）。
 *
 * **Graph and Timeline** are offered in the same view switch, but only shown while the side panel is
 * maximized: Timeline needs more than 900px, the side panel's normal width is far less
 * (`openspec-panel`, "Graph and Timeline are views of the maximized side panel").
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
  viz,
  onChooseViz,
  onLeaveViz,
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
          {viz ? (
            <span>{t(viz === 'graph' ? 'viz.graph' : 'viz.timeline')}</span>
          ) : (
            <Crumb tab={activeTab} anchoredChange={anchoredChange} openSpec={openSpec} />
          )}
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
            aria-selected={viz === null && activeTab === id}
            onClick={() => {
              onLeaveViz()
              setTab(id)
              if (id === 'browse') setOpenSpec(null)
            }}
            className={`rounded px-2 py-[3px] text-xs transition-colors ${
              viz === null && activeTab === id
                ? 'bg-accent-soft font-bold text-accent'
                : 'text-ink-dim hover:bg-hover hover:text-ink'
            }`}
          >
            {t(labelKey)}
          </button>
        ))}

        {VIZ_TABS.map(({ id, icon, labelKey, titleKey }) => (
          <button
            key={id}
            type="button"
            role="tab"
            aria-selected={viz === id}
            onClick={() => onChooseViz(id)}
            title={t(titleKey)}
            className={`rounded px-2 py-[3px] text-xs transition-colors ${
              viz === id
                ? 'bg-accent-soft font-bold text-accent'
                : 'text-ink-dim hover:bg-hover hover:text-ink'
            }`}
          >
            {`${icon} ${t(labelKey)}`}
          </button>
        ))}
      </nav>

      {/*
        **Hidden, not unmounted, while Graph or Timeline is shown — and it is this scroll container
        itself that is hidden.** A hidden scroller keeps its `scrollTop`; an outer scroller whose
        content is swapped resets to 0, and Browse scrolls here (This change and the spec detail
        have their own scrollers). So restoring shows the view exactly as it was (design M5).
      */}
      <div className="min-h-0 flex-1 overflow-auto" hidden={viz !== null}>
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

      {viz !== null && (
        <VizView
          folderId={folder.id}
          kind={viz}
          onSelectChange={(slug) => {
            onLeaveViz()
            anchorAndShow(slug)
          }}
          onSelectSpec={(topic) => {
            onLeaveViz()
            showSpec(topic)
          }}
        />
      )}
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
        <span>{t('openspec.breadcrumbChanges')}</span>
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
        <span>{t('openspec.breadcrumbSpecs')}</span>
        <span className="px-1">/</span>
        <span className="font-bold text-accent" title={openSpec}>
          {openSpec}
        </span>
      </>
    )
  }

  return <span>{t('openspec.tabBrowse')}</span>
}
