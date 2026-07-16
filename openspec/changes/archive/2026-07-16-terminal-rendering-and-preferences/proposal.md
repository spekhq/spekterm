## Why

第五次 dogfooding 抓到三個都出在 terminal 的毛病：(1) 在 claude session 裡按滑鼠**右鍵**會同時
「貼上剪貼簿內容」又「彈出我們的選單」，兩件事一起發生令人困惑；(2) claude 輸出的**表格**在滑鼠上下
捲動 scrollback 時**破版**，框線與內容會錯位；(3) 終端的**字型不對** —— 看起來不像使用者的終端字型，
且部分 emoji 與表格框線斷字。

**問題 3（字型）**：終端的 fontFamily 首選一個**這台機器不存在、本專案也沒打包**的 `JetBrains Mono`，
於是靜默落到系統預設等寬字 —— 字型從此與宣告不符。

**問題 2（表格）**：DOM renderer 下框線靠**字型的 glyph** 拼接，而 glyph 僅約 1em 高、row 高卻是
`fontSize × lineHeight` —— 行高 1.3 讓上下列的 `│` 接不起來、中間留縫。捲動時的錯位則另有成因（DOM
renderer 的重繪），需要 GPU renderer 才治得了 —— **那部分延後**（見 What Changes 與 design D2）。

**問題 1（右鍵）**：右鍵被 xterm 轉發進 pty —— claude 開了 mouse reporting，收到右鍵後自己去讀系統
剪貼簿貼上，而我們的 `onContextMenu` 只擋瀏覽器預設選單，擋不住那次轉發。

同時，字型不該再寫死一個特定字型 —— 這個 app 之後要打包給一般使用者，字型該**預設吃系統字型**（開箱
就正常），並讓使用者**自己改設定**。這需要一塊目前完全不存在的偏好落盤基礎（現況只有 workspace 與
session 兩個 store，preload 沒有 settings namespace，Settings 活動列入口是停用的 placeholder）。

## What Changes

- **右鍵行為看終端有沒有開 mouse reporting**：xterm 公開 `term.modes.mouseTrackingMode`
  （`none`／`x10`／`vt200`／`drag`／`any`），可判斷 pty 內的程式當下有沒有接管滑鼠。**mouse reporting
  開啟時**（claude 的常態）右鍵照常轉發給 claude，由它依自己的慣例貼上，我們**不彈選單**；**mouse
  reporting 關閉時**（純 shell）xterm 本就不轉發右鍵，我們**照常開複製／貼上選單**。原生選單一律
  preventDefault 擋掉。原則：**程式接管滑鼠時讓位給它（使 claude 的右鍵貼上等慣例生效），沒接管時才用
  我們的選單**。
- **中鍵一律由終端擁有，恰好貼一次**（dogfood 修正）：初版把中鍵也 gate 在 mouse mode，實測**兩種
  session 都貼兩次** —— 兇手是 Chromium **原生**的中鍵貼上（X11 PRIMARY）一直在發生，疊上我們自己的貼上
  就是兩次。改以 **capture 階段**接管中鍵（`preventDefault` 掉 mousedown／mouseup／auxclick 的原生行為 +
  `stopPropagation` 不轉發給程式），只貼一次，與 mouse reporting 無關。
- **行高 1.3 → 1.0（且可設定）**：DOM renderer 下框線靠**字型的 glyph** 拼接，而 glyph 僅約 1em 高、row
  高卻是 `fontSize × lineHeight` —— 行高大於 1 時上下列的 `│` 接不起來、中間留縫，這是「表格破版」的主因
  之一（dogfood 實測：1.3 → 1.0 後「好不少」）。
- **GPU renderer 延後到下一個 change**（**表格因此在本 change 不算修好，只是改善**）：完整調查見
  design D2 —— canvas addon 對 xterm 6 已死、唯一可用的 webgl 會使 `.xterm-rows` 消失而**廢掉
  `probe:terminal` 的 14 個觀測點**（實測 8 條斷言倒）。觀測策略是跨整個 suite 的架構問題，值得自己一個
  change，不塞在這裡倉促決定。
