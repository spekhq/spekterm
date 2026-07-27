## 1. 主行程：可供選擇的工作目錄清單

- [x] 1.1 `src/main/openspec-service.ts` 新增 `getWorktrees(folderId)`，自同一份 `#scan` 結果導出
      每個工作目錄一筆 `{ key?, relPath, branch, head, isMain }`；`branch` 為 `null` 時（detached
      HEAD）以 `head` 供介面辨識
- [x] 1.2 **folder 自身那一筆以「合併」產生，不是額外附加** —— 列舉中 `path === root` 的那一筆
      **就是**它（`relPath` 強制為 `''`，`branch`／`key` 照常帶），沒有那一筆時才合成一筆（此時
      `key` 省略）。**兩者恆不並存**。`toRelPath()` 對 `rel === ''` 回的是 `null` 而非 `''`
      （`openspec-service.ts:187-192`），照抄 `getWorktreeRoots` 的「合成 + 過濾」結構會讓每個
      普通 git repo 都產出兩筆（design D3a）
- [x] 1.3 folder 自身以**省略 `key`** 表示，比照 `terminal-sessions` 的「省略即 folder 根」
      （design D3b）—— folder 不在版控下時根本沒有任何 key 可放
- [x] 1.4 `src/main/ipc/openspec.ts` 註冊 `getWorktrees` channel；`src/preload/index.ts` 加入白名單
- [x] 1.5 **`scripts/probe-shell.mjs` 的白名單守衛加上 `getWorktrees`** —— 往 preload 加能力而不動
      它，那道守衛會帶著紅燈被封存（`panel-drive-and-shell-affordances` 的實測）
- [x] 1.6 單元測試（`openspec-service.test.ts`）：**`worktrees = [main(path === root)]` 時清單長度
      恰為 1**（對照組：改回「合成 + map」必須變紅 —— 這是 C1 的守衛）、folder 自身恆入清單且
      `relPath` 為 `''`、非 git folder 的那一筆不帶 `key`、邊界外的 `relPath` 為 `null`、
      **清單不含任何絕對路徑**、folder 本身為 linked worktree 時 `isMain` 為否而 `relPath` 仍為 `''`

## 2. 持久化：側欄的工作目錄

- [x] 2.1 `src/main/session-store.ts` 的 `PersistedSession` 新增 `panelWorktreeKey?`，以既有的
      `isWorktreeKey()` 驗證（不合格即捨棄該欄位，不使該筆 session 失效）
- [x] 2.2 單元測試：`panelWorktreeKey` 與 `worktreeKey` **各自獨立保存且可不相同**；被竄改為
      非識別碼形狀的值不進入重建結果

## 3. renderer：樹根前綴（**此階段行為不得改變**）

- [x] 3.1 新增前綴換算的單一來源（例：`files/paths.ts` 的 `joinRoot(prefix, rel)` /
      `stripRoot(prefix, full)`），**權威為完整 folder-relative 路徑**，只在顯示時剝除前綴（design D6）
- [x] 3.2 `useFileTree` 接受根前綴參數，對 `fs.*` 的每一次呼叫送出完整路徑；watch 的訂閱與事件
      比對亦用完整路徑
- [x] 3.3 **`useFileTree` 的根狀態鍵一併處理** —— `rootLoading` / `rootError` 讀的是
      `state.loading[ROOT_PATH]` / `state.errors[ROOT_PATH]`（`useFileTree.ts:313-314`），漏改
      這兩行，worktree 根的「載入中…」與根層錯誤訊息會**靜默地永遠不出現**
- [x] 3.4 **`title` 屬性留在完整座標系**（`FileTree.tsx:34` 的樹列、`FilesPanel.tsx:270` 的麵包屑）
      —— 它同時是 6 個 probe 助手的選擇器，剝掉會讓導航靜默停住（design D6）。刪除確認對話框的
      目標與 `files.deleteAria` 同理
