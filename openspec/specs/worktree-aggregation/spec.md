# worktree-aggregation Specification

## Purpose
TBD - created by syncing change openspec-worktree-aggregation. Update Purpose after archive.
## Requirements
### Requirement: 側欄的 OpenSpec 資料涵蓋 folder 所屬 repo 的全部 git worktree

主行程為一個 workspace folder 供應 OpenSpec 結構時，其涵蓋範圍 SHALL 為**該 folder 所屬 repo 的
全部 git worktree**，而非僅該 folder 根目錄下的 `openspec/`。

「每個 change 各自開一個 worktree」是一種真實的工作流。在那種佈局下，使用者正在開發的 change
**不在**主工作目錄的 `openspec/changes/` 底下 —— 側欄若只看根目錄，對使用者的主線工作恆為空。

同一個 change slug SHALL 在**同一份清單內**（active 或 archived）至多出現一次。

**跨清單則不保證**：一個 slug 在主工作目錄已封存、而某個 worktree 仍持有其 active 版本時，
它 SHALL 同時出現於 active 與 archived —— 這在「一個 change 一個 worktree」的工作流裡是常態，
且它**如實反映了磁碟上的狀態**。此時以該 slug 讀取內容 SHALL 解析到 active 的那一份。

本階段涵蓋 **git worktree**；jj（Jujutsu）workspace 不納入。

#### Scenario: worktree 裡的 change 出現在側欄

- **WHEN** 一個 folder 所屬的 repo 有一個 linked worktree，該 change 只存在於該 worktree 的
  `openspec/changes/` 底下
- **THEN** 側欄的 change 清單包含該 change
- **AND** 該 change **不存在**於主工作目錄的 `openspec/changes/` 底下

#### Scenario: 同一個 change 在多個 worktree 中只出現一次

- **WHEN** 同一個 change slug 同時以 active 狀態存在於主工作目錄與某個 linked worktree
- **THEN** active 清單中該 slug 只出現一次

#### Scenario: 一處已封存、另一處仍在進行的同名 change

- **WHEN** 某個 slug 在主工作目錄已封存，而某個 linked worktree 仍持有其 active 版本
- **THEN** 該 slug 同時出現於 active 與 archived 清單
- **AND** 以該 slug 請求內容時取得的是 active 的那一份

#### Scenario: 單一工作目錄的 repo 行為不變

- **WHEN** 一個 folder 所屬的 repo 沒有任何 linked worktree
- **THEN** 側欄呈現的 spec 與 change 與未支援聚合前相同

### Requirement: 涵蓋範圍與去重的判定委由 core，不自行實作

涵蓋範圍與去重的判定 SHALL 全部由 `@spekjs/core` 的聚合掃描決定 —— 包含 worktree 的列舉、
active change 的去重（含判定哪一個副本勝出）、archived change 的去重、以及 spec 取自哪一個
工作目錄。

本 app SHALL NOT 自行實作 worktree 的列舉或去重邏輯 —— 那會產生一套與 core 平行、會隨版本靜默
分歧的第二實作，而它的失效方式是「側欄顯示的 change 集合與 spek 不一致」，沒有任何測試會自動
發現。

掃描 SHALL 在主行程內以行程內函式呼叫完成（延續 `openspec-data-access` 與 `spek-core-integration`
的既有要求）。

#### Scenario: 掃描結果未經本 app 二次過濾

- **WHEN** 同一個 repo 分別以本 app 與 `@spekjs/core` 的聚合掃描取得 active change 清單
- **THEN** 兩者的 slug 集合相同 —— 本 app 既不補加、也不濾除任何 change

### Requirement: spec 的讀取以主工作目錄為準

讀取單一 spec 的內容時，讀取根 SHALL 為該 repo 的**主工作目錄** —— 聚合掃描供應的 spec 清單即
取自該處。讀取根 SHALL NOT 假設它等於該 folder 的路徑。

folder 可能是該 repo 的一個 linked worktree、或其中一個子目錄 —— 兩種情形下 folder 的路徑都不是
主工作目錄，沿用它會使 spec **列得出來卻打不開**。

#### Scenario: folder 是 linked worktree 時 spec 仍可讀取

- **WHEN** 一個 folder 本身是該 repo 的 linked worktree，使用者請求一個只存在於主工作目錄的
  spec 的內容
