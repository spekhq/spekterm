# openspec-data-access Specification

## Purpose
TBD - created by archiving change openspec-side-panel. Update Purpose after archive.
## Requirements
### Requirement: 主行程為每個 workspace folder 供應 OpenSpec 結構

主行程 SHALL 以 `@spekjs/core` 為**每個 workspace folder** 供應其 OpenSpec 結構，並經 IPC 送達 renderer。

供應的資料 SHALL 涵蓋側欄所需的全部維度：概覽（spec 數、change 數、tasks 統計）、spec 清單、單一 spec 的
內容與相關 change、change 清單（含 tasks 進度）、單一 change 的完整內容（artifacts、tasks、delta specs）、
某個 change 當下的 spec 版本、以及 spec ↔ change 的關係圖。

供應的範圍 SHALL 為**該 folder 所屬 repo 的全部工作目錄**（主工作目錄與 linked worktree），而非僅
該 folder 根目錄下的 `openspec/` —— 詳見 `worktree-aggregation`。concept 上這仍是「該 folder 的
OpenSpec 結構」：定址的單位不變，只是它涵蓋的來源不只一個。

掃描 SHALL 在主行程內以行程內函式呼叫完成 —— 不啟動 HTTP server、不委派給常駐的外部服務行程
（延續 `spek-core-integration` 的既有要求）。

#### Scenario: 取得含 openspec 的 folder 的結構

- **WHEN** renderer 為一個含 `openspec/` 的 folder 請求其 OpenSpec 結構
- **THEN** 主行程回傳該 folder 的 spec 清單、active change 清單與 archived change 清單

#### Scenario: 取得單一 change 的完整內容

- **WHEN** renderer 為一個已存在的 change slug 請求其內容
- **THEN** 主行程回傳該 change 的 artifacts，其中 tasks 為解析後的結構（含各 section 的項目與完成狀態），
  delta specs 為各 topic 的內容

#### Scenario: 取得 spec 與 change 的關係圖

- **WHEN** renderer 為一個 folder 請求關係圖
- **THEN** 主行程回傳 spec 與 change 的節點，以及 change 動到哪些 spec 的邊

#### Scenario: 不含 openspec 的 folder

- **WHEN** renderer 為一個不含 `openspec/` 的 folder 請求其 OpenSpec 結構
- **THEN** 主行程回傳空的結構，而非失敗

#### Scenario: change 位於 linked worktree

- **WHEN** renderer 為一個 folder 請求 change 清單，而該 repo 的某個 change 只存在於一個
  linked worktree
- **THEN** 回傳的 change 清單包含該 change

### Requirement: renderer 以 folderId 定址 OpenSpec 資料，絕不接觸絕對路徑

OpenSpec 的每一個 IPC method SHALL 以 `folderId` 作為定址的起點，SHALL NOT 接受來自 renderer 的絕對路徑。
主行程 SHALL 由已加入的 folder 清單解析 `folderId` 為實際路徑。

回傳給 renderer 的 DTO 中，任何指向檔案的路徑欄位 SHALL 為**相對於該 folder root** 的相對路徑，
SHALL NOT 為絕對路徑 —— core 回傳的是絕對路徑，主行程 SHALL 負責轉換。

轉換後落在 folder root 之外的路徑 SHALL 以 `null` 呈現，SHALL NOT 以絕對路徑呈現。
少一個「跳到檔案」的入口，好過洩漏一個 workspace 之外的位置。

這延續 `filesystem-access` 的邊界語彙：renderer 沒有詞彙可以表達 workspace 之外的位置。

#### Scenario: IPC 不接受絕對路徑

- **WHEN** 檢視 OpenSpec 的 IPC 契約
- **THEN** 每個 method 的定址參數為 `folderId`，且無任何參數接受絕對路徑

#### Scenario: 回傳的路徑為 folder-relative

- **WHEN** renderer 取得一份 spec 清單
- **THEN** 每個 spec 的檔案路徑為相對於該 folder root 的相對路徑

#### Scenario: 未知的 folderId

- **WHEN** renderer 以一個不存在於 folder 清單中的 `folderId` 發出請求
- **THEN** 主行程回傳失敗結果，且不進行任何檔案系統存取

### Requirement: change slug 與 spec topic 以查表方式使用，不得直接拼接路徑

`slug` 與 `topic` 是來自 renderer 的不受信任輸入，且會被 core 用於拼接檔案路徑。主行程 SHALL 先確認
該 identifier **存在於該 folder 的掃描結果之中**，才對它呼叫 core。

掃描結果中不存在的 `slug` / `topic`，主行程 SHALL 回傳失敗結果，且 SHALL NOT 呼叫 core、SHALL NOT
進行任何以該 identifier 拼接而成的檔案系統存取。

這是白名單而非黑名單 —— 過濾危險字元（`..`、路徑分隔符）總有漏網的編碼形式，而「只有掃描確實發現的
change / spec 才可讀」沒有這個問題。

