import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { WorktreeOption } from '../types'
import { ContextMenu, type MenuItem } from './dialogs'

/** detached HEAD 時顯示的短 sha 長度 —— 與 `repo-branch` 的 rail 呈現一致（git 的慣例）。 */
const SHORT_HEAD_LENGTH = 7

/**
 * 一個工作目錄在介面上的標籤。
 *
 * 分支優先；detached HEAD（`branch === null`）退回短 HEAD —— 少了這個 fallback，那些工作目錄
 * 在選擇器上會是一個**空標籤**，使用者無從分辨它們。兩者皆無只發生在 folder 不位於版控之下，
 * 而那時清單只有一筆、選擇器根本不呈現。
 */
export function worktreeLabel(option: WorktreeOption, fallback: string): string {
  if (option.branch) return option.branch
  if (option.head) return option.head.slice(0, SHORT_HEAD_LENGTH)
  return fallback
}

interface WorktreePickerProps {
  worktrees: WorktreeOption[]
  /** 當前選定者的識別碼；`undefined` ＝ folder 自身。 */
  selectedKey: string | undefined
  /**
   * 有 focused session 才能改 —— 這個選擇是 per-session 的狀態，沒有 session 就沒地方存
   * （與側欄來源同一條理由）。**停用而非隱藏**：使用者要看得見自己在哪個工作目錄。
   */
  canSelect: boolean
  onSelect: (worktreeKey: string | undefined) => void
}

/**
 * Files 身分的樹根選擇器（`side-panel-worktree`）。
 *
 * 位於麵包屑的中段 —— 工作目錄在概念上正介於 repo 與檔案路徑之間，放在那裡它自己就說明了
 * 「路徑自這裡算起」。
 *
 * **呈現與否的判準是清單的筆數，不是可選取的筆數。** 一個項目全部停用的清單仍然在回答「這個
 * repo 還有哪些工作目錄」—— 噪音的定義是「沒有資訊」，不是「沒有可點的東西」。以可選取的筆數
 * 為判準，會把「有東西但你看不了」整個藏起來，與「呈現但停用」的用意自相矛盾。
 */
export function WorktreePicker({
  worktrees,
  selectedKey,
  canSelect,
  onSelect,
}: WorktreePickerProps): React.JSX.Element | null {
  const { t } = useTranslation()
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)

  if (worktrees.length <= 1) return null

  const fallback = t('files.worktree.unknown')

  // 「當前」以 `relPath === ''` 判定 folder 自身，**不是 `isMain`** —— folder 本身可能就是一個
  // linked worktree，此時該 repo 的主工作目錄對使用者而言是「別的地方」。`isMain` 僅用於呈現。
  const current =
    worktrees.find((option) => (selectedKey ? option.key === selectedKey : option.relPath === '')) ??
    worktrees[0]

  const items: MenuItem[] = worktrees.map((option) => {
    const browsable = option.relPath !== null
    return {
      key: option.key ?? '',
      label: worktreeLabel(option, fallback),
      // 邊界外的工作目錄沒有 folder-relative 路徑，檔案樹表達不了它（`worktree-aggregation`）。
      // 呈現它並說明原因，好過整筆省略 —— 後者會讓使用者以為應用程式沒看見那個 worktree，
      // 而 OpenSpec 身分明明看得見它的 change。
      hint: browsable ? undefined : t('files.worktree.outside'),
      disabled: !browsable,
      onSelect: () => onSelect(option.relPath === '' ? undefined : option.key),
    }
  })

  return (
    <>
      <button
        type="button"
        aria-label={t('files.worktree.change')}
        title={canSelect ? t('files.worktree.change') : t('files.worktree.needSession')}
        disabled={!canSelect}
        onClick={(event) => {
          event.stopPropagation()
          const rect = event.currentTarget.getBoundingClientRect()
          setMenu({ x: rect.left, y: rect.bottom })
        }}
        className={`min-w-0 max-w-[12rem] shrink truncate rounded px-1 text-ink-dim ${
          canSelect ? 'hover:text-accent' : 'cursor-default'
        }`}
      >
        {worktreeLabel(current, fallback)} ▾
      </button>
      {menu && <ContextMenu x={menu.x} y={menu.y} items={items} onClose={() => setMenu(null)} />}
    </>
  )
}
