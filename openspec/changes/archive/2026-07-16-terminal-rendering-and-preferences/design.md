## Context

第五次 dogfooding 抓到三個都出在 terminal 的毛病（見 proposal）。它們的技術根因與現況：

- **右鍵**：`TerminalView` 的 `onContextMenu` 無條件開我們的選單，`onMouseDown` 只在 button 1（中鍵）
  貼上。右鍵（button 2）走不到 paste，但 claude 開了 mouse reporting，xterm 把右鍵 mousedown 轉發進
  pty，claude 自己讀系統剪貼簿貼上 —— 於是「貼上」與「我們的選單」同時發生。
- **表格破版**：目前沒有載入任何 renderer addon → xterm 用 **DOM renderer**，box-drawing 完全靠字型的
  glyph。字寬對不齊 cell grid，捲動時 DOM renderer 重排 row 就露出漂移。
- **字型**：`xterm.ts` 的 fontFamily 首選 `'JetBrains Mono'`（本機未裝、專案未打包）→ 落到系統預設
  等寬字。而使用者的終端字型是別的（實測本機裝了 MesloLGS NF），兩者不同。

約束：
- **xterm 只由 `src/renderer/src/shell/terminal/xterm.ts` 這個 wrapper 觸碰**（既有紀律，`workspace-app-shell`
  的「編輯器透過 wrapper 介面存取」同源）—— renderer 其他模組不 import `@xterm/*`。
- **所有 session 的終端同時掛載**（`sessions.all()`，以 `display:none` 決定顯示，terminal 的 design D7）
  —— 這對 renderer 的選型是決定性的（見 D2）。
- **偏好落盤基礎目前是零** —— 只有 `workspace-store` 與 `session-store`，preload 無 `settings` namespace，
  ActivityBar 的 Settings 是停用 placeholder。
- 驗收走 CDP probe 與 `npm test`，不塞測試分支、不掛 `data-*`；文案一律進 `en.json`。

## Goals / Non-Goals

**Goals:**
- 右鍵行為隨終端 mouse reporting 狀態：程式接管滑鼠時讓位給它（claude 右鍵貼上生效），未接管時開我們的選單。
- 表格 / box-drawing / 寬字元的字格對齊不依賴字型 glyph，捲動時維持。
- 終端字型預設吃系統字型（開箱正常），且 family + size 可由使用者設定、落盤、重啟後套用。
- 點亮 Settings 入口，交付一個最小的終端字型設定介面。

**Non-Goals:**
- 不建通用設定框架（本輪只有終端字型）。
- 不做字型**選擇器**（列舉系統字型）—— free-text 輸入（見 D9）。
- 不做 per-session 字型（字型是全終端一致的偏好）。
- 不做主題／配色自訂、不動 `lineHeight` 等其他終端選項。
- 不做跨視窗偏好同步（單視窗 app）。
- 不承諾「預設就與使用者的 GNOME Terminal 一致」—— 預設只保證是**真實存在的系統等寬字**，與使用者
  終端一致由使用者**設定偏好**達成（見 D3）。

## Decisions

### D1：右鍵 gate 在 `mouseTrackingMode`；中鍵一律由終端擁有

xterm v6 公開 `term.modes.mouseTrackingMode`（public readonly，`'none' | 'x10' | 'vt200' | 'drag' | 'any'`）。
`!== 'none'` 即代表 pty 內的程式當下開了 mouse reporting、正在接管滑鼠。wrapper 新增
`mouseTrackingActive(): boolean`（讀它）—— xterm 的存取留在 wrapper 內。

**右鍵 —— gate 在 mouse mode：**

- `onContextMenu`：**一律 `preventDefault()`**（擋原生選單），**僅在 `!mouseTrackingActive()` 時 `setMenu`**。
  程式接管滑鼠時右鍵照常由 xterm 轉發給它（claude 依自己的慣例貼上），我們不彈選單。
- **狀態在事件當下讀取**，不快取 —— claude 會隨畫面進出動態開關 mouse mode，右鍵行為必須跟著當下狀態。

**中鍵 —— 一律由終端擁有，只貼一次（dogfood 修正）：**