- **THEN** 主行程回傳該 spec 的內容，而非「找不到」

### Requirement: change 的來源以識別碼與分支呈現，絕不以絕對路徑

每一個 change SHALL 帶有其來源工作目錄的資訊，該資訊 SHALL 由**穩定識別碼**、**分支名稱**、
**是否為主工作目錄**、**版控系統種類**構成。

送往 renderer 的資料 SHALL NOT 包含來源工作目錄的絕對路徑（延續 `openspec-data-access` 的
「renderer 絕不接觸絕對路徑」）。

renderer SHALL NOT 需要以工作目錄作為定址的維度 —— 讀取某個 change 的內容時，其來源由主行程
自掃描結果解析，IPC 的入參 SHALL 維持僅以 `folderId` 與 `slug` 定址。

#### Scenario: 來源資訊不含絕對路徑

- **WHEN** renderer 取得含來源資訊的 change 清單
- **THEN** 來源資訊包含識別碼與分支名稱
- **AND** 其中沒有任何欄位是絕對路徑

#### Scenario: 讀取 worktree 中的 change 不需額外的入參

- **WHEN** renderer 以 `folderId` 與一個只存在於 linked worktree 的 change slug 請求該 change
  的完整內容
- **THEN** 主行程回傳該 change 位於該 worktree 中的內容

### Requirement: 工作目錄位於 folder 邊界外時資料完整，僅檔案導覽降級

worktree 的實體位置 SHALL NOT 限制 change 資料的完整性 —— 工作目錄位於 folder 邊界之外（例如
`/tmp`）時，該 change 的內容、tasks 進度與 spec deltas SHALL 與位於邊界內時相同。

指向檔案的路徑欄位無法翻譯為 folder-relative 時 SHALL 為 `null`，其對應的檔案導覽入口 SHALL NOT
呈現（延續既有的「翻不出來就回 null」原則）。

**檔案導覽入口存在時 SHALL 為雙向**：自該 change 的 artifact 可跳至其底層檔案，且自 Files 身分
中該檔案可跳回 OpenSpec 身分。**同一個檔案去得了就必須回得來** —— 單向的導覽在使用者眼中是壞掉
的，而非「只支援一半」。這條與本 requirement 的降級規則相合：邊界外的工作目錄兩個方向都沒有入口。

#### Scenario: 邊界外 worktree 的 change 內容完整

- **WHEN** 一個 change 只存在於位於 folder 邊界外的 worktree
- **THEN** 側欄呈現該 change 的 artifacts 與 tasks 進度

#### Scenario: 邊界外 worktree 的 change 不提供檔案導覽入口

- **WHEN** 使用者檢視一個來源位於 folder 邊界外的 change
- **THEN** 該 change 及其 artifact 不呈現「在 Files 中開啟」之類的檔案導覽入口

#### Scenario: 邊界內 worktree 的 change 可跨身分導覽

- **WHEN** 使用者檢視一個來源位於 folder 邊界內的 worktree 的 change 的某個 artifact
- **THEN** 該 artifact 提供檔案導覽入口，且觸發後於 Files 身分開啟該檔案

#### Scenario: 邊界內 worktree 的檔案可跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 folder 邊界內 worktree 的
  `openspec/changes/<slug>/` 之下的檔案
- **THEN** 該檔案提供跳回 OpenSpec 身分的入口，且觸發後呈現該 change

#### Scenario: 邊界外 worktree 的檔案不在該 folder 的檔案樹中

- **WHEN** 一個 change 只存在於位於 folder 邊界外的 worktree
- **THEN** **該 folder** 的檔案樹不呈現該 worktree 的任何檔案（它們沒有 folder-relative 路徑），
  因此不存在需要跳回 OpenSpec 身分的檔案

### Requirement: 視覺化的既有行為不因聚合而退化

關係圖與 Timeline 在聚合之後 SHALL 維持其既有行為 —— 特別是 Timeline 的**依 spec topic 分組**
SHALL 持續有效。

聚合掃描產生的關係圖，其 change 節點的識別碼帶有來源工作目錄的識別碼，且節點上附帶完整的
來源資訊。送往 renderer 之前，主行程 SHALL 完成下列**兩件事**：

