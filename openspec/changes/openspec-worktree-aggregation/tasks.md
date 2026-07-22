## 1. 資料層：換用 core 的聚合掃描

- [x] 1.1 `openspec-service.ts` 的快取、in-flight、注入點型別由 `ScanResult` 改為 `AggregatedScanResult`；預設掃描實作改為 `scanOpenSpecAggregated(root, { includeJj: false })`（`aggregate` 採 core 預設）
- [x] 1.2 `getGraphData` 改用 `buildGraphDataAggregated`（**async**，非聚合版是同步的；`#read` 已同時吃兩者）
- [x] 1.3 `getChange` / `getSpecAtChange` 的讀取根改為 `change.source?.path ?? root`（design D2）
- [x] 1.4 `getSpecs` / `getSpec` 的讀取根改為**主工作目錄**（`result.worktrees` 中 `isMain` 的那筆），非 `root`（design D2b —— 沿用 `root` 時，folder 為 linked worktree 或 repo 子目錄的情形下 spec 列得出來卻打不開，已實測）
- [x] 1.5 **不改**開發模式的掃描摘要 —— `scripts/probe-core.mjs:36` 以嚴格 regex 解析那一行，欄位加在後面會使斷言變紅、加在中間會使整條 regex 不匹配而 `bail`；且 `spek-core-integration` 有一條 requirement 綁著它。改它需要一併動 spec 與 probe，價值不足

## 2. 來源 DTO

- [x] 2.1 定義 `ChangeOrigin`（`key` / `branch` / `vcs` / `isMain` / `isFolderRoot`）與 `ChangeSummary = Omit<ChangeInfo, 'source'> & { worktree?: ChangeOrigin }`（design D3）
- [x] 2.2 `isFolderRoot` 由主行程比較 `source.path` 與 `folder.path` 得出 —— **兩者目前都是 realpath**（`workspace-store.ts:159` 與 git 的輸出），此前提要寫進程式碼註解（design D6 的但書）
- [x] 2.3 `getChanges` 把 core 的 `source` 翻譯為 `worktree`，**丟棄 `path`**
- [x] 2.4 `ChangeDetailView` 加上同一個 `worktree` 欄位 —— 來源取自 `#findChange` 查表的結果，**不從 `readChange` 取**（core 的 `readChange` 從不填 `ChangeDetail.source`，已 grep 確認；design D11）
- [x] 2.5 `src/preload/index.ts` 與 `src/main/ipc/openspec.ts` 的型別同步
- [x] 2.6 單元測試：送往 renderer 的 change 清單與 change detail 均不含絕對路徑欄位；**對照組**斷言 core 原始結果的 `source.path` 確實存在（否則這條在「core 根本沒給 source」時也會綠）
- [x] 2.7 單元測試：`isFolderRoot` 在「folder 是主工作目錄」與「folder 是 linked worktree」兩種情形下皆正確 —— 後者的 `isMain` 為 `false` 而 `isFolderRoot` 為 `true`（兩者相反，正是 D7 不能用 `isMain` 的理由）
- [x] 2.8 確認 `ChangeSummary` 仍可餵給 `@spekjs/ui` 的 **`buildLanes`**（`ChangeTimeline` 吃的是 `Lane[]`，吃 `ChangeInfo[]` 的是 `buildLanes`）—— typecheck 通過即證明

## 3. relPath 的來源感知

- [x] 3.1 `changeDirRelPath` / `artifactRelPath` / `deltaSpecRelPath` 改為：以**來源工作目錄**的絕對路徑組出候選並 `stat` 確認存在，再以 **folder root** 為基準呼叫 `toRelPath`
- [x] 3.2 單元測試：來源在 folder 邊界內的 worktree 翻得出 relPath；邊界外（如 `/tmp`）回 `null` 且不拋錯

## 4. 兩層 watcher

- [x] 4.1 `src/main/git-branch.ts` 新增 `resolveCommonDir()`：在既有的 `gitdir:` 間接之上再解 `<gitdir>/commondir`（不存在時 common dir 即 gitdir 自身）。**不 spawn git**，等價於 `git rev-parse --git-common-dir`
- [x] 4.2 基礎層 watcher 加上 **`<commonDir>/worktrees/`** 的監看，`depth: 0` 且只理會目錄的新增與移除 —— 不收窄的話，worktree 裡每跑一次 `git commit` 就會產生 3 個事件並觸發一次完整重掃（實測，design D4）
- [x] 4.3 新增 worktree 層：每次掃描完成後依 `result.worktrees` 同步各工作目錄 `openspec/` 的監看（新增、移除、folder 自身的那個不重複監看）
- [x] 4.4 `releaseFolder` / `dispose` 釋放全部層級的 watcher；`watchedFolderCount` 的語意若改變需一併更新其註解與既有斷言
- [x] 4.5 單元測試：linked worktree 的 `openspec/` 變更觸發快取失效與通知
- [x] 4.6 單元測試（**三段式，缺一則無鑑別力**）：(a) `git worktree add` 後等第一次通知落地並**重新取數**，使 worktree 層建立；(b) 於新 worktree 中寫入一個 change；(c) 斷言收到**第二次**通知且重新取數拿得到該 change。**單純斷言「新建 worktree 後收到通知」是假綠** —— `git worktree add` 本身就會觸發基礎層
- [x] 4.7 單元測試：folder 本身是 linked worktree 時，基礎層監看的是 `<main>/.git/worktrees/`（驗 4.1 的 commondir —— 少了那一層會 watch 一個**永不存在**的目錄，chokidar 不報錯、不發事件）
- [x] 4.8 單元測試：重複掃描不累積 watcher（worktree 清單不變時不重建）

