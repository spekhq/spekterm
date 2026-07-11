import { useCallback, useState } from 'react'
import { ContextMenu, type MenuItem } from '../files/dialogs'
import type { SpawnTarget } from '../types'

interface SpawnMenu {
  /** 掛在建立入口的 onClick 上。自該按鈕的左下角展開。 */
  open: (event: React.MouseEvent<HTMLElement>) => void
  /** 渲染在觸發按鈕附近即可 —— ContextMenu 以 fixed 定位，不受容器影響。 */
  menu: React.ReactNode
}

/**
 * 「建立 session」的 spawn 目標選單，分頁列與 rail 共用。
 *
 * 底層是既有的 `ContextMenu`，它已經處理過兩個坑：**延一個 tick 才掛 dismiss listener**
 * （否則開啟它的那次 click 冒泡到 window，會把它自己關掉），以及**把位置夾進 viewport**。
 *
 * 每個呼叫端持有自己的選單狀態 —— rail 與分頁列可能同時存在，共用一份 state 會讓「在 rail
 * 開了選單、錨點卻是分頁列的按鈕」這種錯位變得可能。
 */
export function useSpawnMenu(onSelect: (target: SpawnTarget) => void): SpawnMenu {
  const [at, setAt] = useState<{ x: number; y: number } | null>(null)

  const open = useCallback((event: React.MouseEvent<HTMLElement>) => {
    // rail 的建立入口位在 folder 列之內；不擋下冒泡的話，開選單會順手改變選中的 repo。
    event.stopPropagation()
    const rect = event.currentTarget.getBoundingClientRect()
    setAt({ x: rect.left, y: rect.bottom + 4 })
  }, [])

  const close = useCallback(() => setAt(null), [])

  const items: MenuItem[] = [
    {
      label: '跑 claude',
      onSelect: () => {
        close()
        onSelect('claude')
      },
    },
    {
      label: '進 login shell',
      onSelect: () => {
        close()
        onSelect('shell')
      },
    },
  ]

  return {
    open,
    menu: at && <ContextMenu x={at.x} y={at.y} items={items} onClose={close} />,
  }
}
