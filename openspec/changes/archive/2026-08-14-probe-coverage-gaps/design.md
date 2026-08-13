## Context

兩個缺口都已用**對照組**確認為真（不是推論）：

- **#26**：把 `src/renderer/src/shell/terminal/xterm.ts` 的 `dispose()` 裡那行
  `releaseWebglContext()` 拿掉，`PROBE_ONLY=runMode:build` 仍是 74/74 全綠。
- **#11**：**八支**探針的 fixture 至少種一個 folder（最少的是 `probe-keyboard.mjs` 的
  `checkSingleFolder`，`seedProfile([only])`）。五條以「workspace 沒有任何 folder」為前提的
  scenario 沒有在那個狀態下被斷言過。

**零 folder 啟動的可行性不必猜，而證據比 issue 假設的強**：`probe:shell` **每一輪 `test:e2e`
都以零 folder 啟動** —— `probe-shell.mjs:192` 以 `mkdtempSync` 建一個空的暫存 profile，該支全支
沒有任何 `writeFileSync` / `mkdirSync`（實測 grep 為 0），因此沒有 `workspace.json`、folders 為空；
而它已經斷言了 React 根元件掛載與三個版面區域同時存在（`:233`）。`probe:package` 更進一步在該狀態
下點到了全域項目的建立入口（`probe-package.mjs:306-312`）。

**所以缺的從來不是「零 folder 啟動可不可行」，而是「沒有人在那個狀態下斷言過這五條」。**
`probe:shell` 只驗掛載與版面；`probe:package` 是「換版前跑一次完整打包」的成本層級，且不驗這幾條。

本 change 不改任何產品程式碼。

## Goals / Non-Goals

**Goals:**

- `terminal-sessions` 的渲染資源要求涵蓋**終端銷毀**路徑，並有一條會因 `dispose()` 少那行而變紅
  的斷言。
- 四條以「workspace 沒有任何 folder」為前提的 scenario 各有一條可指認的斷言，且**共用一次**
  零 folder 冷啟動。
- 新增的每一條斷言都先以對照組確認會變紅。

**Non-Goals:**

- **不改產品程式碼。** 兩處實作都已正確。
- **不做 issue #12**（稽核腳本對每條 scenario 要求驗收指認）。那是機制層的一般解。
- **不新增探針**。兩處都併入既有探針的既有結構。
- **不驗畫素。** 探針跑在虛擬螢幕、軟體 GL 上，能證明的是渲染資源的生命週期，不是呈現正確
  （`terminal-sessions` 既有條款）。

## Decisions

### D1：#26 的載體插在「自 rail 的 session 子列關閉 session」，不是 issue 建議的那兩個位置

issue 建議「在『已結束的 session 可手動關閉』或關閉**最後一個**分頁的位置補」。實際讀過 runMode
之後，更好的落點是 `probe-terminal.mjs:2180-2190` 那條：

| 條件 | 該處是否滿足 |
|---|---|
| 被關閉的是**當下顯示中**的終端 | **是** —— 前一條斷言剛驗過 `tabsAfterRailCreate[1]?.selected === true` |
| **沒有先切換** | **是** —— 建立後直接自 rail 關閉它 |
| pty 仍存活，終端確實在程式化繪製路徑上 | **是** |
| 零額外啟動成本 | **是** —— 只在既有的關閉動作前後各加一次 `evaluate` |

「已結束的 session 可手動關閉」（`:2211`）也符合前兩項，差別在它的 pty 已結束。**讀程式碼可以
定案：`TerminalView.tsx:279-281` 的 `setGpuRenderer(active && gpuEnabled)` 只看 `active` 與偏好、
不看 `status`，因此 exited 的終端只要仍顯示就仍持有渲染資源。** 也就是說那個落點**是可用的備案**，
不是死路——若 `:2181` 實作時遇到障礙，改用它不需要重新論證。

仍選 `:2181` 的理由是它更貼近規格描述的失效情境（「使用者不切換、直接關閉當下正在**用**的那個
session」），且該處的分頁狀態由前一條既有斷言剛剛驗證過，前提不必自己建立。

**替代方案（已否決）**：另起一個段落專門驗銷毀路徑 —— 多一次冷啟動，而現有位置的狀態恰好就是
規格要的。

**鑑別力自檢沿用既有模式**：`glBefore.some((alive) => alive === true)` 必須成立，否則該條沒有
鑑別力（既有兩條斷言的 detail 都明寫這句，新增這條照抄）。

**變數名另取，但理由不是「會弄壞既有斷言」**：`window.__probeGlShown`（`:2136`）那條斷言在
`:2152-2158` 就結束，判定式用的是**已經 await 回 probe 行程的 JS 值**（`glShownBeforeClose` /
`glShownAfterClose`）——`:2181` 之後覆寫瀏覽器端的全域對它毫無影響。另取名字是為了讓兩個取樣點在
讀 log 與除錯時分得開，如此而已。

**關閉後另一個分頁會變 focused 並取得新資源**，這不影響本斷言 —— 觀察對象是**被關掉那一個的
舊參照**。它順帶也是「釋放不誤傷」的第二個樣本。

