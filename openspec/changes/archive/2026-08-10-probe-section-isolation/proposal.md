# 探針的段落隔離與真實成本基準

## Why

**我們不知道 `npm run test:e2e` 的真實成本，因為它從來沒有跑完過。**

實測一輪 25.6 分鐘（8 支，未含 `probe:identity`），但其中**兩支在執行中途 throw，其後的段落
完全不執行**：

- `probe:terminal` 的 937 秒裡，dev 段只跑了 10 個段落中的 **1 個**（`runMode`）就在
  `openSessionViaMenu` throw；其餘 9 段一次都沒執行過。
- `probe:openspec` 的 209 秒在 `createSession` throw，worktree 聚合、反向導覽、quick-open
  整片沒跑（issue #17 已記載此形態）。

**一個會吞掉後續段落的失敗模式，同時毀掉兩件事**：驗收的完整性（沒有人知道那 9 段現在是不是
綠的），以及任何以耗時為基礎的最佳化判斷。

後者不是假設 —— **本 change 的前一版就是這麼垮的**。它的診斷是「dev 模式把整套斷言重跑一遍，
所以要收斂為白名單」，成本模型寫著「dev 段有 21 次 launch，771 ÷ 21 ≈ 每次 35 秒」，據此推出
省 47%。實測反證：那 771 秒**幾乎全部是 `runMode` 一段花掉的**，而它正是收斂方案要保留的段落。
真相是 **dev 的 `runMode` 一段比 build 的全部 10 段還貴 4.6 倍**（771s vs 166s）—— 成本的形狀
與那份診斷完全不同。

> **這是本 repo 已經重演過三次的教訓的第四次**：「一個方便取得、看起來相關的量，不等於規格
> 真正在乎的那個量。」而它這次特別難堪 —— 那一版 proposal 已經對 `probe:openspec` 標註了
> 「中途 throw 中斷，其實沒跑完」，**卻沒對 terminal 做同一個檢查**，儘管紅燈輸出裡就有那行
> Error。**同一個坑只補了一半。**

## What Changes

- **段落失敗逐段隔離。** 一個段落 throw 時記為該段的失敗並繼續下一段，不再中止整支探針。
  `run-probes.mjs` 早已為同一個理由選擇不 fail fast（「付了十幾分鐘就該拿到完整的一張圖」）
  —— 這條紀律此前只存在於**探針之間**，沒有落到**探針之內**。
- **段落依賴以宣告表達。** 前置段落失敗時，依賴它的段落標記為「未執行（前置失敗）」，而不是
  連鎖產生一堆紅燈。共用累積狀態的探針（`probe:openspec` 全程只有一次 `launch()`）少了這個
  區分，隔離只會把一次中斷換成一片噪音。
- **`probe:keyboard` 與 `probe:openspec` 補上段落結構**（目前只有 `probe:terminal` 有）。
  沒有段落就沒有「逐段」可言；順帶讓這兩支第一次有 `PROBE_ONLY` 可用（迭代時不必整支重跑）。
- **取得真實的成本基準**：一輪沒有中斷的完整執行，逐支耗時與逐段狀態。
- **`probe:*` 的 `npm run build &&` 提供跳過的開關**（只改探針腳本時是每次 14 秒的純浪費）。
- **移除文件中寫死的耗時數字**（`docs/lessons/probes.md:298` 的「一輪約 4 分鐘」實測為 15.6 分），
  改為指向執行輸出。

**明確不做**：

- **不做 dev 模式的收斂決策。** 那正是前一版垮掉的地方 —— 在拿到「dev 全跑要多久、哪些段落
  真的紅」之前，任何收斂方案都是在猜。收斂是本 change 的**後續**，不是本 change。
- **不平行化 `run-probes.mjs`。** issue #17 記載的正是「連續跑多支之後負載尖峰超出等待窗口」，
  平行只會放大它；且 `probe:identity` 與 `probe:files` 的 dev port 都是 9225（identity 另用
  9226，那是 terminal 的 BUILD_PORT）。
- **不刪任何一支探針。** 跨 probe 的同名斷言只有 5 條且全是 `app 掛載` 這類前置；最便宜的
  5 支（native / core / shell / workspace / files）合計 59 秒，佔 3.8%。刪任何一支都是純粹
  減少覆蓋而省不到時間。

## ⚠️ 這個 change 幾乎確定會讓 `test:e2e` 變**慢**

現在的 25.6 分鐘是**假的**：它有一大塊是「throw 之後不執行」省下來的。隔離之後那些段落會第一次
真的跑，一輪的時間會上升 —— `probe:terminal` 的 dev 段光是 `runMode` 一段就要 771 秒，另外
9 段從未執行過，總量無從估計。

**這是本 change 的目的而不是副作用。** 一個「快」是因為它沒跑完的驗收，比一個慢的驗收更糟：
它的綠燈涵蓋範圍未知。要先讓成本變成**已知**，才談得上壓縮它。

## Capabilities

### New Capabilities

- `probe-execution-scope`: 探針的執行範圍與失敗隔離 —— 段落結構、逐段錯誤隔離、依賴宣告、
  段落層級的執行選擇，以及「成本判斷不得以未完整執行的輪次為依據」這條紀律。

### Modified Capabilities

（無 —— 稽核過 `openspec/specs/` 下的 30 份 spec，沒有任何 requirement 規範探針的段落結構或
失敗處理。附帶更正一條前一版的錯誤宣稱：`desktop-packaging` 的「開發模式與打包產物使用不同的
使用者資料目錄」也要求兩種模式各驗一次，因此「只有 `workspace-app-shell` 要求兩種模式」是不準的
—— 那條的載體是 `probe:identity`，本 change 不碰。）

## Impact

**受影響的檔案**：

- `scripts/lib/sections.mjs`（新增）— 段落宣告、逐段隔離、依賴解析
- `scripts/probe-terminal.mjs` — 改用共用執行器（它現有的 `SECTIONS` 是這個模組的原型）
- `scripts/probe-keyboard.mjs` — 補段落結構
- `scripts/probe-openspec.mjs` — 切分 3000 行的單一 `runMode`
- `scripts/run-probe.mjs`、`package.json` — 建置跳過開關
- `docs/lessons/probes.md`、`CLAUDE.md` — 耗時數字、`PROBE_ONLY` 的適用範圍

**已實測、可作為後續判斷依據的數字**（這些查證過，與前一版垮掉的推算無關）：

```
probe:native 1s · core 6s · shell 2s · workspace 22s · files 28s   ← 合計 59s（3.8%）
probe:keyboard 332s（完整）· openspec 209s（中斷）· terminal 937s（dev 僅 1/10 段）
probe:terminal 只跑 build 段：166s，126/126 全綠
```

**切分 `probe:openspec` 的風險此版大幅降低**：前一版因為「dev 只跑白名單段落」而必須讓每個
段落自帶前置（實際上切不開 —— 錨定那段需要另一段選中的 repo），本版**每個段落在兩種模式下
都照跑**，切點只決定錯誤隔離的粒度，不決定誰被執行。狀態鏈因此保持完整。