- [x] 3.5 `FilesPanel` 以前綴 `''` 呼叫它 —— **此時整個 Files 身分的行為必須與改動前完全相同**
- [x] 3.6 單元測試涵蓋 `prefix === ''`（folder 自身）—— 那是最容易被 `if (prefix)` 之類的守衛
      誤殺的值，而它是預設情形
- [x] 3.7 **檢查點：跑 `npm run probe:files`，必須全綠才進入下一組。** 於此劃線，「重構弄壞了
      什麼」與「新功能弄壞了什麼」才分得開（`terminal-gpu-renderer` 的順序教訓）

## 4. renderer：per-session 的工作目錄狀態

- [x] 4.1 `SessionState` / `sessions.tsx` 新增 `panelWorktreeKey?` 與其 setter；**於 `setPanelSource`
      切換 repo 時一併重置**（比照既有的 `anchoredChange` 重置）。`undefined` ＝ folder 自身
- [x] 4.2 每個宣告點寫明它回答哪個問題 —— `worktreeKey`＝session 的 pty 開在哪、
      `panelWorktreeKey`＝側欄的 Files 讀哪一份（兩者型別相同且可不相等，是本 change 最容易看混的一對）
- [x] 4.3 `openspec/data.tsx` 新增 `useWorktrees(folderId)`。**消費者有三個**：選擇器、`FilesPanel`
      （前綴）、`MainStage`（跨身分導覽判定目標歸屬，design D8）
- [x] 4.4 於 renderer 端查表：`panelWorktreeKey` 不在清單中時退回 folder 自身（worktree 已被移除）。
      **此查表不承擔安全**（design D9），註解寫明
- [x] 4.5 **`FilesPanel` 的掛載 key 延伸為 `(folderId, 工作目錄)`** —— 換 worktree 同樣是「換一棵
      樹」，而 `useFileTree` 的既有註解正是以此要求呼叫端換 key；不換則初始 loading 態不會被設

## 5. UI：工作目錄選擇器

- [x] 5.1 選擇器置於 `FilesPanel` 麵包屑中段（`<folder> / [⑂ <branch> ▾] / files / <path>`），
      **清單筆數多於一時呈現**（判準是筆數，不是可選取的筆數 —— design D4）；下拉沿用 `ContextMenu`
- [x] 5.2 邊界外（`relPath === null`）的項目呈現為停用並附說明，且不呈現任何路徑
- [x] 5.3 預設與「當前」的判定用 `relPath === ''`，**不是 `isMain`**（design D5 —— 續寫入口曾在
      此誤判）；`isMain` 僅用於呈現
- [x] 5.4 `branch === null` 時以短 `head` 呈現，與 `repo-branch` 既有的 detached HEAD 呈現一致
      （design D13）
- [x] 5.5 標籤截斷 + tooltip；下拉開啟後斷言其 `getBoundingClientRect()` 完整落在 viewport 內
      （側欄僅 320px 起跳，選單類 UI 的既有紀律）
- [x] 5.6 **切換工作目錄時關閉開啟中的檔案，觸發點為選擇器的選取事件**，不是工作目錄狀態的變更
      —— 否則跨身分導覽會變成「開了又關」（design D7）
- [x] 5.7 **`FilesPanel` 的根層新增入口改用當前樹根**（`FilesPanel.tsx:210` 的
      `row === null ? ROOT_PATH`）—— 不改的話，選定 worktree 後 `＋` 建的檔案落在 folder 根，
      使用者看到「按了沒反應」
- [x] 5.8 **移除 `useWorktreeRoots` / `useWorktrees` 的 `hasOpenSpec` gate**（design D12 已裁決
      接受掃描成本）—— 沒有 `openspec/` 但有 worktree 的 repo 也必須看得到選擇器
- [x] 5.9 文案進 `src/shared/i18n/en.json`；`aria-label` 自字典取字串，**避開單引號等 shell 引號
      會咬到的字元**（`PanelSourceBar` 的實測）

## 6. 跨身分導覽