### D2：規格上，銷毀路徑寫成現行 requirement 的延伸，不另立 requirement

現行的「程式化繪製的渲染資源僅供當下顯示的終端」把轉換寫成顯示↔隱藏的二元；銷毀是第三種轉換，
**而它共用完全相同的理由**（並存額度有上限、超出時最早取得者被靜默回收、不觸發任何事件）。
另立 requirement 會讓那段理由重複一次，而重複的理由會在未來改動時分歧。

於是：在該 requirement 的條文加一句涵蓋銷毀，並補一條 scenario。**「僅移除產物而不歸還額度即
失敗」那條既有 scenario 的精神同樣適用於銷毀路徑**——新 scenario 要寫成可指認的形式，而不是
複述既有那條。

### D3：#11 的落點是 `probe:keyboard` 的第四個段落

| 候選 | 邊際成本 | 判斷 |
|---|---|---|
| **`probe:keyboard`（採用）** | +2 次冷啟動（build / dev 各一） | 已有 `runSections`，三段**彼此獨立**（各自 `makeFixture()` / `seedProfile()` / `launch()` / 收屍，該支的註解已實際確認過）。`checkSingleFolder` 就是 `seedProfile([only])`，加 `seedProfile([])` 是同一個模式的極端值。全域項目的斷言群（`:1606-1634`）已經住在這支，`pressKey` / `realClick` / `MOUNTED` 全部現成 |
| `probe:shell` | **+0 次冷啟動** | **唯一已經處在零 folder 狀態的探針**，且是第 4 便宜的一支（`run-probes.mjs:30`）。**但它沒有 `runSections`、沒有 `pressKey` / `realClick`、只跑 build 模式，且 `client.close()` 緊接在第一次 evaluate 之後（`:211`）** —— 要承載這五條得先把它改造成另一支探針，那筆改造成本遠大於省下的兩次啟動，並且會讓 `probe:shell` 不再是「視窗 + 信任模型 + preload 白名單」那支便宜的煙霧測試 |
| `probe:workspace` | +2 次冷啟動 | issue 的建議，但它是**線性流程、沒有段落隔離** —— 一次 throw 吃掉其後全部 |
| `probe:openspec` | +2 次冷啟動 | `status-bar` 空狀態的現有斷言在這支（`:1395`），但該支已是最貴的之一（`run-probes.mjs` 的成本序倒數第二），且零 folder 與 OpenSpec 主題無關 |

**代價明說**：`status-bar` 的兩條斷言會住在 keyboard 探針裡，主題上不完全對齊。這可接受，因為
**探針分工本來就不按 capability 切**（`probe:workspace` 一支包五個 capability）。分段的判準是
「這一段的成本核心是什麼」——此處是**一次零 folder 冷啟動**，四條共用它。

### D4：`Ctrl+↓` 無操作那條，必須先證明快捷鍵沒有被抑制

**這是本段最容易假綠的一條，也是唯一需要特別設計的一條。**

既有紀律：`[role="dialog"]` 或 `[role="menu"]` 存在時快捷鍵一律被抑制。零 folder 是個從未被執行過
的啟動狀態——若那時有任何引導性的對話框，「按了沒反應」與「規格要求的無操作」**在結果上完全
相同**，而斷言要的是後者。

處置是兩步，且順序是承重的：

1. **先按一次 `Ctrl+↓`，斷言它選中了全域項目**（`keyboard-navigation` 的「尚未選中任何項目時
   選中第一個」——冷啟動不預設選中全域項目，這是 `global-session` 的明文要求）。
   **這一次成功的按鍵就是「快捷鍵在此狀態下是活的」的證據。**
2. **再按一次 `Ctrl+↓`，斷言選中項目不變且 app 未崩潰**（`spec.md:112` 那條）。

第一步順帶也覆蓋了「尚未選中任何項目時選中第一個」在零 folder 下的情形（規格未特別要求，但那是
白撿的）。

> **實作後的修正（實測推翻了上面的預期）**：本設計原本預期「少了第一步，第二步在快捷鍵被抑制時
> 依然全綠」。實測注入 `[role="dialog"]` 後**兩條同時變紅** —— 因為第二步的判定式寫成
> `afterDown === GLOBAL`（**絕對**狀態）而非 `afterDown === before`（相對）。被抑制時根本沒有東西
> 被選中（`null`），絕對判定當場就分得開。
>
> **所以真正承重的是「以絕對狀態表述」，先按一次是輔助。** 兩者都保留：前者防假綠，後者提供
> 診斷力（失敗時區分得出「快捷鍵整個失效」與「無操作的行為不對」），並在日後有人把判定式改回
> 相對比較時仍擋著。spec 條文已依此改寫。

### D5：`status-bar` 的兩條互為對照組，且不寫死是哪一句空狀態文字

兩條的關係是**同一次啟動的前後**：

- 建 session 前 → 呈現空狀態文字（`spec.md:218`）
- 於全域項目建一個 session 並聚焦後 → 呈現該 session 的脈絡，**不是**空狀態文字（`spec.md:223`）

