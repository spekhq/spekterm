> **每一條新增的 scenario 都在下面有一個指認**（issue #12 的精神，手工版）。對照組不是收尾步驟，
> 而是每一條斷言的一部分 —— **沒有變紅過的斷言不算交付**。

## 1. 零 folder 段落的骨架

> 可行性本身不是風險：`probe:shell` 每一輪都以零 folder 啟動並成功掛載（`probe-shell.mjs:192`
> 建空 profile、全支無 `writeFileSync`）。1.2 只確認 D4 依賴的那一項。

- [x] 1.1 於 `scripts/probe-keyboard.mjs` 新增 `checkEmptyWorkspace` 段落的骨架：`seedProfile([])`（不呼叫 `makeFixture()`）→ `launch()` → 讀 `RAIL_ITEMS` → `app.destroy()`，並註冊進 `SECTIONS`（含 `onTimeout: killStrays`）
- [x] 1.2 跑一次確認：`RAIL_ITEMS` 只有全域項目一項，且 **document 中不存在 `[role="dialog"]`**（D4 的兩步設計依賴這件事；若存在則需回頭改 design）
- [x] 1.3 新增狀態列定位器（該支目前沒有 —— `grep statusBar scripts/probe-keyboard.mjs` 無輸出）。`probe-openspec.mjs:920` 的 `STATUS_BAR_TEXT` 是現成寫法

## 2. #26 —— 銷毀路徑的驗收（`probe-terminal.mjs` 的 `runMode`）

- [x] 2.1 於「自 rail 的 session 子列關閉 session」的 `realClick` **之前**，capture 當下顯示中終端的渲染資源參照。變數名另取（不沿用 `:2136` 的 `__probeGlShown`）——**理由是讓兩個取樣點在讀 log 時分得開**，不是怕弄壞既有斷言（那條在 `:2158` 就結束，判定式用的是已 await 回來的值）
- [x] 2.2 關閉後新增斷言「銷毀當下顯示中的終端時歸還其渲染資源的並存額度」，detail 帶鑑別力自檢（`capture 時沒有任何一個是 alive 就表示這條沒有鑑別力`，照抄既有兩條的措辭）
      → 指認 scenario：`terminal-sessions` /「銷毀當下顯示中的終端時歸還額度」
- [x] 2.3 **把「被關掉的就是顯示中的那一個」納入 2.2 的判定式**：close 之前讀一次 `TABS`，要求 `tabs[1].selected === true`，與 gl 判定寫在**同一條 `check()`** 裡。取樣點日後被挪去關閉隱藏分頁處時，這條會紅
      → 指認 scenario：`terminal-sessions` /「銷毀路徑的驗收取樣於顯示中的終端」。**這是可執行的載體，不是註解** —— 一則註解不會變紅，也擋不住下一個人挪動取樣點
- [x] 2.4 於 2.1 的位置補註解，記錄為什麼取樣點是這裡（隱藏者的資源早已於轉隱藏時釋放，銷毀做或不做結果相同）。**註解是給人讀的說明，載體是 2.3**
- [x] 2.5 **對照組**：拿掉 `src/renderer/src/shell/terminal/xterm.ts:514` 的 `releaseWebglContext()`，`PROBE_ONLY=runMode:build npm run probe:terminal` 必須**紅在 2.2 這條**（且其餘條數不變）；加回後必須全綠。兩個方向都要跑
      → 指認 scenario：`terminal-sessions` /「銷毀路徑若不歸還額度即失敗」

## 3. #11 —— 零 folder 段落的五條斷言（`probe-keyboard.mjs`）

- [x] 3.1 斷言：rail 呈現全域項目，且它是唯一的項目（`RAIL_ITEMS` 長度為 1 且等於 `rail.globalName`）
      → 指認：`global-session` /「尚無任何 folder 時仍呈現」、`global-session` /「恆常呈現的驗收於零 folder 的 workspace 進行」
- [x] 3.2 斷言（**兩步，順序承重**）：先按 `Ctrl+↓` 並斷言全域項目**成為選中項**（證明快捷鍵未被抑制），再按一次 `Ctrl+↓` 並斷言選中項不變且 `MOUNTED.ok === true`
      → 指認：`keyboard-navigation` /「rail 只有全域項目時為無操作」、`global-session` /「零 folder 下的無操作驗收先證明快捷鍵生效」