中鍵貼上是**終端的**慣例，不是 pty 內程式的慣例。初版把中鍵也 gate 在 mouse mode（「程式接管就讓位」），
**dogfood 抓到那是錯的**：login shell（mouse off）與 claude（mouse on）中鍵**都貼兩次** —— 兇手是
**Chromium 的 native 中鍵貼上（X11 PRIMARY selection）一直在發生**（`terminal-clipboard` 的 design D5 當年
假設「瀏覽器拿不到 PRIMARY、native 不會貼」，實測在 Electron 裡不成立），加上我們自己的貼上就是兩次。而
初版走 React 的 `onMouseDown`（bubble 階段）擋不掉它：其一 bubble 晚於 xterm 掛在 `.xterm-screen`（host
子節點）上的 listener（xterm 已把中鍵轉發給 claude）；其二 native 貼上掛在 `auxclick` 而非 mousedown，
mousedown 的 `preventDefault` 打不到它。

**修法**：在 host 上以 **capture 階段**的原生 listener 完全接管中鍵 —— 對 button 1 的
`mousedown`／`mouseup`／`auxclick` 一律 `preventDefault`（擋掉 native 貼上，不論它掛在哪個事件）+
`stopPropagation`（xterm 收不到、不會轉發給 claude），並在 `mousedown` 時做**唯一一次**我們的貼上。
於是中鍵恆為一次乾淨的 CLIPBOARD 貼上，**與 mouse reporting 開不開無關**。

**替代方案**：(a) 一律 capture 攔右鍵、純選單（proposal 初稿）—— 使用者否決，要 claude 的右鍵貼上。
(b) 中鍵也 gate 在 mouse mode（初版）—— native 貼上使它雙貼，否決。(c) 中鍵改讓 native 那次當唯一一次
（移除我們的貼上，貼 PRIMARY）—— 可行但改變 D5 的 CLIPBOARD 語意，且相依「native 恆發生」，未採。

**代價**：mouse mode 開啟時使用者拿不到我們的複製選單；複製改用選取 + `Ctrl+Shift+C`（選取在 mouse mode
下需 `Shift+拖曳`，這是終端通例）。「`Shift+右鍵`強制叫出我們的選單」列為 Open Question。

### D2：GPU renderer **延後到下一個 change**；本 change 以 `lineHeight` 處理表格的靜態縫

原訂以程式化繪製 box-drawing 的 renderer 修「表格破版」。**實作與 dogfood 之後，這條延後** —— 但整個
調查的結論留在這裡，下一個 change 直接接手，不必重踩：

**(1) `@xterm/addon-canvas` 對 xterm 6 是死的。** latest 0.7.0、peer `^5.0.0`、最後發佈 2023-11，而我們的
xterm 是 6.0.0；`@xterm/addon-webgl` 反而與我們其他 addon 同代、維護中（0.19.0）。canvas 是 xterm.js 官方
已 deprecated、改推 webgl 的那一個。**GPU renderer 的唯一可用選項是 webgl。**

**(2) webgl 每個終端一個 context，而瀏覽器對並存 context 有上限（約 16）。** 這個 app **同時掛載每個
session 的終端**（terminal 的 design D7），全掛會撞上限（最舊的 context 被丟棄、畫面變空）。可行解是
**只載給當下 active（看得見）的那一個終端**（切走即 `dispose()`，xterm 自動退回 DOM）—— 同時只有 1 個
context，且「需要框線正確的地方」正好就是「看得見的那個」。此法已實作並經 dogfood 驗證有效。

**(3) 但 webgl 會廢掉 `probe:terminal` 的觀測點 —— 這才是延後的真正原因。** webgl 畫到 `<canvas>`，
**`.xterm-rows` 隨即消失**，而 probe 讀終端內容的唯一方式正是它（`TERMINAL_TEXT` / `TERMINAL_FONT`，
共 14 個呼叫點）。實測：開 webgl 後 8 條斷言倒（輸入到 pty、cwd、貼上、resize 讀成 `0 → 0`、切回 session
內容仍在、字級讀成 `undefined`）—— **終端本身沒壞，是驗收瞎了**。

**(4) 兩條候選解（留給下一個 change 裁決）：**
- **改寫觀測點**：把「讀畫面文字」換成「讀檔」（`echo X > file` → 讀檔）—— 更強，因為它能**區分回顯與
  執行**（CLAUDE.md 早有這條教訓，而讀畫面文字本來就分不清）。但 **「切回 session 後 scrollback 仍在」
  找不到可靠的觀測點**（快照檔有 2s debounce，證明不了「切換後還在」）；候選是走產品自己的複製路徑
  （拖曳選取 + `Ctrl+Shift+C` → 讀剪貼簿），未驗證。
