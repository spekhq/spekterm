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
 * **只在虛擬螢幕上**要傳的旗標 —— 補的是「虛擬螢幕沒有 GPU」。
 *
 * **少了它，整條 GPU 路徑會靜默地不被驗到**：虛擬螢幕沒有 GPU → webgl context 取不到 →
 * app **正確地**降級為 DOM renderer → GPU 相關斷言全紅。那個紅是環境造成的，不是產品。
 * 而為此把那些斷言刪掉或放寬，等於把 `terminal-gpu-renderer` 的交付從驗收中移除。
 *
 * 旗標讓 webgl **路徑**走得到（addon 載入、資源建立與釋放），但畫素是 CPU 畫的。
 */
const GPU_ARGS = ['--enable-unsafe-swiftshader', '--use-angle=swiftshader']

/**
 * **一律要傳**的旗標 —— 補的是「視窗不可見時不要節流」。
 *
 * ## 為什麼它不受 `useVirtualDisplay()` 約束
 *
 * 上面那組補的是「虛擬螢幕沒有 GPU」，所以綁在虛擬螢幕上是對的。**這一組補的是別的東西**：
 * renderer 一旦被判定為不可見就會被背景節流，而那與螢幕是虛擬還是實體無關 ——
 * `PROBE_DISPLAY=physical` 是給人親眼看的逃生口，人一旦切到別的視窗，同一個失效方向就回來了。
 *
 * ## 少了它會怎樣（實測，不是推論）
 *
 * 被測 renderer 進入背景節流時：**`requestAnimationFrame` 完全停擺**、計時器被節流到 1 秒。
 * 而 Monaco 的 view 更新、xterm 的渲染與 fit、選單的呈現**全部走 rAF** —— 於是每一個「等畫面
 * 變成某個樣子」的等待都等滿窗口，而紅燈指向的是與根因無關的地方（issue #21 / #19 / #17）。
 *
 * 症狀的簽章：**CDP 往返很快（5ms／次）而等待照樣落空** —— 連線正常，只是畫面不更新。
 *
 * ## `hidden` 的成因**未確立**，所以兩條路徑都要停用
 *
 * 觀測到的只有 `visibilityState === 'hidden'` 且 `hasFocus() === true`；虛擬螢幕上沒有視窗
 * 管理器、只有一個視窗，**沒有東西可以遮住它**，所以「遮蔽」是推論。兩個旗標各自涵蓋一條
 * 可能的路徑（遮蔽觸發的背景化、不可見觸發的降權）。**問題不是「哪一個承重」，是「有沒有
 * 一個有效」** —— 而那由多輪觀測建立，不由單輪的成敗差異建立。
 *
 * ## 作用域限制
 *
 * 探針因此**不覆蓋背景節流下的行為**。那不是損失（沒有任何 requirement 描述它，而真實環境中
 * 「視窗被遮住時停止渲染」本來就是正確的），但它是一個**覆蓋缺口** —— 任何要關心它的
 * requirement 必須自備載體，不得以本專案探針全綠為據。見
 * `openspec/specs/probe-execution-scope/spec.md`。
 */
const NO_BACKGROUNDING_ARGS = [
  '--disable-backgrounding-occluded-windows',
  '--disable-renderer-backgrounding',
]

/**
 * 要傳給 Electron 的額外旗標。
 *
 * **刻意只有這一個匯出入口**：九支探針各自呼叫它，拆成兩個匯出的函式就會有人只呼叫其中一個
 * ——而少傳哪一組的症狀都是靜默的（GPU 路徑驗不到、或整片等待落空）。
 */
export function electronExtraArgs() {
  return [...NO_BACKGROUNDING_ARGS, ...(useVirtualDisplay() ? GPU_ARGS : [])]
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
