import { useTranslation } from 'react-i18next'
import { t } from '@shared/i18n'
import { FilesPanel } from '../files/FilesPanel'
import type { RootPrefix } from '../files/paths'
import { OpenSpecPanel } from '../openspec/OpenSpecPanel'
import type { ContinuationBlock } from '../openspec/continuation'
import type { VizKind } from '../maximize-state'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from '../openspec/nav'
import type { PanelIdentity, WorkspaceFolder, WorktreeOption } from '../types'
import { PanelSourceBar } from './PanelSourceBar'

interface SidePanelProps {
  identity: PanelIdentity
  /** 側欄來源（panelFolder）—— side panel 呈現哪個 repo。可與 rail 的 focused folder 不同。 */
  folder: WorkspaceFolder | null
  /** workspace 的所有 folder —— 來源指示器的下拉清單。 */
  folders: WorkspaceFolder[]
  /**
   * rail 上選中的 folder id —— 「回到自身 repo」的目標。
   *
   * 為 null 只在「沒有選中任何 folder」時發生，而那時 `folder`（panelFolder）也是 null、本元件
   * 直接走空狀態、不渲染來源列 —— 於是來源列拿到的恆為一個真實的 id（見下方的 `?? folder.id`，
   * 那是把這個不變式寫成程式碼而不是一個 non-null 斷言）。
   */
  sourceOwnerId: string | null
  /**
   * rail 上是否選中了某個項目。
   *
   * **與 `folder === null` 是兩件事**：沒選任何項目時側欄整塊沒有內容可言（連來源列都不該有，
   * 因為沒有東西可以設定來源）；而選中了全域項目、來源尚未選定時，來源列**必須呈現** ——
   * 它是使用者選一個 repo 來看的唯一入口，少了它側欄就是一塊沉默的空白（design D11）。
   */
  itemSelected: boolean
  onSelectSource: (folderId: string | null) => void
  /** 當前 focused session 錨定的 change。 */
  anchoredChange: string | null
  onAnchor: (slug: string) => void
  /** 續寫入口不可用的原因；`null` ＝ 可用。 */
  continuationBlock: ContinuationBlock | null
  /** focused session 開在哪個工作目錄（不可逆識別碼）。條件 4 的判準。 */
  sessionWorktreeKey?: string
  /**
   * 側欄的工作目錄：Files 身分以哪個工作目錄為樹根（`side-panel-worktree`）。
   *
   * **與 `sessionWorktreeKey` 是兩個不同的問題**：那個問「agent 站在哪」（續寫入口的判準），
   * 這個問「側欄讀哪一份原始碼」。兩者可不相同。
   */
  panelWorktreeKey?: string
  /** 使用者經 Files 的選擇器切換工作目錄。 */
  onSelectWorktree: (worktreeKey: string | undefined) => void
  /** 側欄來源的工作目錄清單（由上游供應 —— 見下方 `FilesPanelForFolder` 的註解）。 */
  worktrees: WorktreeOption[]
  /** 已解析的樹根前綴。 */
  rootPrefix: RootPrefix
  /** 選了工作目錄、而清單尚未抵達 —— 此時還不知道前綴，先不要建樹。 */
  rootPending: boolean
  /** 於當前 change 的來源工作目錄開一個 session。 */
  onOpenSessionHere: (worktreeKey: string) => void
  /** 請 agent 續寫下一個 artifact。 */
  onContinue: () => void
  /** OpenSpec → Files 的跨身分導航。 */
  onOpenFile: (relPath: string) => void
  /** Files → OpenSpec 的跨身分導航。 */
  onViewInOpenSpec: (target: OpenSpecTarget) => void
  /** 由跨身分導航送來的請求，各自交給對應的身分。 */
  fileRequest: FileRequest | null
  openSpecRequest: OpenSpecRequest | null
  /** Graph or Timeline shown in the maximized side panel (`null` = the OpenSpec identity's own view). */
  viz: VizKind | null
  onChooseViz: (kind: VizKind) => void
  onLeaveViz: () => void
}

/**
 * Files 身分的樹根解析 —— 工作目錄識別碼 → folder-relative 前綴。
 *
 * **解析在這裡而不在 `FilesPanel` 裡**，因為它需要一次非同步的清單，而樹根同時是 `FilesPanel`
 * 的 key：在裡面解析的話，樹會先以 folder 根建起來，清單抵達後再整棵換掉（而 key 沒變，
 * `useFileTree` 的初始狀態也不會重設）。
 *
 * **查表不承擔安全**（`side-panel-worktree`）：它只決定樹根前綴，邊界仍由主行程對每一次
 * `fs.*` 呼叫夾制 —— 即使這裡解析出一個離譜的前綴，可達的位置集合也一點都不會變大。它擔保的
 * 是**誠實性**：查無此識別碼（worktree 已被移除）就退回 folder 自身，而不是假裝仍在那裡。
 *
 * 邊界外的工作目錄 `relPath` 為 `null`，同樣退回 folder 自身 —— 它的檔案不在這個 folder 的
 * 檔案樹中，選擇器也已將它停用。
 */
