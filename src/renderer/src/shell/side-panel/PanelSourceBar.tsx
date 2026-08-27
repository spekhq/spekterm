import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { WorkspaceFolder } from '../types'

interface PanelSourceBarProps {
  /** workspace 的所有 folder —— 下拉的候選。 */
  folders: WorkspaceFolder[]
  /** 當前的側欄來源（panelFolder）。`null` ＝ **尚未選定**（全域項目的預設狀態）。 */
  current: WorkspaceFolder | null
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
  /**
   * **`null` ＝ 選中的 rail 項目沒有自身 repo**（全域項目）。此時不呈現「回到自身 repo」——
   * 它沒有可回去的目的地，而 `workspace-layout` 明文要求不呈現不可操作的控制項。
   */
  ownerId: string | null
  /** `null` ＝ 清除來源（回到未選定）。 */
  onSelect: (folderId: string | null) => void
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
  //
  // **全域項目沒有「自身」**：`ownerId` 為 null 時，任何已選定的來源都不算「foreign」——
  // 那個詞的意思是「不是你自己的那個」，而它根本沒有自己的。
  const isForeign = ownerId !== null && current !== null && current.id !== ownerId

  const openMenu = (event: React.MouseEvent<HTMLButtonElement>): void => {
    const rect = event.currentTarget.getBoundingClientRect()
    setMenu({ x: rect.left, y: rect.bottom })
  }

  /**
   * 候選**依名稱排序，不沿用 rail 的順序**。
   *
   * 兩份順序服務兩件不同的事：rail 的順序由使用者拖曳而來，表達的是「哪些常用、放在上面」；
   * 這份下拉是**查找**用的清單，使用者心裡已經有一個名字。以 rail 的順序呈現，等於要求他在
   * 二十幾個 repo 中線性掃描一份只有他自己知道規則的排列（dogfood 回饋）。
   *
   * 排的是 `map` 產生的新陣列 —— `folders` 是 rail 的清單，就地排序會連帶改到 rail。
   */
  const items: MenuItem[] = folders
    .map((folder) => ({
      label: folder.name,
      onSelect: () => onSelect(folder.id),
    }))
    .sort((a, b) => a.label.localeCompare(b.label, undefined, { sensitivity: 'base' }))

  /**
   * 「回到這個項目的預設座標」——**一顆按鈕，兩種項目各自的預設不同**。
   *
   * - 有自身 repo 的項目：預設是指回自身 ⇒ 回到自身 repo。
   * - 沒有自身 repo 的（全域項目）：預設是**未選定** ⇒ 清除來源。
   *
   * 兩者是同一個動作的兩種面貌，因此共用同一個位置與樣式。**清除曾經只是下拉裡的一個項目，
   * 而那太不明顯**（dogfood 回饋）—— 它與「回到自身」語意相同，卻一個是按鈕、一個藏在選單裡。
   */
  const resetTarget = ownerId !== null ? 'own' : current !== null ? 'clear' : null

  return (
    <div className="flex items-center gap-1 border-b border-hairline px-2 py-1">
      <button
        type="button"
        onClick={openMenu}
        aria-label={t('panelSource.change')}
        title={
          current === null
            ? t('panelSource.none')
            : isForeign
              ? t('panelSource.foreign', { name: current.name })
              : current.path
        }
        className={`flex min-w-0 items-center gap-1 rounded px-2 py-0.5 text-sm hover:text-accent ${
          isForeign ? 'text-accent' : 'text-ink-dim'
        }`}
      >
        <span className="shrink-0 text-ink-faint">▸</span>
        <span className={`truncate ${current === null ? 'text-ink-faint italic' : ''}`}>
          {current === null ? t('panelSource.none') : current.name}
        </span>
        <span className="shrink-0 text-ink-faint">▾</span>
      </button>

      {resetTarget === 'own' && isForeign && (
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

      {resetTarget === 'clear' && (
        <button
          type="button"
          onClick={() => onSelect(null)}
          aria-label={t('panelSource.clear')}
          title={t('panelSource.clear')}
          className="shrink-0 rounded px-1.5 text-sm text-ink-dim hover:text-accent"
        >
          {/*
            **與「回到自身 repo」同一個圖示，不是另一個。**

            它們是同一個動作的兩種面貌（回到這個 rail 項目的預設座標），只有目的地不同 ——
            用兩個不同的圖示等於在說它們是兩件事，使用者的心智模型會分岔。差異寫在
            `aria-label` 與 tooltip 裡，那才是描述目的地的地方。
          */}
          ↩
        </button>
      )}

      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </div>
  )
}
