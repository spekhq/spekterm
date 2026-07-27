import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { WorkspaceFolder } from '../types'

interface PanelSourceBarProps {
  /** workspace 的所有 folder —— 下拉的候選。 */
  folders: WorkspaceFolder[]
  /** 當前的側欄來源（panelFolder）。 */
  current: WorkspaceFolder
  /**
   * rail 上選中的 folder id —— 「回到自身 repo」的目標，也是「自身」的**定義**。
   *
   * 此前它的值同樣是 focused folder，但論證是「focused session 所屬的 folder」—— 兩者相等是
   * 一個巧合（session 一律經 `forFolder(focusedFolder.id)` 取得）。座標改基為 per-folder 之後，
   * rail 上選中的 folder **就是**座標的鍵，於是它從「碰巧等於」變成了定義本身。
   *
   * 不可為 null：`current`（panelFolder）非 null ⟺ focused folder 非 null，而本元件只在前者
   * 非 null 時被渲染。
   */
  ownerId: string
  onSelect: (folderId: string) => void
}

/**
 * side panel 頂部的來源指示器：標示側欄呈現哪個 repo，並讓使用者改指到另一個。
 *
 * OpenSpec 與 Files 兩個身分共用它（掛在 `SidePanel` 的殼上，切身分不重新掛載）。下拉沿用既有的
 * `ContextMenu`（鍵盤可全操作是這個 repo 的紀律）。它取代了 proposal 一度設想的「跟隨/釘住」
 * toggle —— session 所屬的 folder 不隨 pty 的 cwd 浮動，「跟隨」退化為「釘在自身 folder」，一個
 * toggle 無事可做（`side-panel-source` D1）。「回到自身 repo」的一鍵捷徑補上它唯一有用的部分。
 *
 * **它不因「該 folder 尚無 session」而停用。** 側欄座標隸屬於 rail 的項目而非 session，而側欄
 * 是一個閱讀工具 —— 要求使用者先開一個 terminal 才能選要讀哪個 repo，是把兩件無關的事綁在一起
 * （那正是 `panel-coordinate-per-folder` 要修的痛點）。
 */
export function PanelSourceBar({
  folders,
  current,
  ownerId,
  onSelect,
}: PanelSourceBarProps): React.JSX.Element {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  // 側欄來源 ≠ rail 上選中的 folder ＝ 使用者刻意指向了別的 repo。視覺上與預設態區分，並提供
  // 一鍵回到自身。
  const isForeign = current.id !== ownerId

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
        onClick={openMenu}
        aria-label={t('panelSource.change')}
        title={isForeign ? t('panelSource.foreign', { name: current.name }) : current.path}
        className={`flex min-w-0 items-center gap-1 rounded px-2 py-0.5 text-sm hover:text-accent ${
          isForeign ? 'text-accent' : 'text-ink-dim'
        }`}
      >
        <span className="shrink-0 text-ink-faint">▸</span>
        <span className="truncate">{current.name}</span>
        <span className="shrink-0 text-ink-faint">▾</span>
      </button>

      {isForeign && (
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
