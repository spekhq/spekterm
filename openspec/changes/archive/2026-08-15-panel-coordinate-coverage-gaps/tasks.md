# Tasks — 補上 panel-coordinate-per-folder 的三個驗收缺口

> **每一條新增斷言的對照組是它自己的驗收**：斷言寫完之後，必須把產品程式碼暫時改成**錯誤實作**、
> 確認該斷言真的變紅、再改回來。少了這一步，交付的是一條「看起來相關」的斷言，而不是一條擋得住
> 退化的守衛 —— 這正是本 change 要清償的那種缺口。

## 1. 第 3 條：來源指向的 folder 已被移除（`side-panel-source`）

- [x] 1.1 擴充 `scripts/probe-openspec.mjs` 的 `seedProfile`，使其除 `workspace.json` 外可另寫一份 `panel.json`
- [x] 1.2 新增一個**不宣告 `deps`** 的段落，自己 `seedProfile` ＋ `launch` ＋ 於 `finally` 關閉，形制照 `probe-keyboard.mjs:2027` 的 `checkEmptyWorkspace`
- [x] 1.3 確認新 profile 的命名落在 `killStrays` 的前綴（`spekterm-openspec-profile`）之內，並將該段落註冊進 `SECTIONS`
- [x] 1.4 構造該段落自己的 `panel.json`：一筆來源指向**不存在的 folder 識別碼**，另一筆來源指向**真實存在的另一個 folder**
- [x] 1.5 斷言：非法那筆的來源退回其自身
- [x] 1.6 斷言：合法那筆的來源**確實被還原**（證明 `panel.json` 有被讀取，而非整份被忽略）
- [x] 1.7 斷言：應用程式完成掛載（以既有的 `awaitMounted` 明確表達，不由其後的斷言隱含）
- [x] 1.8 **對照組**：暫時讓 restore 忽略 `panel.json`，確認 1.6 變紅；再暫時讓非法識別碼不被丟棄，確認 1.5 變紅

## 2. 第 2 條：尚無 session 時跨身分導覽切換樹根（`side-panel-worktree`）

- [x] 2.1 於 `probe-openspec.mjs:2514` 之後、`:2515` 的 `createSession` 之前建立前置：錨定一個來源為 worktree 的 change、切至本 change 視圖
- [x] 2.2 觸發檔案導覽，以**兩條並列**斷言樹根：呈現該 worktree 的根層項目，**且不再呈現 folder 自身的根層項目**（範本為 `:3093–3105`，**不是** `:2459` —— 後者實際讀的是 `WORKTREE_PICKER` 的標籤）
- [x] 2.3 處理取值時點：跨身分導覽之後 Files 呈現的是**檔案檢視器而非樹**（`FilesPanel.tsx:305`），斷言前需先回到樹
- [x] 2.4 **自帶還原**：本段結束時各還原一次工作目錄（`resetWorktreeToSelf`）與身分（`CLICK_IDENTITY('◈')`）—— `:2463` 的那一次在新落點**之前**，涵蓋不到
- [x] 2.5 於新增斷言旁寫明它與 `:2459`、`:2527` 兩條既有斷言的分工，避免日後被當成重複而刪除
- [x] 2.6 **對照組**：暫時把 `MainStage.tsx` 的 `panel.setWorktree(...)` 呼叫點包回 `if (focusedId)`，確認 2.2 兩條皆變紅

## 3. 第 1 條：跨項目寫入（`artifact-continuation`）

- [x] 3.1 於 `runWorktreeAggregation` **末尾**建立前置：rail 選中另一個 repo，側欄來源指向 `repo-worktree`；前置步驟以「（前置）」斷言表達，使前置失敗與被驗行為失敗可區分
- [x] 3.2 觸發「於該工作目錄開啟 session」的入口，切 rail focus 至來源 folder，斷言該 change 成為**來源 folder** 的錨定
- [x] 3.3 確認 `runQuickOpenSection`（其後唯一的段落）不依賴本段留下的 rail 選中項與側欄來源；若依賴則補還原
- [x] 3.4 **對照組**：暫時把 `openSessionInChangeWorktree` 的 `panel.setAnchor(panelFolder.id, …)` 改為寫入 rail 選中的 folder，確認 3.2 變紅

## 4. 驗收

- [x] 4.1 完整跑 `npm run probe:openspec`，確認總結標示**所有段落完整執行**（不完整的一輪不能拿來宣稱缺口已補）
- [x] 4.2 與改動前的一輪比對：**既有斷言數逐一相同**，且沒有既有斷言由綠轉紅**或由紅轉綠**（實測基線 `450/450`、改動後 `494/494`，差 44 ＝ 新增 22 條 × 2 個模式）
- [x] 4.3 `npm test`、`npm run lint`、`npm run typecheck` 全綠

## 5. 文件

- [x] 5.1 更新 CLAUDE.md「反覆重演的教訓」中「補一條 scenario 與覆蓋一條 scenario 是兩個動作」那條：`panel-coordinate-per-folder` 的缺口已清償，並保留它作為該次重演的紀錄
