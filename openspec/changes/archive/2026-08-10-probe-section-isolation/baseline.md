# 切分前的基準

本檔案是 tasks 第 1 節的產出，供 3.3／4.3／5.4 的切分對照使用。

## 對照口徑：**build 模式的斷言總數與通過數**

**不使用完整一輪（含 dev）的總數。** 段落隔離會讓此前因中斷而未執行的段落開始執行，該總數
本來就會上升 —— 拿它對照會把「隔離生效」誤判成「切分改動了斷言」。此口徑已寫進
`specs/probe-execution-scope/spec.md` 的「段落切分不得改動斷言」。

## 基準

| 探針 | build 段斷言數 | 通過 | 來源 |
|---|---|---|---|
| `probe:terminal` | **126** | 126 | `PROBE_ONLY=*:build` 實測（166s） |
| `probe:keyboard` | **100** | 100 | 完整輪次輸出中 `── dev ──` 之前的區段 |
| `probe:openspec` | **225** | 225 | 完整輪次輸出中「開發模式（vite dev server）」之前的區段 |

## 這份基準的取得方式與限制

`probe:keyboard` 與 `probe:openspec` **目前沒有段落機制**，無法單獨執行 build 段 —— 這正是
tasks 第 2、4、5 節要補的東西。因此這兩支的基準是從一輪**完整執行的輸出**中，以模式分界線
切出 build 區段後計數得來，而非單獨執行。

**這個取法對「斷言總數」是可信的**：build 段在兩支上都完整跑完（`probe:openspec` 的中斷發生在
dev 段），而斷言總數是結構性的 —— 它由程式碼中的 `check()` 呼叫決定，不隨機器負載變動。

**已知限制**：

- 取得基準的那一輪，機器上有殘留的 electron／dev server／Xvfb（已於事後清除）。這**影響耗時、
  不影響斷言數**，而本基準只用斷言數。
- 耗時基準不在本檔案的範圍 —— 它由 tasks 8.3 在隔離完成後重新量測，因為隔離之後的耗時必然
  與現在不同（見 proposal 的警告）。

## 隔離之後的新基準（8.3，環境乾淨的一輪）

```
probe:native      1s  · core 6s · shell 2s · workspace 25s · files 68s
probe:keyboard  331s  完整執行   198/200
probe:openspec  130s  完整執行   450/450
probe:terminal  756s  不完整（dev:runMode 逾時 480s）  214/218
────────────────────────────────────────────
總計          ≈ 1319s ≈ 22 分鐘（8 支，未含 identity）
```

**跑的東西多了很多，時間反而變少**：

| | 隔離前 | 隔離後 |
|---|---|---|
| `probe:terminal` 斷言 | 126（dev 只跑 1/10 段） | **218**（dev 9/10 段通過） |
| `probe:openspec` 斷言 | 322（dev 中斷於 43%） | **450**（dev 完整且全綠） |
| 一輪總耗時 | 1537s | **1319s** |

變快的原因**不是本 change 讓探針變快了**，而是取得 1537s 的那一輪機器上有兩組孤兒 electron
（`probe:files` 的 dev server 孫行程、以及一組沒被收掉的 terminal profile）佔著 CPU ——
issue #17 記載的「等待窗口在負載下不夠」正是那個環境的產物。**這本身就是「不完整的輪次不能
拿來做判斷」的又一個實例**：那 1537s 既沒跑完，也是在污染的環境下量的。

### 兩個超出預期的結果

- **`probe:terminal` 的 9 個 dev 段落全部通過。** 它們在此之前從未執行過（`runMode` 一 throw
  就中斷整支）。這 92 條斷言是本 change 淨增的覆蓋。
- **`probe:openspec` 的 dev 段這次 450/450 全綠**，而 issue #19 記載它有兩條穩定失敗
  （「在 Files 身分中產生未存的編輯」）。在乾淨環境下未重現 —— **那兩條比較像 #17 的負載型，
  而不是 #19 宣稱的確定性失敗**。已回報至 #19。

### 仍然紅的

- `probe:keyboard` 198/200 —— issue #19 的兩條 `Ctrl+Tab`（`MOUNTED !== true`），乾淨環境下仍重現
- `probe:files` 109/111 —— issue #17 的兩條 dev worker
- `probe:terminal` `dev:runMode` 逾時 480 秒 —— 新發現，已開 issue

## 順帶記錄：dev 段的執行完整度（本 change 的動機）

同一輪輸出顯示 dev 段的執行遠不完整，這是本 change 存在的理由：

| 探針 | build 段 | dev 段 | dev 的完整度 |
|---|---|---|---|
| `probe:terminal` | 126 條（10 個段落） | `runMode` 一段後 throw | **1/10 段落** |
| `probe:openspec` | 225 條 | 97 條後 throw | **43%** |
| `probe:keyboard` | 100 條 | 100 條 | 完整（198/200，兩條紅） |

`probe:terminal` 的 dev 段耗時 771 秒 —— **那是 `runMode` 一段花掉的**，比 build 的全部 10 段
（166 秒）還貴 4.6 倍。本 change 前一版誤把它當成 21 個段落的總和而推導出錯誤的收益模型，
該教訓記於 `design.md` 的 Context。
