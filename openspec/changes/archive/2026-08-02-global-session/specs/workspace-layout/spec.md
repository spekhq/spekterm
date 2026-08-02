## ADDED Requirements

### Requirement: 主舞台為選中的全域項目呈現其 session 分頁列

選中的 rail 項目為**全域項目**時，主舞台 SHALL 為它呈現 session 的分頁列，其行為 SHALL 與
「主舞台為當前 repo 呈現 session 分頁列」所定義者相同：標示 focused session、提供切換、提供可選
spawn 目標的建立入口（緊鄰最後一個分頁之後）、每個分頁可關閉、每個分頁提供含重新命名與關閉的
右鍵選單，尚無 session 時呈現空狀態與明顯的建立入口。

分頁列 SHALL 僅呈現當前選中之 rail 項目的 session —— 全域 session 與各 folder 的 session
SHALL NOT 混列於同一個分頁列。

rail 的全域項目之下 SHALL 呈現其 session 子列，並提供建立與關閉 session 的入口，其行為與 folder
的 session 子列相同。

#### Scenario: 選中全域項目時呈現其分頁列

- **WHEN** 使用者選中全域項目，而它已有數個 session
- **THEN** 分頁列為每個全域 session 呈現一項，且不含任何 folder 的 session

#### Scenario: 全域項目尚無 session 時呈現屬於它的空狀態

- **WHEN** 使用者選中尚無任何 session 的全域項目
- **THEN** 該區域呈現空狀態與明顯的建立 session 入口
- **AND** SHALL NOT 呈現「尚未選擇 repo」之類要求使用者先選一個 rail 項目的訊息 —— 他已經選了

#### Scenario: 自 rail 的全域項目建立 session

- **WHEN** 使用者於 rail 的全域項目觸發建立 session 的入口並選擇一個 spawn 目標
- **THEN** 全域項目被選中，新 session 建立並成為 focused

#### Scenario: 切換至 folder 後分頁列不再含全域 session

- **WHEN** 使用者由全域項目切換至某個 folder
- **THEN** 分頁列僅呈現該 folder 的 session

#### Scenario: 全域項目的 header 與 repo 的 header 可區分

- **WHEN** 使用者選中全域項目
- **THEN** 主舞台的 header 呈現全域項目的身分，而非任何 folder 的名稱或路徑

### Requirement: 切換至全域項目時 focused session 落在它最後聚焦過的 session

「切換當前 repo 時，focused session 落在該 repo 最後聚焦過的 session」所定義的記憶 SHALL 同等
適用於全域項目：系統 SHALL 為全域項目記住它最後聚焦過的 session，切換至它時 focused session
SHALL 落在那一個。

此行為 SHALL NOT 取決於切換的手段（點選 rail 或以鍵盤切換），且該記憶 SHALL NOT 持久化。

#### Scenario: 切走再切回全域項目

- **WHEN** 使用者於全域項目聚焦其第二個 session，切換至某個 folder，再切回全域項目
- **THEN** 全域項目的 focused session 為其第二個 session

## MODIFIED Requirements

### Requirement: OpenSpec 為條件式身分，Files 恆可用

OpenSpec 身分的入口 SHALL 於**側欄來源已選定、且該來源 repo 不含 `openspec/`** 時為停用狀態，
且該狀態 SHALL 可被輔助技術辨識。Files 身分 SHALL 恆為可用。

**側欄來源尚未選定時**（`global-session` 的全域項目其預設狀態），OpenSpec 身分 SHALL 為**可用** ——
它要呈現的正是「請選一個 repo」的空狀態（見 `openspec-panel`）。**以「有沒有 folder 可讀」作為停用
條件會使該空狀態永遠到不了**：身分被停用並強制退回 Files，而 Files 在同一個狀態下也是空的，於是
側欄整塊沒有任何入口，使用者無從得知「選一個 repo 就有了」。

這是「spek 以 OpenSpec 為核心，但版面不因缺少 OpenSpec 就殘廢」的體現 —— 使用者應在點擊之前就知道
該 repo 只能以 Files 身分使用。**而「還沒選」與「選了但沒有 openspec/」是兩件不同的事**：前者是尚未
作出的選擇（可用，並告訴他怎麼選），後者是該 repo 的性質（停用）。

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** OpenSpec 身分的入口為停用狀態，Files 身分的入口為可用狀態

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder
- **THEN** OpenSpec 與 Files 兩個身分的入口皆為可用狀態

#### Scenario: 側欄來源未選定時 OpenSpec 身分可用

- **WHEN** 使用者選中全域項目，而其側欄來源尚未選定
- **THEN** OpenSpec 身分的入口為可用狀態，且可被切換至

#### Scenario: 停用的身分不可被切換至

- **WHEN** 使用者觸發一個停用的身分入口
- **THEN** side panel 的當前身分不改變

### Requirement: side panel 的預設身分為 OpenSpec

選中的 rail 項目其 OpenSpec 身分為可用狀態時，side panel 的預設身分 SHALL 為 **OpenSpec**。
OpenSpec 身分為停用狀態時（側欄來源已選定且該 repo 不含 `openspec/`），預設身分 SHALL 為 Files。

**側欄來源尚未選定時預設身分 SHALL 為 OpenSpec** —— 依上一條它是可用的，而它的空狀態正是引導
使用者選一個來源的地方。

這是 `docs/workspace-mockup.html` 的預設（`#content-openspec` 為初始顯示的內容）。此前實作暫以 Files 為
預設，理由是 OpenSpec 身分尚無內容可顯示 —— 該理由已不復存在。

**OpenSpec 是這個工作台的主張**：使用者加入一個有 `openspec/` 的 repo，預期看到的是它的 spec 與 change，
而不是一棵他在 IDE 裡已經看膩的檔案樹。

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder，且尚未手動切換過身分
- **THEN** side panel 呈現 OpenSpec 身分的內容

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** side panel 呈現 Files 身分的內容

#### Scenario: 選中來源未選定的全域項目

- **WHEN** 使用者選中全域項目，其側欄來源尚未選定，且尚未手動切換過身分
- **THEN** side panel 呈現 OpenSpec 身分的空狀態
