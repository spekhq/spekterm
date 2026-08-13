## Why

兩處驗收缺口，**失效方向都是假綠**——規格說了、實作做了、探針全綠，而那些綠燈與該行為在不在
**完全無關**。

- **終端銷毀路徑的渲染資源釋放**（issue #26）：把 `xterm.ts` 的 `dispose()` 裡那行
  `releaseWebglContext()` 拿掉，`PROBE_ONLY=runMode:build` 仍是 **74/74 全綠**（實測，不是推論）。
  現有兩條斷言取樣在「切換」與「關閉隱藏的那一個」，兩者都錯開了這條路徑。
- **零 folder 的 workspace**（issue #11）：**五條**以「workspace 沒有任何 folder」為前提的 scenario
  沒有載體。一個「rail 為空就不渲染任何東西」的實作照樣通過現有的「全域項目是 rail 的第一個項目」
  ——那條跑在種了三個 folder 的 fixture 上，它**區分不了「恆常呈現」與「有 folder 時才呈現」**。

  **精確一點**：`probe:shell` 確實以零 folder 啟動（`probe-shell.mjs:192` 建空 profile，全支
  無任何 `writeFileSync`，因此沒有 `workspace.json`），但它只斷言 React 根元件掛載與三個版面區域
  存在。**其餘八支全部至少種一個 folder**（最少的是 `probe-keyboard.mjs` 的 `checkSingleFolder`，
  `seedProfile([only])`）。所以缺的不是「零 folder 啟動不可行」，而是**沒有人在那個狀態下斷言過
  這五條**。

**現在做**：#26 的實作剛封存（`2026-08-14-webgl-context-release`），對照組現成；#11 是
`global-session` 獨立稽核抓到的共同缺口，補的時候是**一次**零 folder 啟動、不是四次。

## What Changes

### 一、終端銷毀時歸還並存額度（#26）

`terminal-sessions` 現有的渲染資源要求只涵蓋「**由顯示轉為隱藏**時 SHALL 釋放之」——**銷毀路徑
不在其內**。實作已經做了（`dispose()` 呼叫 `releaseWebglContext()`），但**規格沒有要求它**，於是
也沒有任何 scenario 可以指認驗收。

- 規格補上銷毀路徑：終端銷毀時亦 SHALL 歸還額度，而非僅解除掛載。
- 探針補一條斷言：**不先切換、直接關閉當下顯示中的那個 session**，斷言其資源已失效。
  對照組即上面那個實驗（拿掉 `dispose()` 裡那行，該條必須變紅）。

### 二、以零 folder 啟動的驗收段落（#11）

新增一個 `seedProfile([])` 的探針段落，一次啟動承載四條既有 scenario 的驗收。

**issue #11 的對照表有兩處需要更正**（本次調查所得）：

| issue 的說法 | 實際 |
|---|---|
| `keyboard-navigation`：rail 只有全域項目時 **`Shift+↑↓`** 為無操作 | `Shift` 那條是「**選中**全域項目時為無操作」（`spec.md:313`），其 WHEN 未要求零 folder，且 **`probe-keyboard.mjs:1629` 已在驗它**。真正零覆蓋的是 `spec.md:112`「rail 只有全域項目時為無操作」，該顆鍵是 **`Ctrl+↓`** |
| 共三條 | **五條** —— 見下表。`status-bar` 與 `file-explorer` 各多一條 |

五條 scenario：

| capability | scenario | 位置 | 現況 |
|---|---|---|---|
| `global-session` | 尚無任何 folder 時仍呈現 | `spec.md:45` | 零覆蓋 |
| `keyboard-navigation` | rail 只有全域項目時為無操作（`Ctrl+↓`） | `spec.md:112` | 零覆蓋 |
| `status-bar` | workspace 為空且無任何 session 時 | `spec.md:218` | 現有斷言在 `probe-openspec.mjs:1395`，跑在**有 folder** 的 fixture 上 |
| `status-bar` | workspace 為空但有全域 session 時不呈現空狀態 | `spec.md:223` | 零覆蓋 |
| `file-explorer` | 沒有可用的側欄來源 | `spec.md:47` | 現有載體是「來源未選定時 Files 不呈現任何檔案列」，跑在**有 folder** 的 fixture 上——「來源未選定」與「沒有 folder 可選」是兩個狀態 |

**最後一條是本 change 推翻先前的判斷，不是新發現**：`archive/2026-08-02-global-session/verification.md:96`
當時把 `status-bar:218` 判給「既有的空狀態斷言承擔；本 change 未改變其行為」。那個判斷不成立
——既有斷言跑在有 folder 的 fixture 上。

`global-session` 另補一條**驗收紀律**要求：恆常性的驗收 SHALL 以零 folder 的 workspace 進行。
本 repo 已有三處同形狀的先例（`terminal-sessions` 兩條、`workspace-layout` 的「拖曳排序須用至少
三個項目」），理由相同——**下一個人改 fixture 時，得知道那次零 folder 的啟動不是可有可無的**。

### 不做

- **不改任何產品程式碼。** 兩處的實作都已正確，缺的是擋住未來回歸的網。
- **不做 issue #12**（稽核腳本對每條 scenario 要求驗收指認）。那是機制層的一般解，本 change 是
  兩個具體缺口的個別解；混做會讓兩者互相拖延。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `terminal-sessions`：渲染資源的釋放要求擴及**終端銷毀**路徑（現行條文只涵蓋顯示轉隱藏），
  並補上對應 scenario 與「僅解除掛載即失敗」的對照組條款。
- `global-session`：新增一條驗收紀律要求——「恆常呈現」類的性質，其驗收 SHALL 以**零 folder**
  的 workspace 進行，涵蓋 `keyboard-navigation`、`status-bar` 與 `file-explorer` 中以同一前提
  成立的條款。

`keyboard-navigation`、`status-bar` 與 `file-explorer` 的四條 scenario **已存在於主 spec，
不需要 delta** —— 本 change 對它們只補載體。

## Impact

- **探針**：`scripts/probe-terminal.mjs`（runMode 段補一條銷毀路徑斷言）、
  `scripts/probe-keyboard.mjs`（新增零 folder 段落；該支已有 `runSections` 與每段各自
  `makeFixture()` / `seedProfile()` / `launch()` 的結構，`checkSingleFolder` 即 `seedProfile([only])`
  的先例）。
- **規格**：`openspec/specs/terminal-sessions/spec.md`、`openspec/specs/global-session/spec.md`。
- **產品程式碼**：**零改動**。
- **驗收成本**：`probe:terminal` 與 `probe:keyboard` 各一輪；零 folder 段落多一次冷啟動。
- **GitHub issue**：本 change 完成後 #26 與 #11 可關閉。
