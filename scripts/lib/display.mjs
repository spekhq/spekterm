/**
 * 探針的螢幕來源：**預設虛擬螢幕**，可退回實體螢幕。
 *
 * ## 為什麼預設是虛擬螢幕
 *
 * 探針要開真視窗、送真滑鼠事件（那是本 repo 的紀律：驗的正是被出貨的那份程式碼，不在產品裡塞
 * 測試分支）。代價是一輪 `test:e2e` 十幾分鐘期間**使用者無法操作自己的機器** —— 而那是一道會讓
 * 人繞過它的成本。實例：`panel-drive-and-shell-affordances` 沒跑 `probe:shell`（「沒改到那塊」），
 * 於是白名單守衛帶著兩條紅燈被封存。
 *
 * `DISPLAY` 是行程層的環境變數，而 CDP 的 `Input.dispatchMouseEvent` 是注入 Chromium 的輸入
 * 管線、**與 X server 無關** —— 於是換一個螢幕對探針而言是透明的。
 *
 * ## 逃生口：`PROBE_DISPLAY=physical`
 *
 * 虛擬螢幕上沒有 GPU，取得的是**軟體 GL**（見下）。它證明得了渲染資源的生命週期（取得、釋放、
 * 退回），**證明不了畫素** —— 框線相不相接、粗細一不一致，只有真實的圖形驅動看得出來
 * （`terminal-sessions` 已把這條限制寫進規格）。需要親眼看它跑的時候也走這條。
 */
import { spawnSync } from 'node:child_process'

/** 固定寫死，**不跟隨實體螢幕** —— 探針的行為不該隨執行機器而變。 */
const SCREEN = '-screen 0 1600x1200x24'

export function useVirtualDisplay() {
  return (process.env.PROBE_DISPLAY ?? 'virtual') !== 'physical'
}

/**
 * 虛擬螢幕上要傳給 Electron 的額外旗標。
 *
 * **少了它，整條 GPU 路徑會靜默地不被驗到**：虛擬螢幕沒有 GPU → webgl context 取不到 →
 * app **正確地**降級為 DOM renderer → GPU 相關斷言全紅。那個紅是環境造成的，不是產品。
 * 而為此把那些斷言刪掉或放寬，等於把 `terminal-gpu-renderer` 的交付從驗收中移除。
 *
 * 旗標讓 webgl **路徑**走得到（addon 載入、資源建立與釋放），但畫素是 CPU 畫的。
 */
export function electronExtraArgs() {
  return useVirtualDisplay() ? ['--enable-unsafe-swiftshader', '--use-angle=swiftshader'] : []
}

/**
 * 把一條命令包進虛擬螢幕。實體螢幕模式下原樣回傳。
 *
 * **`xvfb-run` 不存在時明確失敗，不靜默退回實體螢幕** —— 靜默退回會讓「為什麼我的螢幕被佔用了」
 * 變成一個無從查起的問題。
 */
export function withDisplay(command, args) {
  if (!useVirtualDisplay()) return [command, args]

  if (spawnSync('sh', ['-c', 'command -v xvfb-run']).status !== 0) {
    throw new Error(
      '找不到 xvfb-run —— 探針預設在虛擬螢幕上執行。\n' +
        '  安裝：sudo apt install xvfb\n' +
        '  或以實體螢幕執行（會佔用你的螢幕）：PROBE_DISPLAY=physical <指令>',
    )
  }
  return ['xvfb-run', ['-a', '-s', SCREEN, command, ...args]]
}