#### Scenario: 以 traversal 形式的 slug 請求 change

- **WHEN** renderer 以一個含有上層目錄語意（如 `../../../etc`）的 slug 請求 change 內容
- **THEN** 主行程回傳失敗結果，且未讀取該 folder 之外的任何檔案

#### Scenario: 以不存在的 topic 請求 spec

- **WHEN** renderer 以一個掃描結果中不存在的 topic 請求 spec
- **THEN** 主行程回傳失敗結果

#### Scenario: 以存在的 slug 請求 change

- **WHEN** renderer 以一個掃描結果中存在的 slug 請求 change 內容
- **THEN** 主行程回傳該 change 的內容

### Requirement: 失敗以結果物件跨越 IPC，不以例外傳遞

OpenSpec 的 IPC method SHALL 以結果物件（成功／失敗二選一，失敗帶錯誤碼）回應 renderer，
SHALL NOT 依賴拋出例外來傳遞失敗。

理由與 `filesystem-access` 相同：Electron 的 IPC 序列化只保留錯誤的 `message`，自訂屬性（錯誤碼、細節）
一律遺失，renderer 因而無法區分失敗的種類。

#### Scenario: 失敗帶有可辨識的錯誤碼

- **WHEN** 一次 OpenSpec 的 IPC 請求失敗
- **THEN** renderer 收到一個標示失敗的結果物件，其中含有可據以分辨失敗種類的錯誤碼

### Requirement: 掃描結果快取，並於 openspec 目錄變更時失效並通知 renderer

主行程 SHALL 快取每個 folder 的掃描結果 —— 側欄的多個視圖會反覆請求同一份結構，而掃描需要遞迴讀取
目錄並取得 git 時間戳。

主行程 SHALL 監看該 folder 涵蓋範圍內**每一個工作目錄**的 `openspec/` 目錄，並 SHALL 另外監看
**工作目錄清單本身**（見 `worktree-aggregation`）。上述任一處發生檔案變更時，主行程 SHALL 使該
folder 的快取失效，並 SHALL 通知 renderer 該 folder 的 OpenSpec 結構已變更。

通知 SHALL 對連續發生的變更事件合併後送出（debounce）—— agent 的一次操作會寫入數個檔案，逐一通知會使
側欄在極短時間內反覆重新載入。

監看 SHALL NOT 跟隨 symlink 走出 folder 邊界（延續 `file-explorer` 對 watcher 的既有約束）。**此約束
的對象是 symlink 的展開** —— 一個由 repo 內容決定的、不受信任的路徑；它 SHALL NOT 被詮釋為禁止監看
由版控系統列舉出的工作目錄，即使該工作目錄位於 folder 邊界之外。兩者的差別在於路徑的來源是否可信，
以及是否有路徑會流向 renderer（見 `worktree-aggregation`）。

這個 app 的前提是旁邊有 agent 一直在寫檔 —— 側欄 SHALL NOT 是啟動時的快照。

#### Scenario: agent 改動 change 後側欄資料更新

- **WHEN** 某個 folder 的 `openspec/changes/` 下有檔案被外部程式改動
- **THEN** renderer 收到該 folder 的 OpenSpec 結構已變更的通知，且後續請求取得的是改動後的內容

#### Scenario: 連續變更合併為單次通知

- **WHEN** 某個 folder 的 `openspec/` 下在極短時間內有多個檔案被改動
- **THEN** renderer 收到的通知次數少於檔案變更的次數

#### Scenario: 重複請求不重複掃描

- **WHEN** renderer 在 `openspec/` 未發生任何變更的情況下，對同一個 folder 連續發出多次結構請求
- **THEN** 主行程不為每次請求重新掃描檔案系統

#### Scenario: linked worktree 中的變更觸發更新

- **WHEN** 某個 linked worktree 的 `openspec/` 下有檔案被外部程式改動
- **THEN** renderer 收到該 folder 的 OpenSpec 結構已變更的通知

### Requirement: OpenSpec 的資源以擁有者的生命週期釋放

OpenSpec 的快取、監看與訂閱 SHALL 以擁有它們的 `webContents` 為生命週期單位。該 `webContents` 被銷毀，
或該 renderer 重新載入（導航）時，主行程 SHALL 釋放屬於它的監看與訂閱。

renderer 重新載入時，舊的訂閱者已不復存在 —— 未釋放的監看會成為無人接收的事件來源。

#### Scenario: renderer 重新載入後不留下孤兒監看

- **WHEN** renderer 重新載入
- **THEN** 屬於舊 renderer 的 OpenSpec 監看被釋放

#### Scenario: 視窗關閉後不留下孤兒監看

- **WHEN** 視窗被關閉
- **THEN** 屬於該視窗的 OpenSpec 監看被釋放

