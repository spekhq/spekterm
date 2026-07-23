> **順序是承重的。** 第 1 節把 `targetOfPath` 改成吃一份工作目錄根清單，但呼叫端先傳
> `['']`（只有 folder 自身）—— 那與現行行為**逐字等價**，於是既有的一切必須保持全綠。資料管線
> 到第 4 節才接上。這樣「判準改寫弄壞了什麼」與「資料管線弄壞了什麼」分得開；反過來做的話，
> 任何一條紅燈都有兩個嫌疑犯（`terminal-gpu-renderer` 換觀測管道時的同一條紀律）。

## 1. 判準：`targetOfPath` 改為查工作目錄根清單

- [x] 1.1 `src/renderer/src/shell/openspec/nav.ts`：`targetOfPath(relPath, worktreeRoots)` ——
      **以根由長至短逐一嘗試**，剝除該根後沿用既有的 `openspec/…` 結構判定，取第一個命中的
      結果（design D1：「逐一嘗試」≠「取最長」，後者在病態佈局下會失手）。比對**以路徑分段
      進行**，不得用 `startsWith`；folder 自身的根是空字串，剝根後仍須要求首段為 `openspec`
- [x] 1.2 新增 `src/renderer/src/shell/openspec/nav.test.ts`（目前沒有任何測試）—— 表格式涵蓋：
      folder 自身的 change 與 spec、archive 底下的 change、worktree 的 change、worktree 的 spec
      （**給**，design D3）、**`docs/openspec/changes/<slug>/proposal.md`（不給）**、
      `<worktree>/docs/openspec/changes/<slug>/proposal.md`（不給）、巢狀工作目錄、空清單、
      空 relPath
- [x] 1.3 **`startsWith` 的對照案例要用「兩個根互為字串前綴」**：清單同時有
      `.claude/worktrees/wt` 與 `.claude/worktrees/wt-a`，開後者底下的 change 檔案必須命中
      `wt-a`。**`<root>-suffix` 擋不住 `startsWith`**（剝出的首段是 `-suffix` 而非 `openspec`，
      正確版與 `startsWith` 版同解）—— 但它**擋得住鬆綁版**，所以留著它，只要在測試名稱上標對
      它在測什麼（design D7 的鑑別力矩陣）
- [x] 1.4 對照組：把 1.1 的分段比對改成 `startsWith`，1.3 那條必須變紅；把結構判定改成
      「找到第一個等於 `openspec` 的分段」（鬆綁版），1.2 的 `docs/openspec/changes/…` 那條
      必須變紅。**兩條都不變紅就表示測試沒有鑑別力，不是實作正確**
- [x] 1.5 `FilesPanel.tsx` 的呼叫端暫時傳 `['']`，跑 `npm test` 與 `npm run typecheck`，
      確認**既有行為逐字不變**（此時尚未修好任何東西，但也不得弄壞任何東西）

## 2. 主行程：供應各工作目錄的 folder-relative 根

- [x] 2.1 `src/main/openspec-service.ts`：由 `AggregatedScanResult.worktrees` 算出各工作目錄的
      folder-relative 根，翻譯不出來（邊界外）者**整筆省略**（不以 `null` 佔位）
- [x] 2.2 **folder 自身以空字串恆入清單** —— 不經 `toRelPath`（`openspec-service.ts:178` 對
      `rel === ''` 回 `null`，照直覺寫會把 folder 自己第一個丟掉）、不取決於 git 列舉是否成功
      （非 git 目錄的 `listWorktrees` 回空陣列）。**這條是 design D6 的 CRITICAL，少了它會打壞
      既有的反向導覽**
- [x] 2.3 沿用既有的 per-folder 快取與 `openspec/` 監看 —— **不為此另建 watcher**
      （`worktree-aggregation` 的兩層 watcher 已涵蓋工作目錄清單本身）
- [x] 2.4 `src/main/openspec-service.test.ts` 補測試：邊界內 worktree 出現且為相對路徑、
      邊界外 worktree 不出現、清單中**無任何絕對路徑亦無 `null`**、
      **folder 不在版控之下時清單恰含空字串**、
      **folder 是 repo 子目錄時（`aggregated: false` 且 `worktrees` 帶著指向 repo 根的那筆）
      清單恰含空字串**
- [x] 2.5 對照組：把 2.2 的「folder 自身恆入清單」拿掉，2.4 的後兩條必須變紅。
      **注意既有的 worktree 測試把 `scan` 整個注入掉了**（`openspec-service.test.ts:335-378`
      的 `aggregated()` helper 直接造結果、刻意不 spawn 真 git），所以「fixture 不是 git repo
      → core 靜默退回非聚合」那個假綠在這裡不存在；真正沒被覆蓋的是 **`aggregated: false`**
      那條路，2.4 的最後一條就是為它加的

## 3. IPC 與 preload

- [x] 3.1 `src/main/ipc/openspec.ts`：新增 channel 與 handler，以 `folderId` 定址、
      走既有的 `toResult()` 結果物件（design D2）