單獨任一條都不夠：一個「永遠顯示空狀態」的實作被第二條擋住，一個「有 folder 才顯示空狀態」的
實作被第一條擋住。

**空狀態文字有兩句**：`StatusBar.tsx:104` 是 `selection ? t('statusBar.noSession') :
t('statusBar.noRepo')`——零 folder 且已選中全域項目時是前者，尚未選中時是後者。**斷言的判準是
「文字屬於這兩句之一」，不是寫死哪一句**：規格說的是「呈現空狀態文字」，把它綁死在 `noRepo` 上
會讓一次無關的選中狀態調整把這條弄紅。

建立 session 走 `rail.newSessionIn` + 全域項目名（`probe-package.mjs:150` 的
`GLOBAL_NEW_SESSION_RECT` 是現成寫法）——**不能用 `probe-keyboard.mjs` 既有的 `createSession()`**，
它找的是主舞台的 `sessions.new`，而零 folder 時沒有選中的 repo。

### D6：`global-session` 的驗收紀律要點名涵蓋範圍

新 requirement 若只寫「全域項目的恆常性以零 folder 驗證」，下一個人只會想到 rail 那一條。條文要
明寫它涵蓋 `keyboard-navigation` 與 `status-bar` 中**以同一前提成立**的條款——那三條的 WHEN 都是
「workspace 中沒有任何 folder」，它們共享同一個載體，也共享同一種假綠。

本 repo 的同形先例：`terminal-sessions` 的「額度歸還的驗收以資源自身的失效狀態為觀察對象」、
`workspace-layout` 的「拖曳排序須用至少三個項目」。

## Risks / Trade-offs

**[零 folder 啟動有沒人見過的初始狀態，例如自動彈出原生檔案對話框（CDP 打不到，整段卡死）]**
→ **這個風險比原先評估的低得多**：`probe:shell` 每一輪 `test:e2e` 都以零 folder 啟動並成功掛載
（同一種 `electron .` 啟動方式，不是 packaged 產物），`probe:package` 還在該狀態下點到了建立入口。
另外 renderer 中所有 `role="dialog"` 都是使用者觸發的，沒有啟動時自動彈出的對話框。實作的第一步
仍保留一次最小啟動確認（便宜，且順帶確認 `[role="dialog"]` 不存在——D4 依賴這件事），但**整個
計畫的風險敘事不建立在它身上**。

**[新斷言插進 `runMode` 影響其後對時序敏感的斷言]** → 新增的只有 `evaluate`，不動版面、不動
分頁狀態、不改變任何點擊座標（CLAUDE.md 記載的「版面一動就開始點空」不適用）。

**[#26 的斷言在 dev 模式取得不到結果]** → **實測推翻，這個風險不存在。** 本設計原本假定
`dev:runMode` 逾時 480 秒跑不完（issue #21），因此新斷言只有 build 驗得到。實際跑完整支
`probe:terminal`：**266/266 全綠，20 個段落全部通過，`dev:runMode` 花 66.3 秒**，新斷言在
build 與 dev 兩個模式都是綠的。`probe:keyboard` 同樣 **218/218 全綠**，issue #19 記載的兩條
dev 穩定失敗**一條都沒有重現**。

> 這是 #21 與 #19 的有效資料點：兩者所述的症狀在本輪（機器安靜、單支依序跑）皆未重現，與 #17
> 「負載型失敗」的定調相容。已於兩張 issue 補 comment，**本 change 不據此關閉它們** —— 一次未
> 重現不足以推翻一張以「穩定失敗」為名的 issue，那正是 #17 記載過的判讀陷阱的鏡像。

**[`probe:keyboard` 多一次冷啟動]** → 該支目前三段 × 兩模式；多一段即多兩次啟動。零 folder 的
fixture 不需要 `makeFixture()`（不建任何 repo），是四段裡最便宜的一次啟動。

**[`status-bar` 的斷言住在 keyboard 探針裡，日後找不到]** → 由 D6 的規格條文承擔：它明寫這三條
共用同一個載體。另在該段落的 doc comment 點名它承載了哪些 capability 的哪些 scenario。

**[#26 的 spec 條文擴張後，既有實作是否真的滿足]** → 實作已經滿足（`xterm.ts:512-517` 的
`dispose()` 有呼叫 `releaseWebglContext()`）。本 change 是**先補條文再補驗收**，不是先補條文再改
實作——這一點在 tasks 裡不要弄反：**新斷言必須在拿掉那行時變紅、加回時變綠，兩個方向都驗。**

## Open Questions

- 零 folder 段落是否也該在 `probe:workspace` 加一份？**傾向不加**——重複一次冷啟動而不增加鑑別力。
  若日後 `workspace-folders` 出現以零 folder 為前提的 scenario，再議。
- issue #11 對照表的兩處更正（`Shift` → `Ctrl+↓`、三條 → 四條）要回寫到 GitHub 嗎？
  **傾向在 archive 關閉 issue 時以留言說明**，而不是編輯原文——原文記錄了當時的判斷。