- [x] 3.3 **同一條 requirement 的條文涵蓋「這兩個快捷鍵」，因此順帶按一次 `Ctrl+↑`** 並斷言無操作。它是相反方向的邊界（`(0 - 1 + 1) % 1`，負數取模是會出事的那一類），而 app 已經起來、成本接近零
- [x] 3.4 斷言：尚未建立任何 session 時，狀態列存在且其文字屬於 `statusBar.noRepo` / `statusBar.noSession` **之一**（不寫死哪一句 —— 規格要的是「呈現空狀態文字」）
      → 指認：`status-bar` /「workspace 為空且無任何 session 時」
- [x] 3.5 切至 Files 身分，斷言呈現 `files.noSource`（`SidePanel.tsx:187`；未選中項目時是 `stage.noRepoHint`，`:173` —— 兩者要分得開）
      → 指認：`file-explorer` /「沒有可用的側欄來源」。**現有載體「來源未選定時 Files 不呈現任何檔案列」跑在有 folder 的 fixture 上，驗的是另一個狀態**
- [x] 3.6 於全域項目建立一個 session（走 `rail.newSessionIn` + `rail.globalName` 的入口，`probe-package.mjs:150` 的 `GLOBAL_NEW_SESSION_RECT` 是現成寫法。**不可用既有的 `createSession()`** —— 它找的是主舞台的 `sessions.new`，零 folder 時沒有選中的 repo），斷言狀態列**不再是**空狀態文字，且呈現該 session 的脈絡
      → 指認：`status-bar` /「workspace 為空但有全域 session 時不呈現空狀態」
      → 取捨備註：同檔 `:1651-1657` 有更便宜的 `Ctrl+T` → `ArrowDown` → `Enter` 路徑，**刻意不用** —— 那會讓本條依賴 3.2 所驗的快捷鍵，兩條斷言就不再獨立
- [x] 3.7 段落的 doc comment 點名它承載了哪四個 capability 的哪五條 scenario，以及「這一段的成本核心是那一次零 folder 冷啟動，五條共用它」
- [x] 3.8 段落結束前 `app.destroy()`（`killStrays` 的 pattern 已涵蓋本段 profile 前綴，確認即可；`ports.mjs` 不需要動 —— 四段共用該支既有的 build/dev 兩個 port）

## 4. 對照組（每一條斷言都要看過它變紅）

- [x] 4.1 **3.1 / 3.2 的對照組**：把 `seedProfile([])` 暫時改為種一個 folder，確認 3.1 與 3.2 第二步變紅 —— 這證明「零 folder」是承重的，不是可有可無的佈景
      → 實測 6/8：3.1 紅（`["Global","repo-a"]`）、3.2 第二步紅（`Global → repo-a`）。**3.3（`Ctrl+↑`）在此對照組下仍綠** —— 自 `repo-a` 按 `Ctrl+↑` 恰好也回到全域項目，判定式因此成立。**這個對照組對 3.3 沒有鑑別力**，如實記錄；3.3 是白撿的相反方向邊界（`(0-1+1)%1`），其鑑別力來自零 folder 環境下實作若算錯會回傳 `undefined` 或崩潰，不來自本對照組
