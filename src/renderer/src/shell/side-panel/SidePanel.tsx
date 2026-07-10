import { FilesPanel } from '../files/FilesPanel'
import type { PanelIdentity, WorkspaceFolder } from '../types'

interface SidePanelProps {
  identity: PanelIdentity
  folder: WorkspaceFolder | null
}

/**
 * 一次只顯示一個身分。OpenSpec 的內容屬 Phase 5（`IpcAdapter` + 既有的 spek 視圖），
 * 此處只有佔位 —— 也正因為它還沒有內容，Phase 2 的預設身分是 Files，與雛型相反。
 */
export function SidePanel({ identity, folder }: SidePanelProps): React.JSX.Element {
  if (identity === 'files') {
    // key：換 folder 等於換一棵樹，讓它重新掛載，展開狀態與開啟的檔案自然歸零
    return <FilesPanel key={folder?.id ?? 'none'} folder={folder} />
  }

  return (
    <section
      aria-label="OpenSpec"
      className="flex h-full items-center justify-center px-6 text-center text-xs text-ink-faint"
    >
      OpenSpec 側欄（Phase 5）
    </section>
  )
}
