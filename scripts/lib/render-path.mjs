import { copy } from './copy.mjs'

/**
 * 判定「一個終端當下走哪一條渲染路徑」的共用序言。
 *
 * **抽成共用模組是刻意的。** 這段判準有兩個消費者（`probe-terminal` 的渲染資源生命週期、
 * `probe-agent-view` 的「另一種呈現覆蓋其上」），而它承載的是一條寫在 `terminal-sessions`
 * 裡的**規格層判準**：
 *
 * > 一個終端是否持有該渲染資源，SHALL 依據**它當下實際使用的渲染路徑**判定 —— 程式化繪製
 * > 路徑與倚賴 glyph 的路徑各自有專屬於該終端、且隨路徑切換而建立與移除的產物。
 *
 * 兩份字面值會在某一次改動之後靜默漂移，而漂移的徵狀是「其中一支探針開始說謊」。
 *
 * **注意**：`strayCanvasesIn` 只供 detail 使用，**不得**進入任何判準 —— 共用暫存畫布會在終端
 * 之間遷移，把它當成「該終端持有資源」的證據會在兩個方向上都錯（該 requirement 明文）。
 */
export const RENDER_PATH_PRELUDE = `
  const hostsOf = () => [...document.querySelectorAll('section[aria-label="${copy('stage.terminal')}"] > div')]
  const renderPathOf = (host) => {
    const link = !!host.querySelector('canvas.xterm-link-layer')
    const rows = !!host.querySelector('.xterm-rows')
    if (link && !rows) return 'programmatic'
    if (rows && !link) return 'glyph'
    return 'unknown(link=' + link + ',rows=' + rows + ')'
  }
  /** 共用暫存畫布的所在 —— 只用於 detail，**不得**進入任何判準。 */
  const strayCanvasesIn = (host) =>
    [...host.querySelectorAll('canvas')].filter((c) => !c.classList.contains('xterm-link-layer')).length
`