- [x] 4.2 **3.4 的對照組**：把 `src/renderer/src/shell/StatusBar.tsx:102` 的 `{!focused ? (…) : (…)}` 暫時改成 `focused ? (…) : null`（即 `status-bar:211-212` 明文禁止的「呈現為一列空白」），確認 3.4 變紅
- [x] 4.3 **3.5 的對照組**：暫時讓 Files 身分在無來源時回傳 `null` 而非提示，確認 3.5 變紅
- [x] 4.4 **3.6 的對照組**：把 `StatusBar.tsx` 的空狀態條件暫時改回「沒有 folder 就呈現空狀態」（`!focused` → `!focused || 沒有 folder`），確認 3.6 變紅、3.4 仍綠
- [x] 4.5 **3.2 第一步的對照組**：在 renderer 注入一個 `<div role="dialog">`（`KeyboardNavigation.tsx:170` 的抑制判定就是 `querySelector('[role="dialog"], [role="menu"]')`），確認**第一步變紅而第二步仍綠** —— 那正是兩步分工的證明：少了第一步，第二步在快捷鍵完全失效時依然全綠。**這條不必改產品程式碼**
      → 實測 4/8，而**結果與 design 的預期不同**：兩步**同時**變紅（`null` / `null → null`），不是「第一步紅、第二步綠」。原因是第二步的判定式寫成 `afterDown === GLOBAL`（**絕對**狀態）而非相對比較 —— 被抑制時根本沒有東西被選中，絕對判定當場分得開。**真正承重的是「以絕對狀態表述」，先按一次是輔助**（診斷力＋防止日後改回相對比較）。spec 與 design 已依此改寫，並新增一條 scenario
      → 意外收穫：同一輪 3.5 紅的 detail 是 `stage.noRepoHint` 而非 `files.noSource`，**證明該斷言確實分得開「未選中項目」與「選中但無來源」兩個狀態**（3.5 明確要求的性質）
      → **指認 scenario：`global-session` /「零 folder 下的無操作驗收以絕對狀態表述」。載體是本對照組（手動），不是自動斷言** —— 誠實記錄它的層級：3.2 的判定式（`probe-keyboard.mjs:2047` 的 `afterDown === GLOBAL`）確實是絕對表述，但**若有人把它改成 `afterDown === selectedFirst`，探針照樣全綠**，只有重跑本對照組才會發現。**刻意不做自動守衛**：那需要一個檢查斷言判定式寫法的原始碼測試，而那種測試綁死措辭、會在任何一次無害的改寫時變紅（本 repo 的既有守衛都是「擋一類東西出現」，不是「要求某行長成某樣」）。與 2.3 的差別是結構性的：那一條的性質（取樣點是不是顯示中的終端）能表達成**執行期可觀察的值**，這一條的性質（判定式怎麼寫）不能
- [x] 4.6 對照組全部還原後，`git diff --no-color` 確認產品程式碼零改動（`--no-color` 的理由見 CLAUDE.md）

## 5. 回歸與收尾

- [x] 5.1 `npm test`（含 `aria-label-source` / `copy-language` / `i18n-key-safety` 三道守衛）
- [x] 5.2 `npm run lint` 與 `npm run typecheck`
- [x] 5.3 `npm run probe:terminal`（build 全段）—— 確認除 2.2 外條數與插入前一致
      → 實測 **266/266 全綠，20 段全部通過**（build + dev）。新斷言在兩個模式都綠
- [x] 5.4 `npm run probe:keyboard`（build + dev 全四段）
      → 實測 **218/218 全綠**，八段全部通過。**dev 模式預期會紅的那兩條（issue #19）一條都沒有重現**。新段落 build 4.4s / dev 5.2s，是該支最便宜的一段。已於 #19 補 comment
- [x] 5.5 `dev:runMode` 目前逾時跑不完（issue #21），因此 2.2 在 dev 模式**無法取得結果**。跑一次記錄實際情形，不阻塞本 change
      → **實測推翻該預期**：`dev:runMode` 66.3 秒跑完且全綠，2.2 在 dev 也取得結果。已於 #21 補 comment。**不據此關閉 #21** —— 一次未重現不足以推翻一張以「穩定失敗」為名的 issue（#17 記載過的判讀陷阱的鏡像）
- [x] 5.6 依 CLAUDE.md 的兩條判準決定新教訓寫進哪一份（`docs/lessons/probes.md` 或 CLAUDE.md）；若無新教訓，明確記為「無」
      → 新增 `docs/lessons/probes.md` 的「『無操作』的斷言：相對判定在整個機制死掉時**照樣是綠的**」一節（觸發條件明確 —— 只在寫「什麼都不該發生」的斷言時踩到，因此屬 lessons 而非 CLAUDE.md），附帶記了「跑對照組時還原後必須重新建置才算還原完成」
- [x] 5.7 關閉 GitHub issue #26 與 #11，並於 #11 留言說明對照表的更正（`Shift+↑↓` → `Ctrl+↓`、三條 → **五條**，多出的是 `status-bar:218` 與 `file-explorer:47`）
      → #26、#11 已關閉並附交付說明；另於 #21、#19 補了本輪「dev 全綠、未重現」的資料點（**不關閉它們** —— 一次未重現不足以推翻一張以「穩定失敗」為名的 issue）