1. change 節點的識別碼 SHALL 還原為**非聚合形式**（不含來源工作目錄的識別碼）；
2. 節點 SHALL NOT 附帶來源工作目錄的資訊（其中含絕對路徑，見「change 的來源以識別碼與分支
   呈現，絕不以絕對路徑」）。

**這兩件事是同一件事的兩面，SHALL NOT 只做其中一半。** 還原識別碼所需的資訊就在來源裡；
一旦來源被移除，renderer 便無從自行還原。只做第二件而不做第一件，其失效方式是
**畫面照樣畫得出來、分組卻靜靜地全部落到「無 topic」**，不會有任何錯誤。

還原 SHALL 在來源資訊尚存時完成，並 SHALL 以來源提供的識別碼為判準 —— 識別碼單獨看無法分辨
「來源的識別碼」與「slug 的開頭」，因此 slug 本身含分隔字元時 SHALL 仍完整還原。

邊（edge）以識別碼引用節點，因此其 **change 端** SHALL 與節點一併還原：消費端是先以邊的端點
查出節點、再讀取節點的識別碼，只還原節點會使查表全數落空，其症狀與完全未還原相同。

> 此處**只約束 change 端**是刻意的。關係圖的 spec 節點來自**已納入 specs 的 capability**，
> 而一個 change 的 delta 可以提議一個**尚未納入**的 topic —— 於是「change 指向一個不存在的
> spec 節點」是**合法且有意義的狀態**，它表達的正是「這個 change 提議一個新 capability」。
> 本 change 自己就是一例。
>
> **這與聚合無關**（非聚合掃描同樣會產生這種邊，已實測），因此它既不是本能力要處理的事，
> 也不該由本 app 過濾掉 —— 本能力另有一條 requirement 明文禁止對掃描結果二次過濾。
> 消費端 SHALL 容忍這種邊（我們使用的關係圖元件自身即已忽略端點無法解析的邊）。

#### Scenario: 聚合後 Timeline 仍依 topic 分組

- **WHEN** 一個含多個工作目錄的 repo，其 change 動到了某些 spec topic，使用者開啟 Timeline
  並啟用依 topic 分組
- **THEN** change 被歸入其對應 topic 的分組，而非全部落在「無 topic」

#### Scenario: 送往 renderer 的關係圖已還原識別碼且不含來源

- **WHEN** renderer 為一個含多個工作目錄的 repo 請求關係圖
- **THEN** 每個 change 節點的識別碼為非聚合形式
- **AND** 節點上沒有來源工作目錄的資訊
- **AND** 每條邊的 change 端都對得到一個節點

### Requirement: 監看範圍涵蓋每個工作目錄與工作目錄清單本身

主行程 SHALL 監看**每一個**工作目錄的 `openspec/` 目錄，而不僅是 folder 根目錄的那一個。

主行程 SHALL 另外監看**工作目錄清單本身**。工作目錄是「先建立目錄、後寫入 change」——僅監看
既有工作目錄的 `openspec/` 時，一個新建工作目錄的第一次寫入沒有任何監看者在場，側欄要等到
不相干的事件才會更新。

對工作目錄的監看 SHALL NOT 使既有的「監看不得跟隨 symlink 走出 folder 邊界」失效：該約束的
對象是**不受信任的 symlink 展開**，而工作目錄是版控系統列舉出的已知位置；由監看推送給 renderer
的 SHALL 僅為「該 folder 的 OpenSpec 結構已變更」，SHALL NOT 包含任何路徑。

#### Scenario: worktree 中的 change 被改動後側欄更新

- **WHEN** 外部程式改動了某個 linked worktree 的 `openspec/` 底下的檔案
- **THEN** renderer 收到該 folder 的 OpenSpec 結構已變更的通知
- **AND** 後續請求取得的是改動後的內容

#### Scenario: 新建的 worktree 被納入

- **WHEN** 在 app 執行期間為該 repo 新建一個 linked worktree，並於其中新增一個 change
- **THEN** 側欄的 change 清單出現該 change，使用者無需手動重新整理

#### Scenario: 監看事件不攜帶路徑

- **WHEN** 位於 folder 邊界外的工作目錄中有檔案被改動
- **THEN** 推送給 renderer 的通知僅識別該 folder，不含任何檔案路徑