- [x] 3.2 `src/preload/index.ts`：加入 `openspec` 白名單
- [x] 3.3 `src/renderer/src/shell/openspec/adapter.ts`：`OpenSpecApi` 介面與 `IpcAdapter` 實作；
      `src/renderer/src/shell/types.ts` 補型別 re-export（proposal 的 Impact 已列，第一版 tasks
      漏了這一層）
- [x] 3.4 `scripts/probe-shell.mjs`：更新 `openspec.*` 的白名單守衛清單 ——
      **它會擋下「加了東西卻沒告訴它」**，這正是它存在的理由

## 4. renderer：取數與接線

- [x] 4.1 `src/renderer/src/shell/openspec/data.tsx`：新增取工作目錄根的 hook，比照既有 hook
      吃 `folderId` + `revision`（`OpenSpecProvider` 位於 `MainStage` 之上，`FilesPanel` 在它的
      context 之內 —— 不必把資料從別處灌進去）。**必須吃 `folder === null`**（`SidePanel.tsx:67`
      有這條掛載路徑）
- [x] 4.2 `FilesPanel.tsx`：改用該 hook 的結果取代 1.5 的 `['']`；清單尚未取得時不呈現入口
      （spec 已明文規定此期間的行為）
- [x] 4.3 確認**切換檔案時不再有任何 IPC 往返**（清單 per-folder 取一次並隨 revision 快取）——
      這才是 design D1 否決方案 B 的那個性質。**不要寫成「沒有非同步窗口」**：清單本身就經 IPC
      取得，首次進入某個 folder 的 Files 身分時入口仍會晚一拍出現（design D1 已更正）

## 5. spec 檢視標示來源工作目錄

- [x] 5.1 spec 檢視呈現其內容的來源工作目錄（`openspec-panel` 的 delta）。**這不是裝飾**：
      backfill 發生在 worktree 裡且是每個 change 出貨前的標準動作，於是「開著的檔案」與「側欄
      呈現的那份」分歧是常態；且 spec 的往返會把使用者送到主工作目錄那個檔案（design D3）
- [x] 5.2 標示用的來源資訊自主行程既有的 DTO 取得，不新增絕對路徑欄位
- [x] 5.3 文案進 `src/shared/i18n/en.json`，`aria-label` 自字典取（既有紀律）

## 6. 驗收：`probe:openspec` 的成對斷言

- [x] 6.1 fixture：**邊界內 worktree 已存在**（`probe-openspec.mjs:184-220` 的
      `makeWorktreeFixture()` 已有 `.claude/worktrees/wt-inside`，且它是從含
      `openspec/specs/auth/spec.md` 的 commit 切出去的）—— 只需新增**反面** fixture：
      `docs/openspec/changes/<slug>/proposal.md`
- [x] 6.2 正面：於 Files 身分開啟 worktree 中 change 的 artifact 檔案 → 呈現 **View in OpenSpec**
      → 觸發後切至 OpenSpec 身分並呈現該 change
- [x] 6.3 正面：於 Files 身分開啟 worktree 中的 `openspec/specs/auth/spec.md` →
      觸發後呈現該 topic，且呈現來源標示（design D3、任務 5.1）
- [x] 6.4 反面：`docs/openspec/changes/<slug>/proposal.md` **不呈現**入口 —— **這條的路徑必須
      帶 `changes/` 那一層**：`docs/openspec/notes.md` 對鬆綁實作也回 null，用它等於沒驗
      （design D4 的假綠註記）
- [x] 6.5 對照組：把判準換成鬆綁版（找到第一個等於 `openspec` 的分段），6.4 必須變紅。
      **不是「把防護拿掉」** —— D4 說防護是判準的結構，沒有東西可以拿掉，唯一誠實的對照組是
      換成錯誤的實作
- [x] 6.6 選擇器一律自字典取字串（`scripts/lib/copy.mjs`），不硬編 `aria-label`
- [x] 6.7 驗「新增工作目錄後清單更新」（`openspec-data-access` 的 scenario，否則它零覆蓋）——
      於執行期間新建一個邊界內 worktree，其中的 OpenSpec 檔案隨後可反向導覽

## 7. 回歸與文件

- [x] 7.1 `npm run typecheck`（看 exit code，不要用 `head`／`tail` 過濾）
- [x] 7.2 `npm test`
- [x] 7.3 `npm run probe:openspec`、`npm run probe:files`（反向導覽的入口住在 FilesPanel）、
      `npm run probe:shell`（白名單守衛）
- [x] 7.4 `CLAUDE.md`：在 worktree 聚合那一節補上反向導覽、「工作目錄根清單」這個新的 renderer
      詞彙與它的邊界語意，以及**兩個假綠的實測**（`docs/openspec/notes.md` 擋不住鬆綁版、
      `<root>-suffix` 擋不住 `startsWith`）—— 那兩條都是「反面測試看起來像壞情況、實際上沒有
      鑑別力」的同型案例