- **終端字型預設吃系統字型**：移除幻影 `JetBrains Mono` 首選，未設定偏好時採系統等寬字，開箱即與一般
  終端一致。
- **終端字型可由使用者設定並落盤**：新增偏好（字型 family、size 與行高），持久化於 `preferences.json`
  （版本 + 原子寫 + 損毀隔離，比照 workspace／session store），重啟後套用；未設定時 family 用系統字型、
  size 用既有字級尺度推導的預設值、行高用預設。
- **點亮 Settings 入口**：把活動列停用的 Settings placeholder 接上一個最小的偏好設定介面 —— 字型 family
  以**下拉選單**自系統的等寬字型清單挑選（dogfood：硬打字型名太難用），加上 size、行高與**即時預覽**。
  不建通用設定框架，有需要之後再長。

## Capabilities

### New Capabilities
- `terminal-preferences`: 終端外觀偏好（字型 family、size 與行高）可由使用者設定、落盤、重啟後套用；
  未設定時 family 採系統字型、size 採字級尺度的預設值、行高採預設；偏好設定檔損毀不得阻止應用程式啟動；
  提供編輯這些偏好的介面（點亮 Settings 入口，含系統等寬字型的下拉選單與即時預覽）。

### Modified Capabilities
- `terminal-sessions`: 修改「終端支援複製與貼上」—— 右鍵 gate 在 mouse reporting（程式接管滑鼠時右鍵交給它，使 claude 的右鍵貼上生效；未接管時開複製／貼上選單）；中鍵一律由終端擁有且**恰好貼一次**（擋掉瀏覽器原生中鍵貼上與轉發）。
- `typography-scale`: 修改「terminal 的字級納入同一組尺度」—— 尺度提供終端字級的**預設**，使用者偏好
  可覆蓋它（覆蓋值走 JS 設定 `xterm.fontSize`，不經 CSS token，不觸及寫死字級守衛）。
- `workspace-layout`: 活動列的 **Settings 入口不再是停用的 placeholder**，而是開啟終端偏好設定介面
  （「尚未實作的入口為停用狀態」此後只涵蓋 Handoffs 與 Search）。

## Impact

- **主行程**：新增 `preferences-store.ts`（`preferences.json`）與 `ipc/settings.ts`；`preload` 白名單新增
  `settings.*` namespace，連帶補上 `probe:shell` 的白名單守衛（CLAUDE.md 記過 `folders.*` 曾整個漏掉守衛）。
- **renderer**：`xterm.ts` 的 fontFamily／fontSize／行高改由偏好供應（未設定時退系統字型、字級尺度與預設
  行高），並新增查詢 mouse tracking 狀態的方法（讀 `term.modes.mouseTrackingMode`）；`TerminalView.tsx` 依
  該狀態決定右鍵開選單與否，並以 capture 階段的 listener 接管中鍵；新增終端偏好的設定介面元件（下拉 +
  預覽）與 `ActivityBar` 的 Settings 入口啟用。文案一律進 `en.json` 字典（`ui-localization` 既有守衛）。
- **驗收**：`probe:terminal`（右鍵行為隨 mouse reporting 狀態 —— stub 送 `\x1b[?1000h` 開 mouse mode 時
  右鍵不彈選單、不送時彈選單；字型偏好套用與落盤還原）、`probe:shell`（settings 白名單守衛）、
  `probe:workspace` 或新入口的驗收（Settings 入口啟用、偏好持久化）。**中鍵「只貼一次」驗不到** ——
  雙貼的兇手是 Chromium 的原生行為，而 CDP 的合成滑鼠事件不觸發它；由 code review + design D10 承擔
  （比照 OSC 8 linkHandler 的先例）。
- **PRD**：終端字型的「系統預設 + 可設定」是新的產品決策，§8.3 或相關章節回寫。