- **把「GPU 加速」做成使用者偏好**（VS Code 有 `terminal.integrated.gpuAcceleration` 的先例，且驅動有
  問題的使用者真的需要這個逃生口）：probe 以 `settings` IPC 關掉它再測 behavior（那是產品公開功能，不是
  測試分支），另加一條「預設下 active 終端確實是 webgl」。**論點**：那批 behavior 斷言（pty I/O、cwd、
  cols、buffer 存活）本來就與 renderer 無關 —— renderer 不碰 pty，cell 量測走 `CharSizeService`（DOM，
  非 renderer）—— 且 DOM renderer 是產品真實支援的降級路徑，測它不是測虛構的東西。

**(5) 本 change 實際交付的表格改善：`lineHeight` 1.3 → 1.0（且可設定）。** DOM renderer 下框線靠**字型的
glyph** 去拼，glyph 只有約 1em 高而 row 高是 `fontSize × lineHeight` —— 行高大於 1 時上下列的 `│` 接不
起來，中間留縫。**這是「表格破版」的主因之一**（dogfood 實測：1.3 → 1.0 之後「好不少」）。這不是完整
修復（捲動時仍可能破 —— 那是 DOM renderer 的重繪問題，要靠 GPU renderer），但它是這個 change 對該痛點
的真實貢獻，且行高現在是使用者可調的偏好。

> **本 change 因此不宣稱修好表格。** `terminal-sessions` 原擬的「字格渲染獨立於字型的 glyph 幾何」
> requirement **已移除** —— 沒交付的東西不寫進 spec。

### D3：預設字型 = 誠實的系統等寬字鏈

移除幻影 `'JetBrains Mono'` 與 macOS 專屬的 `'SF Mono', Menlo`。預設 fontFamily 收斂為 `ui-monospace,
monospace` —— `ui-monospace` 在 macOS 解析為 SF Mono，在 Linux 落到 `monospace`（系統預設等寬字）。

**這不會讓預設「看起來像使用者的 GNOME Terminal」** —— 系統預設等寬字（DejaVu）與使用者終端字型
（MesloLGS NF）本就不同。預設的職責只是「是一個**真實存在**的等寬字，開箱不破」；與使用者終端一致由
**偏好設定**達成（D4）。emoji 由瀏覽器逐字符 fallback 到系統 emoji 字型（本機有 Noto Color Emoji），
canvas renderer 的 `fillText` 會以彩色繪製；box-drawing 由 canvas 程式化繪製，與字型無關。

### D4：字型解析在 wrapper，偏好覆蓋預設，即時套用並 refit

wrapper 持有 `fontOverride = { family: string | null; size: number | null }`（初始皆 null＝用預設）：

- `resolveFamily()` = `override.family ?? DEFAULT_FAMILY_CHAIN`
- `resolveSize()` = `override.size ?? terminalFontSize()`（`terminalFontSize()` 讀字級尺度 token，
  見既有的離屏求值技巧）—— **未設偏好時仍跟隨字級尺度**（dev 的 HMR 轉旋鈕即時反映的行為保留）。
- `fit()` 的字級來源由 `terminalFontSize()` 改為 `resolveSize()`（其餘不變）。
- 新增 `setFont({ family, size }): void`：更新 override，套用 `term.options.fontFamily = resolveFamily()`、
  `term.options.fontSize = resolveSize()`。

字型 size 改變會改 cell 尺寸 → cols/rows 改變 → 必須通知 pty。因此**偏好變更由 `TerminalView` 驅動**：
`usePreferences()` 供應當前偏好，effect 在偏好變動時 `handle.setFont(...)` 後 `handle.fit()`，`fit()` 回
非 null 就 `terminal.resize(...)`（沿用既有 resize 路徑）。**每個 `TerminalView` 各自套用**（所有終端都掛載）。

**typography-scale 的契約因此修改**：終端字級的**預設**來自尺度，偏好可覆蓋它。覆蓋值走 JS 設定
`xterm.fontSize`（數字），不經 CSS，**不觸及「不得寫死字級」的 CSS 守衛**（那道守衛只掃 CSS／Tailwind
arbitrary 值）。size 偏好夾制於合理範圍（如 8–32），family 為長度受限、無控制字元的字串（D5 驗證）。

### D5：`preferences-store`（主行程），比照 workspace/session store

新增 `src/main/preferences-store.ts` → userData 下的 `preferences.json`：

```
{ version: 1, terminal: { fontFamily?: string, fontSize?: number } }
```