function FilesPanelForFolder({
  folder,
  request,
  onViewInOpenSpec,
  worktreeKey,
  onSelectWorktree,
  worktrees,
  rootPrefix,
  rootPending,
}: {
  folder: WorkspaceFolder
  request: FileRequest | null
  onViewInOpenSpec: ((target: OpenSpecTarget) => void) | null
  worktreeKey?: string
  onSelectWorktree: (worktreeKey: string | undefined) => void
  worktrees: WorktreeOption[]
  rootPrefix: RootPrefix
  rootPending: boolean
}): React.JSX.Element {
  if (rootPending) {
    return (
      <section
        aria-label={t('files.label')}
        className="flex h-full items-center justify-center px-6 text-sm text-ink-faint"
      >
        {t('common.loading')}
      </section>
    )
  }

  return (
    // key：換來源**或換工作目錄**都等於換一棵樹，讓它重新掛載，展開狀態與開啟的檔案自然歸零
    <FilesPanel
      key={`${folder.id}\u0000${rootPrefix}`}
      folder={folder}
      request={request}
      onViewInOpenSpec={onViewInOpenSpec}
      rootPrefix={rootPrefix}
      worktrees={worktrees}
      worktreeKey={worktreeKey}
      onSelectWorktree={onSelectWorktree}
    />
  )
}

/**
 * 頂部一條來源指示器（OpenSpec 與 Files 兩身分共用），底下一次只顯示一個身分。
 *
 * 內容以 `folder.id` 為 key —— 換側欄來源等於換一棵樹／換一組 change，讓內容重新掛載；但來源列
 * 本身不掛 key，跨來源常駐（它就是切換來源的地方）。
 */
export function SidePanel({
  identity,
  folder,
  folders,
  sourceOwnerId,
  itemSelected,
  onSelectSource,
  anchoredChange,
  onAnchor,
  continuationBlock,
  sessionWorktreeKey,
  panelWorktreeKey,
  onSelectWorktree,
  worktrees,
  rootPrefix,
  rootPending,
  onContinue,
  onOpenSessionHere,
  onOpenFile,
  onViewInOpenSpec,
  fileRequest,
  openSpecRequest,
  viz,
  onChooseViz,
  onLeaveViz,
}: SidePanelProps): React.JSX.Element {
  const { t } = useTranslation()

  // 連 rail 項目都沒選 —— 不顯示來源列，直接走既有的空狀態（沒有東西可以設定來源）。
  if (!itemSelected) {
    if (identity === 'files') {
      return <FilesPanel key="none" folder={null} request={fileRequest} onViewInOpenSpec={null} />
    }
    return (
      <section
        aria-label={t('panelSwitch.openSpec')}
        className="flex h-full items-center justify-center px-6 text-center text-sm text-ink-faint"
      >
        {t('stage.noRepoHint')}
      </section>
    )
  }

  /*
    選中了項目、但**來源尚未選定**（全域項目的預設狀態）。兩個身分各自呈現可行動的空狀態並
    指向上方的來源列 —— 而**來源列照常呈現**，那是這個狀態唯一的出口。
  */
  const content = !folder ? (
    <section
      aria-label={identity === 'files' ? t('files.label') : t('panelSwitch.openSpec')}
      className="flex h-full flex-col items-center justify-center gap-1 px-6 text-center text-sm text-ink-faint"
    >
      <span>{identity === 'files' ? t('files.noSource') : t('openspec.noSource')}</span>
      <span className="text-xs">{t('panelSource.pickHint')}</span>
    </section>
  ) : identity === 'files' ? (
      <FilesPanelForFolder
        folder={folder}
        request={fileRequest}
        onViewInOpenSpec={folder.hasOpenSpec ? onViewInOpenSpec : null}
        worktreeKey={panelWorktreeKey}
        onSelectWorktree={onSelectWorktree}
        worktrees={worktrees}
        rootPrefix={rootPrefix}
        rootPending={rootPending}
      />
    ) : (
      <OpenSpecPanel
        key={folder.id}
        folder={folder}
        anchoredChange={anchoredChange}
        onAnchor={onAnchor}
        continuationBlock={continuationBlock}
        sessionWorktreeKey={sessionWorktreeKey}
        onContinue={onContinue}
        onOpenSessionHere={onOpenSessionHere}
        onOpenFile={onOpenFile}
        request={openSpecRequest}
        viz={viz}
        onChooseViz={onChooseViz}
        onLeaveViz={onLeaveViz}
      />
    )

  return (
    <div className="flex h-full flex-col">
      <PanelSourceBar
        folders={folders}
        current={folder}
        ownerId={sourceOwnerId}
        onSelect={onSelectSource}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  )
}