- [x] 6.1 於 `MainStage` 的 `openFileFromOpenSpec`（**不是 `OpenSpecPanel`**）內，與錨定一併切換
      工作目錄；渲染期間不得呼叫父層 setState（design D8）
- [x] 6.2 目標所屬工作目錄以**最長相符根**判定（工作目錄的根可能互為前綴）
- [x] 6.3 確認反向導覽（`targetOfPath`）不需修改 —— 它吃的本來就是完整路徑與工作目錄根清單；
      若需修改則表示 D6 的「權威為完整路徑」在某處被破壞了

## 7. 驗收

- [x] 7.1 **`probe:workspace` 承擔 C1** —— 其 `repo-openspec` fixture 已是 `git init` + commit 的
      真 repo 且**恰有一個工作目錄**，是「不得產生兩筆」唯一走得到的路徑（`probe:files` 的 fixture
      非 git、`probe:openspec` 的有 3 個 worktree）。斷言：該 repo 於 Files 身分**不呈現**工作目錄
      選擇器
- [x] 7.2 `probe:openspec` 新增段落：選定 worktree 後樹根改變、**成對的反向斷言 —— 該內容確實不在
      folder 自身視角的同一路徑下**。路徑必須挑 `openspec/changes/inside-change/…`（只存在於
      `wt-inside`），**不可用 `openspec/`**（主工作目錄與 worktree 都有，兩種實作同解、零鑑別力）
- [x] 7.3 `probe:openspec`：邊界外的工作目錄呈現為停用且**邊界內的可選取**（成對，否則「選擇器
      整個壞掉」也會過）；`f-worktree-inside` 的預設為它自己而非該 repo 的主工作目錄
- [x] 7.4 `probe:openspec`：自 worktree 的 change 跳往檔案 → 工作目錄一併切換 → 再跳回 OpenSpec
      的**一趟完整往返**
- [x] 7.5 `probe:openspec`：reload 後側欄的工作目錄還原。**reload 前必須先選定一個 linked
      worktree（非預設值）**，reload 後**輪詢**至該值出現 —— 預設就是 folder 自身，若只驗預設值，
      功能全死也是綠的（CLAUDE.md 的「先把狀態改成非預設值」）
- [x] 7.6 `probe:openspec`：選定 worktree 後自根層入口新增檔案，該檔案出現在樹上且**不在 folder
      根**（task 5.7 的驗收）
- [x] 7.7 `probe:files`：其 fixture 非 git，承擔「無工作目錄清單時不呈現選擇器」；並確認既有的
      樹、路徑與項目數斷言仍全綠
- [x] 7.8 插入的探針段落**結束時還原狀態**（身分、視圖、選定的工作目錄）—— 不還原會讓後續既有
      斷言整段變紅，看起來像那一段壞了（`shell-affordance-tweaks` 與 `worktree-reverse-navigation`
      各踩過一次）
- [x] 7.9 `npm run typecheck` 與 `npm test` 全綠

## 8. 收尾

- [x] 8.1 `npm run test:all`（封存前的完整回歸；探針跑在虛擬螢幕上）—— **8/9**：其餘八支全綠，
      `probe:terminal` 一條 pre-existing 的偶發（`quitGracefully` 不等主行程退出，損毀內容被最後一次
      save 覆蓋）已開為 issue #8，單獨連跑 `PROBE_ONLY=runRestore` 兩輪全綠（16/16、32/32）
- [x] 8.2 dogfood：於 core-lib（3 個 worktree）實際切換並閱讀 worktree 內容；另於一個
      **單一工作目錄的普通 repo** 確認選擇器不出現（C1 的人工複驗）
- [x] 8.3 更新 `CLAUDE.md`：本 change 的段落、與 issue #5 的關係、實測踩雷（尤其「`toRelPath` 對
      folder 自身回 `null` 導致的重複項」、「兩個工作目錄欄位可不相同」、「兩種座標系與 `title`
      同時是選擇器」三條）
