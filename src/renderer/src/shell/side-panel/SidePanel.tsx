import { FilesPanel } from '../files/FilesPanel'
import { OpenSpecPanel } from '../openspec/OpenSpecPanel'
import type { VizKind } from '../openspec/VizOverlay'
import type { FileRequest, OpenSpecRequest, OpenSpecTarget } from '../openspec/nav'
import type { PanelIdentity, WorkspaceFolder } from '../types'

interface SidePanelProps {
  identity: PanelIdentity
  folder: WorkspaceFolder | null
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

/** 一次只顯示一個身分。 */
export function SidePanel({
  identity,
  folder,
  anchoredChange,
  onAnchor,
  onOpenFile,
  onViewInOpenSpec,
  fileRequest,
  openSpecRequest,
  onOpenViz,
}: SidePanelProps): React.JSX.Element {
  if (identity === 'files') {
    // key：換 folder 等於換一棵樹，讓它重新掛載，展開狀態與開啟的檔案自然歸零
    return (
      <FilesPanel
        key={folder?.id ?? 'none'}
        folder={folder}
        request={fileRequest}
        onViewInOpenSpec={folder?.hasOpenSpec ? onViewInOpenSpec : null}
      />
    )
  }

  if (!folder) {
    return (
      <section
        aria-label="OpenSpec"
        className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint"
      >
        尚未選擇 repo —— 於左側的 workspace 選一個，或加入新的 folder
      </section>
    )
  }

  return (
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
}