完全比照 `workspace-store` 的四件事：**version 欄位**、**`parsePreferences` 任何不信任即回 `null`**
（型別不符、version 不符、fontSize 非有限數或超出範圍、fontFamily 非字串或過長）、**`load()` 永不拋**
（讀檔失敗或 parse 失敗 → quarantine 損毀檔 + 以空偏好啟動）、**原子寫**（temp + rename）。
未設定的欄位一律省略（不占欄位）；空偏好＝全用預設。

### D6：`settings.*` IPC + preload 白名單 + probe:shell 守衛

- `src/main/ipc/settings.ts`：`settings.get()` 回傳當前偏好；`settings.setTerminalFont(family, size)`
  驗證後持久化並回傳更新後的偏好（`family`/`size` 傳 `null`／空＝清為預設）。
- preload：`window.workspace` 新增 `settings` namespace（白名單）。
- **`probe:shell` 的白名單守衛新增 `settings.*`** —— 且要確認守衛**真的列舉了這個 namespace**
  （CLAUDE.md 記過 `folders.*` 曾整個漏掉守衛而不被擋）。

### D7：Settings 介面＝modal dialog（`role="dialog"`），點亮 ActivityBar 入口

Settings 入口 `enabled: true` 並接上 onClick，開啟一個 **modal dialog**（比照 `SessionNameDialog` /
files 的 dialogs）。內容：字型 family（free-text）、字型 size（number），以及「回到預設」（清空）。

**替代方案**：整頁 settings view 取代主舞台 —— 需要 activity-bar 的 view 切換基礎建設（目前 app 只有
sessions 一個 view），為了一個字型設定不值得，否決。

選 dialog 還有一個承重的附帶好處：**`[role="dialog"]` 一存在，導航快捷鍵就自動被抑制**（`keyboard-navigation`
的「以角色存在判定」）—— 不必去某份清單註冊。連帶：`keyboard-navigation` 的「對話框開啟時導航快捷鍵不
生效」多一個受測載體。mockup 對 settings 沉默，這塊算新設計。

### D8：`PreferencesProvider`（renderer context），早載入以免字型閃動

renderer 新增 `PreferencesProvider`：掛載時 `settings.get()` 載入偏好，供應當前值與 `updateTerminalFont`
（persist via IPC + 更新本地 state）。**放在終端掛載之上**（`SessionsProvider` 之上或同層）以盡量在終端
掛載前備妥偏好 —— 偏好是非同步 IPC，若晚到，終端先以預設字型起、偏好到達再 `setFont` + refit（一次短暫
閃動，可接受）。設定 dialog 與所有 `TerminalView` 都消費這個 context。

### D9：字型 family 用**下拉選單**（列舉系統等寬字）+ live preview（dogfood 修正）

初版用 free-text 輸入（「列舉字型都有代價」）。**dogfood 否決**：要使用者硬記完整字型名太難用，而且純輸入
框「換字型前要先把文字清空」很煩。改為：

- **主行程列舉系統的等寬字**：`fc-list :spacing=100 family`（`:spacing=100` 正是 fontconfig 的 monospace
  判準，直接拿到等寬字，不必在 renderer 自己量測）。這是使用者開設定的**一次性**動作，不是熱路徑，spawn
  一次 `fc-list` 可接受（與「分支偵測不 spawn git」的熱路徑紀律不同）。**目前只支援 Linux**，其他平台回空
  陣列 → 只剩「系統預設」可選（跨平台字型列舉列為 Phase 6）。
- **UI 是純 `<select>` 下拉**（不是可打字的 combobox）—— dogfood 明確要「直接按下拉挑」。第一個選項是
  「System default」（空值＝清回系統字型）。目前選定但不在列舉清單裡的 family（例如在別台機器設的）補進
  選項，避免 `<select>` 把它弄丟。
- **live preview**：用當下選的 family／size 即時 DOM 渲染一段文字範例。**刻意不放 box-drawing** —— 真正
  的終端框線由 webgl 程式化繪製（與字型無關），DOM preview 沒有 webgl，放框線會顯得歪掉而誤導；preview
  專注在字型對「文字」的呈現。

**替代方案**：free-text（初版）—— 難用，否決。`queryLocalFonts()`（Local Font Access API）—— 需權限提示
且限 secure context，Electron 下較不確定；`fc-list` 直接、可靠，且 `:spacing=100` 免去自己判斷 monospace。
可打字的 combobox（datalist）—— dogfood 嫌它「要先清空才能換」，否決。

