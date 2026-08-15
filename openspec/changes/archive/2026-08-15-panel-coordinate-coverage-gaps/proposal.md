# 補上 panel-coordinate-per-folder 的三個驗收缺口

## Why

`panel-coordinate-per-folder`（已封存，commit `e5f360b`）交付時有三條 scenario **刻意未做驗收**
（issue #10）。三者的常見路徑都有既有覆蓋，缺的是邊角那一支 —— 但每一條都對應規格裡一條真實的
scenario，留著就是**零覆蓋**。

**現在做的理由是它是 issue #12 的前置。** #12 要讓稽核腳本對每一條新增的 scenario 要求驗收指認，
而這三條正是它上線時第一批會報紅的存量。先清償，#12 才有一個乾淨的基線可用；反過來先做 #12，
就得先設計「既有存量怎麼豁免」—— 而豁免機制正是這條紀律最容易被鑽的洞。

三條缺口裡有兩條不只是「漏了一條斷言」，而是**既有斷言對錯誤實作一樣會通過**：

- 第 1 條：既有覆蓋落在「側欄來源即 focused folder」的情形，那時跨項目寫入**等於不變** ——
  一個「總是寫進 focused folder」的錯誤實作照樣全綠。
- 第 2 條：該 requirement 是**無條件的 SHALL**，而它在本 change 之前**於無 session 時根本沒有
  兌現**（呼叫點包在 `if (focusedId)` 裡），驗收一律先建 session，於是那一支零覆蓋。

## What Changes

- **補第 1 條的載體**：把側欄來源指向 `repo-worktree` 之後再觸發「於該工作目錄開啟 session」的
  入口，切 rail focus 過去斷言錨定寫在**來源 folder**。此為整個 `panel-coordinate-per-folder`
  **唯一的跨項目寫入**，其失效是靜默的。判準只取正向 —— 反向的「選中那一筆未被寫入」無論怎麼
  寫都沒有鑑別力，理由見 design D4。
- **補第 2 條的載體**：在 `probe:openspec` 的 worktree 段落、於該 repo **建立任何 session 之前**
  做一次跨身分導覽，以**兩條並列**斷言 Files 的樹根確實切到該 worktree。
- **補第 3 條的載體**：新增一個自帶 profile 的**獨立段落**，以構造的落盤內容（`panel.json` 指向
  一個不存在的 folder 識別碼）啟動，斷言側欄來源退回自身且應用程式正常啟動。該 scenario 的措辭
  本就是「於應用程式**未開啟期間**被移出 workspace」，因此**不需要**在執行中移除 folder。
- **三條驗收紀律寫進 spec**，讓對應的假綠機制**下次表達不出來**（見 Capabilities）。
- **不動產品程式碼** —— 三條的實作都已由 `panel-coordinate-per-folder` 交付並仍在原處。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `artifact-continuation`：新增一條驗收紀律 —— 錨定的**跨項目寫入**，其驗收 SHALL 以「側欄來源
  與 rail 上選中的 folder 為**不同兩筆**」進行，且判準 SHALL 為正向的。
- `side-panel-worktree`：新增一條驗收紀律 —— 標示為無條件的跨身分導覽要求，其驗收 SHALL 涵蓋
  「該 repo 尚無任何 session」那一支，並以兩條並列斷言樹根。
- `side-panel-source`：新增一條驗收紀律 —— 「落盤座標不再有效時退回預設」這一類條款，其驗收
  SHALL 以構造的落盤內容進行，且該內容 SHALL 另含一筆合法且非預設的條目作為鑑別力來源。

## Impact

- **探針**：`scripts/probe-openspec.mjs` —— `runWorktreeAggregation`（第 1、2 條）、`seedProfile`
  的擴充，以及一個**新增的獨立段落**（第 3 條；不宣告 `deps`、自帶 profile 與 app，形制照
  `probe-keyboard.mjs` 的 `checkEmptyWorkspace`）。該支因此多付一次應用程式啟動。
- **規格**：`artifact-continuation`、`side-panel-worktree`、`side-panel-source` 各一條驗收紀律。
- **文件**：CLAUDE.md「反覆重演的教訓」中「補一條 scenario 與覆蓋一條 scenario 是兩個動作」那條
  —— 標記 `panel-coordinate-per-folder` 的缺口已清償。
- **產品程式碼**：零改動。
- **不影響**：`npm test`（三條都不是單元測試能承擔的 —— 它們的判定分佈在 renderer 的
  `MainStage.tsx` 與落盤還原路徑上）。
