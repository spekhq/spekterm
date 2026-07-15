import { useTranslation } from 'react-i18next'
import { FilesPanel } from '../files/FilesPanel'
import { OpenSpecPanel } from '../openspec/OpenSpecPanel'
import type { VizKind } from '../openspec/VizOverlay'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from '../openspec/nav'
import type { PanelIdentity, WorkspaceFolder } from '../types'
import { PanelSourceBar } from './PanelSourceBar'

interface SidePanelProps {
  identity: PanelIdentity
  /** 側欄來源（panelFolder）—— side panel 呈現哪個 repo。可與 rail 的 focused folder 不同。 */
  folder: WorkspaceFolder | null
  /** workspace 的所有 folder —— 來源指示器的下拉清單。 */
  folders: WorkspaceFolder[]
  /** focused session 自己所屬的 folder id（「回到自身 repo」的目標）。無 session 時為 null。 */
  sourceOwnerId: string | null
  /** 有 focused session 才能改側欄來源。 */
  canSelectSource: boolean
  onSelectSource: (folderId: string) => void
  /** 當前 focused session 錨定的 change。 */
  anchoredChange: string | null
  onAnchor: (slug: string) => void
  /** OpenSpec → Files 的跨身分導航。 */
  onOpenFile: (relPath: string) => void
  /** Files → OpenSpec 的跨身分導航。 */
  onViewInOpenSpec: (target: OpenSpecTarget) => void
  /** 由跨身分導航送來的請求，各自交給對應的身分。 */
  fileRequest: FileRequest | null
  openSpecRequest: OpenSpecRequest | null
  /** 開啟全視窗 overlay 的 Graph／Timeline。 */
  onOpenViz: (kind: VizKind) => void
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
  canSelectSource,
  onSelectSource,
  anchoredChange,
  onAnchor,
  onOpenFile,
  onViewInOpenSpec,
  fileRequest,
  openSpecRequest,
  onOpenViz,
}: SidePanelProps): React.JSX.Element {
  const { t } = useTranslation()

  // 沒有側欄來源（沒選任何 repo）—— 不顯示來源列，直接走既有的空狀態。
  if (!folder) {
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

  const content =
    identity === 'files' ? (
      // key：換來源等於換一棵樹，讓它重新掛載，展開狀態與開啟的檔案自然歸零
      <FilesPanel
        key={folder.id}
        folder={folder}
        request={fileRequest}
        onViewInOpenSpec={folder.hasOpenSpec ? onViewInOpenSpec : null}
      />
    ) : (
      <OpenSpecPanel
        key={folder.id}
        folder={folder}
        anchoredChange={anchoredChange}
        onAnchor={onAnchor}
        onOpenFile={onOpenFile}
        request={openSpecRequest}
        onOpenViz={onOpenViz}
      />
    )

  return (
    <div className="flex h-full flex-col">
      <PanelSourceBar
        folders={folders}
        current={folder}
        ownerId={sourceOwnerId}
        canSelect={canSelectSource}
        onSelect={onSelectSource}
      />
      <div className="min-h-0 flex-1 overflow-hidden">{content}</div>
    </div>
  )
}
