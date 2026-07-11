import { useCallback, useEffect, useRef, useState } from 'react'

/** 小於這個位移就當作點擊，不算拖曳 —— 否則每次點分頁都會被誤判成一次排序。 */
const DRAG_THRESHOLD_PX = 4

export interface DragState {
  /** 正在被拖的項目在該群組內的序位。 */
  fromIndex: number
  /** 此刻放開的話，會插入到哪個序位。 */
  toIndex: number
}

interface DragReorder {
  /** 掛在每個可拖曳項目的 `onMouseDown` 上。 */
  onMouseDown: (index: number, event: React.MouseEvent) => void
  /** 拖曳中的狀態；未拖曳時為 `null`。 */
  drag: DragState | null
  /** 這個序位此刻是否為插入點（供畫指示線）。 */
  isDropTarget: (index: number) => boolean
  /** 是否正在拖曳（供切換游標樣式）。 */
  dragging: boolean
}

/**
 * 以**滑鼠事件**實作的拖曳排序，不用 HTML5 drag-and-drop。
 *
 * HTML5 DnD 在 CDP 下要走 `Input.setInterceptDrags` + `dispatchDragEvent` 那一套，與探針既有
 * 的 `dragMouse`（真滑鼠序列）格格不入。用滑鼠事件自己做，驗收就能送真拖曳（design D3）。
 *
 * listener 掛在 `window` 上 —— 拖曳中滑鼠會離開元素本身，掛在元素上會半途斷掉。
 *
 * @param count 群組內的項目數
 * @param axis 分頁列是水平的，rail 的子列是垂直的
 * @param rectOf 取得第 n 個項目的 DOMRect（呼叫端才知道自己的 DOM）。**必須是穩定的 callback。**
 * @param onCommit 放開時提交（僅在序位真的改變時呼叫）。**必須是穩定的 callback。**
 */
export function useDragReorder(
  count: number,
  axis: 'horizontal' | 'vertical',
  rectOf: (index: number) => DOMRect | null,
  onCommit: (fromIndex: number, toIndex: number) => void,
): DragReorder {
  const [drag, setDrag] = useState<DragState | null>(null)
  const origin = useRef<{ x: number; y: number; fromIndex: number } | null>(null)
  const started = useRef(false)
  /**
   * 拖曳狀態的第二份，存在 ref 裡。
   *
   * **提交不能寫在 `setDrag` 的 updater 裡。** state updater 必須是純函式，而 StrictMode
   * （只在 dev 生效）會刻意 double-invoke 它來揪出不純的 updater —— 把 `onCommit` 寫在裡面，
   * 排序就會被套用**兩次**（交換兩次＝回到原位，看起來像「拖曳完全沒反應」）。實測：dev 模式
   * 拖曳失效、build 模式正常，正是 StrictMode 抓到了這個違規。
   */
  const dragRef = useRef<DragState | null>(null)

  const onMouseDown = useCallback((index: number, event: React.MouseEvent) => {
    if (event.button !== 0) return
    origin.current = { x: event.clientX, y: event.clientY, fromIndex: index }
    started.current = false
  }, [])

  // **listener 一律掛著，不由 state 驅動掛載。**
  //
  // 若改成「mousedown 時 setPressed(true) → effect 掛 listener」，那麼 mousedown 與 listener
  // 真正掛上之間就隔了一整個 React 渲染週期 —— 落在那個窗口裡的 mousemove 會**直接丟失**。
  // 實測：dev 模式因此拖曳完全失效，build 模式僥倖趕上（探針一邊過一邊不過才抓到）。
  // 與「先訂閱、再列目錄」同源：**訂閱要早於會產生事件的那個動作。**
  //
  // 代價是 window 上常駐兩個 listener（分頁列與 rail 各一），但 handler 第一行就以 ref
  // 判斷是否在拖曳，未拖曳時是一次比較就返回。
  useEffect(() => {
    /** 滑鼠落在哪一個序位上。以各項目的中線判定插入點。 */
    const indexAt = (x: number, y: number): number => {
      for (let index = 0; index < count; index++) {
        const rect = rectOf(index)
        if (!rect) continue
        const middle =
          axis === 'horizontal' ? rect.left + rect.width / 2 : rect.top + rect.height / 2
        const position = axis === 'horizontal' ? x : y
        if (position < middle) return index
      }
      return Math.max(0, count - 1)
    }

    const onMove = (event: MouseEvent): void => {
      const from = origin.current
      if (!from) return

      const moved = Math.hypot(event.clientX - from.x, event.clientY - from.y)
      if (!started.current && moved < DRAG_THRESHOLD_PX) return
      started.current = true

      const next = { fromIndex: from.fromIndex, toIndex: indexAt(event.clientX, event.clientY) }
      dragRef.current = next
      setDrag(next)
    }

    const onUp = (): void => {
      const from = origin.current
      if (!from) return
      origin.current = null

      const current = dragRef.current
      dragRef.current = null
      const dragged = started.current
      started.current = false
      setDrag(null)

      // 沒有真的移動 —— 這是一次點擊，交給元素自己的 onClick 處理，順序不動。
      if (!dragged || !current) return

      // **提交在 updater 之外**：updater 必須是純函式（見 dragRef 的註解）。
      if (current.fromIndex !== current.toIndex) {
        onCommit(current.fromIndex, current.toIndex)
      }
    }

    window.addEventListener('mousemove', onMove)
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [count, axis, rectOf, onCommit])

  // 拖曳期間整份文件都用 grabbing 游標、且禁止選取。
  //
  // 兩者都必須是**全域**的：滑鼠會離開被拖的元素、掃過旁邊的東西 —— 只在元素自己身上設，
  // 游標會在半途變回箭頭，而滑過的文字會被反白選起來（實測體感很差）。
  useEffect(() => {
    if (!drag) return

    const body = document.body
    const previousCursor = body.style.cursor
    const previousSelect = body.style.userSelect
    body.style.cursor = 'grabbing'
    body.style.userSelect = 'none'

    return () => {
      body.style.cursor = previousCursor
      body.style.userSelect = previousSelect
    }
  }, [drag])

  const isDropTarget = useCallback(
    (index: number) => drag !== null && drag.toIndex === index && drag.fromIndex !== index,
    [drag],
  )

  return { onMouseDown, drag, isDropTarget, dragging: drag !== null }
}
