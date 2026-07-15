import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { WorkspaceFolder } from '../types'

interface PanelSourceBarProps {
  /** workspace 的所有 folder —— 下拉的候選。 */
  folders: WorkspaceFolder[]
  /** 當前的側欄來源（panelFolder）。 */
  current: WorkspaceFolder
  /** focused session 自己所屬的 folder id（「回到自身 repo」的目標）。無 session 時為 null。 */
  ownerId: string | null
  /** 有 focused session 才能改側欄來源 —— 它是 per-session 的狀態，無 session 無處可存。 */
  canSelect: boolean
  onSelect: (folderId: string) => void
}

/**
 * side panel 頂部的來源指示器：標示側欄呈現哪個 repo，並讓使用者改指到另一個。
 *
 * OpenSpec 與 Files 兩個身分共用它（掛在 `SidePanel` 的殼上，切身分不重新掛載）。下拉沿用既有的
 * `ContextMenu`（鍵盤可全操作是這個 repo 的紀律）。它取代了 proposal 一度設想的「跟隨/釘住」
 * toggle —— session 所屬的 folder 不隨 pty 的 cwd 浮動，「跟隨」退化為「釘在自身 folder」，一個
 * toggle 無事可做（`side-panel-source` D1）。「回到自身 repo」的一鍵捷徑補上它唯一有用的部分。
 */
export function PanelSourceBar({
  folders,
  current,
  ownerId,
  canSelect,
  onSelect,
}: PanelSourceBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 側欄來源 ≠ session 自身的 folder ＝ 使用者刻意指向了別的 repo。視覺上與預設態區分，並提供
  // 一鍵回到自身（ownerId 為 null＝沒有 session，此時來源恆為 focusedFolder，無「非自身」可言）。
  const isForeign = ownerId !== null && current.id !== ownerId

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom })
  }

  const items: MenuItem[] = folders.map((folder) => ({
    label: folder.name,
    onSelect: () => onSelect(folder.id),
  }))

  return (
    <div className="flex items-center gap-1 border-b border-hairline px-2 py-1">
      <button
        type="button"
        onClick={canSelect ? openMenu : undefined}
        disabled={!canSelect}
        aria-label={t('panelSource.change')}
        title={isForeign ? t('panelSource.foreign', { name: current.name }) : current.path}
        className={`flex min-w-0 items-center gap-1 rounded px-2 py-0.5 text-sm ${
          isForeign ? 'text-accent' : 'text-ink-dim'
        } ${canSelect ? 'hover:text-accent' : 'cursor-default'}`}
      >
        <span className="shrink-0 text-ink-faint">▸</span>
        <span className="truncate">{current.name}</span>
        {canSelect && <span className="shrink-0 text-ink-faint">▾</span>}
      </button>

      {isForeign && canSelect && (
        <button
          type="button"
          onClick={() => onSelect(ownerId)}
          aria-label={t('panelSource.backToOwn')}
          title={t('panelSource.backToOwn')}
          className="shrink-0 rounded px-1.5 text-sm text-ink-dim hover:text-accent"
        >
          ↩
        </button>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