## 5. 視覺化的適配

- [x] 5.1 餵給 `buildLanes` 的 `GraphData`，其 change 節點識別碼正規化為 `change:<slug>`（剝掉 worktree key）；`SpecGraph` 仍拿原始的聚合識別碼（design D10）
- [x] 5.2 回報 upstream：`@spekjs/ui` 的 `SpecGraph` 會剝 key 而 `buildLanes` / `changeTopicsMap` 不會 —— spek web 自己的 Timeline 在聚合模式下應有同樣問題（已開 [spekhq/spek#25](https://github.com/spekhq/spek/issues/25)，附最小重現）

## 6. 續寫入口的第 4 個條件

- [x] 6.1 續寫入口的可用性判定加入「錨定 change 的**來源工作目錄即該 session 所屬 folder 本身**」（即 `worktree.isFolderRoot`，**不是 `isMain`**）；不成立時**停用並說明原因**（既有紀律：SHALL NOT 消失）
- [x] 6.2 條件所需的來源自「本 change 視圖已取得的 `ChangeDetailView`」取得，不另開資料流（design D11）
- [x] 6.3 停用原因的文案加入 `src/shared/i18n/en.json`（英文、不得含 CJK）

## 7. UI：來源標示

- [x] 7.1 來源標示元件：`isMain` 不呈現、git 顯示 `branch`、detached 顯示固定字樣、**不提供路徑 tooltip**（design D9）
- [x] 7.2 瀏覽視圖的 Changes 樹與**本 change 視圖**皆套用該標示
- [x] 7.3 相關文案與 `aria-label` 一律取自字典（`aria-label` 同時是 probe 的選擇器 —— 硬編會讓探針靜默選不到元素）
- [x] 7.4 窄欄下的排版確認：分支名過長時截斷為純呈現，不影響識別

## 8. 驗收

- [x] 8.1 `probe:openspec` 的 fixture 擴充為真 git repo：`git init` + commit + `git worktree add`，並在 worktree 中建立一個**只存在於該 worktree** 的 change。**不需刻意造分歧** —— 只存在於一處的 slug 本來就會勝出；要造分歧的是「worktree 的副本贏過 main」，本 change 沒有那條 scenario
- [x] 8.2 斷言：該 change 出現在側欄，**且**帶有非 main 的來源標示，**且**它不存在於主 repo 的 `openspec/changes/` 底下（缺最後一條就是假綠 —— worktree ≤ 1 時 core 會靜默退回非聚合）
- [x] 8.3 斷言：來自主工作目錄的 change **不**呈現來源標示（與 8.2 成對，證明標示有鑑別力而非恆常呈現）
- [x] 8.4 斷言：worktree 中的 change 被改動後側欄自行更新（不手動重新整理）
- [x] 8.5 斷言：來源為另一個工作目錄的 change，其續寫入口呈現為停用並說明原因
- [x] 8.6 斷言：邊界外 worktree（fixture 建在系統暫存目錄）的 change 內容完整，但不呈現檔案導覽入口；邊界內 worktree 的 change 則呈現該入口並可跨身分導覽（成對，否則「入口不見」可能只是它壞了）
- [x] 8.7 斷言：開啟 Timeline 並啟用依 topic 分組後，change 落在其對應 topic 的分組，而非全部落在「無 topic」（驗 5.1）
- [x] 8.8 既有斷言的回歸確認：無 worktree 的 fixture 行為與改動前相同
- [x] 8.9 `npm run typecheck` 與 `npm test` 全綠
- [x] 8.10 `npm run probe:openspec` —— 迭代時以單一模式進行，完成後完整跑一次（dev + build）
- [x] 8.11 `npm run probe:core` —— 驗 1.5 的「掃描摘要不變」確實成立（白名單／格式守衛正是「你改了卻沒告訴它」時會抓到你的那種）

## 9. 文件

- [x] 9.1 `CLAUDE.md` 補上本 change 的段落：聚合的責任歸屬在 core、**commondir 那一層**（folder 是 worktree 時 watch 到永不存在的目錄）、兩層 watcher 的雞生蛋、`Omit` 保流穿的 DTO 設計、**`isMain` 與 `isFolderRoot` 是兩個不可互代的判準**、`buildLanes` 不剝 key 的靜默退化、`schemaOrder` 快取不跨 worktree 的實測、以及「worktree ≤ 1 時 core 靜默退回非聚合」這個假綠來源
