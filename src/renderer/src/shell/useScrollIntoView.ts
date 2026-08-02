import { useCallback, useEffect, useMemo, useRef } from 'react'

/**
 * 選取或焦點改變時把目標捲進可視範圍 —— **但使用者以指標直接操作這個容器時不捲**。
 *
 * `block: 'nearest'` 只保證「**完全**可見就不捲」：部分可見的元素它照樣會捲最小的量。於是
 * rail 已捲動時點下緣那半截的列，那一列會在游標底下跳走 —— 使用者下一次點擊（例如緊鄰的
 * 展開鈕）得重新瞄準。**看不到目標是一種故障，目標在游標底下跳走是另一種**，這個例外要的是
 * 後者。
 *
 * ## 判定是「最後一次輸入來自哪裡」，不是「消費一次旗標」
 *
 * 直覺的寫法是「mousedown 設旗標、effect 讀完即清」。**它會靜默吃掉一次鍵盤導航**：一次
 * 沒有造成任何狀態改變的點擊（點已經選中的那一列、點捲軸、點空白處）不會觸發 effect，旗標
 * 於是留到下一次 —— 而下一次可能是 `Ctrl+↓`，使用者會看到「第一次沒捲、第二次才捲」。
 * 這裡改為記錄**最後一次輸入的來源**：任何一顆按鍵都會把它翻回鍵盤，旗標不會過夜。
 *
 * ## 作用域是單一容器，不是整個 renderer
 *
 * 全域的「最後一次輸入」會壞掉一個真實的路徑：在 rail 點一列 session 之後，**分頁列仍應**
 * 把對應的分頁捲進視野 —— 使用者操作的是另一個容器，那個分頁他還沒看到。因此每個會自行
 * 捲動的容器各持有一份，`guard` 掛在誰身上，例外就只對誰成立。
 */
export function useScrollIntoView(): {
  /**
   * 掛在容器的根節點上。**捕捉階段** —— 子節點自己 `stopPropagation()` 也擋不掉它
   * （session 子列與分頁都有自己的按鈕與右鍵選單）。
   *
   * **用 `mousedown` 而不是 `pointerdown`**：與 `useDragReorder` 一致（這個 repo 為了「探針
   * 送得進真事件」刻意選了滑鼠事件而非 HTML5 拖放），於是這個例外驗得到 —— CDP 的
   * `Input.dispatchMouseEvent` 一定產生 `mousedown`。
   */
  guard: { onMouseDownCapture: () => void }
  /** 目標為 `null`／`undefined` 時為無操作 —— 呼叫端不必各自防一次。 */
  scrollIntoView: (target: Element | null | undefined, options: ScrollIntoViewOptions) => void
} {
  const byPointer = useRef(false)

  useEffect(() => {
    const onKeyDown = (): void => {
      byPointer.current = false
    }
    // 捕捉階段：`KeyboardNavigation` 攔下導航鍵時呼叫的是 `stopPropagation()`，它擋不住
    // **同一個節點**上的其他 listener（那要 `stopImmediatePropagation`），所以這裡收得到。
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [])

  const guard = useMemo(
    () => ({
      onMouseDownCapture: (): void => {
        byPointer.current = true
      },
    }),
    [],
  )

  const scrollIntoView = useCallback(
    (target: Element | null | undefined, options: ScrollIntoViewOptions): void => {
      if (byPointer.current) return
      target?.scrollIntoView(options)
    },
    [],
  )

  /**
   * **回傳值必須是穩定的**。呼叫端把它放進 effect 的依賴陣列（`scrollIntoView` 是 effect 用到
   * 的外部值，少了它 lint 會叫），而一個每次渲染都重建的物件會讓那個 effect **每渲染一次就跑
   * 一次** —— 於是任何無關的重繪都可能把一個半可見的目標捲進視野，正好違反「目標已完整可見時
   * SHALL NOT 捲動」旁邊那條「只在選取或焦點改變時捲」。
   */
  return useMemo(() => ({ guard, scrollIntoView }), [guard, scrollIntoView])
}