### D10：驗收策略（分面，誠實標示驗不到的部分）

- **右鍵（可驗）**：stub 送 `\x1b[?1000h` 開 mouse mode → 斷言右鍵**不**出現我們的選單 DOM；不送 →
  斷言右鍵**出現**選單。
- **中鍵「只貼一次」（驗不到，code review 承擔）**：雙貼的兇手是 Chromium 的 **native** 中鍵貼上，而
  CDP 的合成滑鼠事件**不觸發**那個 native 行為（比照 OSC 8 linkHandler：注入式事件驅動不了真實瀏覽器
  行為）—— 於是探針既看不到雙貼、也證明不了「只剩一次」。這條由 capture 攔截的實作 + code review + 本
  design 承擔（dogfood 已實測修正）。
- **webgl renderer 已啟用（代理判準）**：webgl renderer 會在 active 終端內附上 `<canvas>`；斷言其存在＝
  renderer 生效（DOM renderer 無 canvas）。headless 取不到 context 時退為「不崩潰、退回 DOM」。**像素級
  對齊驗不到** → 由 code review + 本 design 承擔（比照 OSC 8 linkHandler 的先例）。
- **字型 size（可驗）**：改 size 偏好 → cell 尺寸變 → 同寬容器的 cols 改變或量得到的 cell 尺寸改變，以此
  為「size 已套用」的可觀察代理。
- **字型 family（部分驗不到）**：webgl／canvas renderer 下 family 只進 canvas 繪製、DOM 上不可觀察 →
  以**落盤還原**（設定 → 重啟 → `settings.get()` 讀回一致）+ code review 承擔。
- **字型列舉（可驗）**：`settings.listMonospaceFonts()` 於 Linux 回非空陣列且皆為字串（設定對話框的下拉
  來源）。
- **偏好持久化（可驗）**：設定 → `Page.reload` / 重啟 → 讀回一致；損毀韌性（餵損毀 `preferences.json`
  仍以預設啟動）。
- **settings 白名單（可驗）**：`probe:shell` 斷言 `settings.*` 只暴露白名單方法。

## Risks / Trade-offs

- **[webgl context 取不到（headless／軟體渲染）或執行中 context loss]** → `enableGpuRenderer` catch 建立
  失敗、`onContextLoss` dispose 退回 DOM renderer（至少不比現況差）；只給 active 終端使並存 context 恆為
  1，避開瀏覽器上限。
- **[mouse mode 開啟時使用者失去我們的複製選單]** → 複製走 `Ctrl+Shift+C` + `Shift+拖曳`（終端通例）；
  `Shift+右鍵`強制選單列為 Open Question。
- **[中鍵在 mouse mode 下改為交給程式，習慣 Linux 中鍵貼上者會感到差異]** → 與右鍵同一條原則（程式接管
  就讓位），一致性優先；mouse mode 關閉時中鍵貼上照舊。
- **[偏好非同步載入 → 終端字型短暫閃動]** → `PreferencesProvider` 早載入；閃動一次、無資料遺失。
- **[free-text 字型名可能被輸入奇怪內容]** → 主行程驗證（長度、無控制字元）；落回預設鏈無害；這是使用者
  在自己機器上的設定，威脅面低。
- **[typography-scale 守衛]** → 偏好走 JS `xterm.fontSize`，不碰 CSS token，守衛不受影響（已確認守衛只掃
  CSS／Tailwind arbitrary 值）。
- **[probe:shell 守衛漏掉 settings.*]** → 明確列舉並加對照組（folders.* 的教訓）。

## Migration Plan

- 新增相依 `@xterm/addon-webgl`。
- 無資料遷移：`preferences.json` 於首次設定時建立；不存在＝全用預設。舊版程式不讀它，向後相容。
- Rollback：移除本 change 即可，殘留的 `preferences.json` 被舊碼忽略，無副作用。
- Phase 6 打包前確認：macOS 的 `ui-monospace`（SF Mono）與 canvas renderer 在打包後的行為（本 repo 無
  macOS 實測，比照既有 Phase 6 待確認項）。

## Open Questions

- **`Shift+右鍵`是否強制叫出我們的選單**（mouse mode 開啟時的逃生口，終端通例）？v1 先不做。
- **字型選擇器**（`queryLocalFonts` 或 `fc-list` 列舉）—— v1 用 free-text，日後可加。
- 設定 dialog 的視覺與擺位（mockup 沉默）—— design 提議 modal，實作時對齊既有 dialog 樣式。
