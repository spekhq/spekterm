# openspec-panel Specification

## Purpose
TBD - created by archiving change openspec-side-panel. Update Purpose after archive.
## Requirements
### Requirement: OpenSpec 身分呈現「本 change」與「瀏覽」兩個視圖

side panel 的 OpenSpec 身分 SHALL 於其內部提供兩個視圖的切換：**本 change** 與 **瀏覽**。
任一時刻 SHALL 恰有一個視圖被呈現，且當前視圖 SHALL 於切換入口上被明確標示。

兩個視圖於介面上的標籤為 **This change** 與 **Browse**（UI 的文案為英文，見 `ui-localization`）。
本規格以中文稱呼它們是概念上的指涉；scenario 中以英文標籤指名，指的是使用者實際看到的那個入口。

此切換為 OpenSpec 身分**內部**的第二層導航，與 side panel 的身分切換（`[◈ OpenSpec │ ▤ Files]`）
是不同層級。

視圖採**換頁而非並列**，理由與 Files 身分相同：side panel 的寬度不足以並列多個視圖。

Graph 與 Timeline **不是**這裡的視圖 —— 它們在全視窗 overlay 中呈現（見下）。

#### Scenario: 切換至瀏覽視圖

- **WHEN** 使用者於 OpenSpec 身分中觸發 **Browse** 視圖的入口
- **THEN** side panel 呈現瀏覽視圖，本 change 視圖的內容不再顯示，且 **Browse** 於入口上被標示為當前視圖

#### Scenario: 一次只顯示一個視圖

- **WHEN** 檢視 OpenSpec 身分的內容
- **THEN** 兩個視圖之中恰有一個被呈現

### Requirement: 本 change 視圖以分頁呈現該 change 的每一個 artifact

**本 change** 視圖 SHALL 為錨定 change 的**每一個 artifact**（proposal、design、tasks、specs
以及該 schema 定義的任何其他 artifact）各提供一個分頁，一次 SHALL 只顯示一個。

分頁的順序 SHALL 以該 change 的 schema 所宣告的順序為準；無法取得該順序時，SHALL 沿用資料來源的
預設順序。

artifact **SHALL NOT** 被省略 —— 使用者要讀的正是「這個 change 為什麼存在、打算怎麼做」。

視圖 SHALL 呈現 change 的識別（slug）與狀態（active／archived）。change 若有 tasks，其**完成數／
總數與進度條 SHALL 恆常可見**，SHALL NOT 只出現在 tasks 那一個分頁裡 —— 它是這個 change 的狀態
摘要，不論使用者正在讀哪個 artifact 都應看得到。

#### Scenario: 每個 artifact 各有一個分頁

- **WHEN** 錨定的 change 有 proposal、design、tasks 與 spec deltas
- **THEN** 本 change 視圖為每一個各提供一個分頁，且一次只顯示一個

#### Scenario: 進度不隨分頁切換而消失

- **WHEN** 使用者自 tasks 分頁切換到 proposal 分頁
- **THEN** 該 change 的 tasks 完成數與進度條仍然可見

#### Scenario: 分頁順序依 schema

- **WHEN** 該 change 的 schema 宣告了 artifact 的順序
- **THEN** 分頁依該順序排列

### Requirement: tasks 分頁呈現進度與分組的項目

tasks 分頁 SHALL 呈現**依 section 分組**的項目清單。每個項目 SHALL 標示其完成狀態；已完成的項目
SHALL 於視覺上與未完成者可區分。

#### Scenario: 依 section 分組

- **WHEN** 使用者檢視 tasks 分頁
- **THEN** 項目依其所屬 section 分組呈現

#### Scenario: 區分已完成與未完成的 task

- **WHEN** 檢視 tasks 清單
- **THEN** 已完成的項目於視覺上與未完成的項目可區分

### Requirement: spec deltas 分頁標示 delta 動作並高亮 BDD 關鍵字

spec deltas 分頁 SHALL 為該 change 所動到的每一條 requirement 標示其 delta 動作
（`ADDED` / `MODIFIED` / `REMOVED` / `RENAMED`），並呈現其內容。requirement 內容中的 BDD 關鍵字
（`WHEN` / `THEN` / `AND` / `MUST` / `SHALL`）SHALL 於視覺上與其餘文字可區分。

delta 動作 SHALL 由 delta spec 的 section 標題推導。delta spec 的內容若不符預期格式，SHALL 降級為
原樣呈現其 markdown，SHALL NOT 顯示空白、SHALL NOT 使視圖失效。

#### Scenario: 呈現 delta 動作

- **WHEN** 錨定的 change 有 delta specs
- **THEN** 每一條 requirement 標示其 delta 動作

#### Scenario: BDD 關鍵字可區分

- **WHEN** 檢視一條含 BDD 情境的 requirement
- **THEN** 其中的 BDD 關鍵字於視覺上與其餘文字可區分

#### Scenario: 格式不符預期的 delta spec

- **WHEN** 一份 delta spec 的內容不符預期格式
- **THEN** 該份內容以原樣的 markdown 呈現，且視圖的其餘部分仍正常運作

### Requirement: 無錨定 change 時本 change 視圖呈現空狀態

**本 change** 視圖 SHALL 在當前 focused session 沒有錨定的 change 時呈現空狀態，並 SHALL 引導使用者
前往「瀏覽」視圖選擇一個 change。

空狀態 SHALL NOT 使「瀏覽」視圖失效 —— 一個只有 archived change 的 repo，其兩棵樹仍然完全有用。

#### Scenario: folder 沒有 active change

- **WHEN** 當前 folder 沒有任何 active change，且使用者尚未選擇 change
- **THEN** 本 change 視圖呈現空狀態，且瀏覽視圖仍可正常使用

#### Scenario: 空狀態提供選擇 change 的引導

- **WHEN** 本 change 視圖呈現空狀態
- **THEN** 該狀態提供前往選擇一個 change 的入口

### Requirement: 瀏覽視圖以兩棵樹呈現 specs 與 changes

**瀏覽** 視圖 SHALL 以上下堆疊的**兩棵樹**呈現當前 folder 的 OpenSpec 結構，兩棵樹 SHALL 各自可收合。

- **Specs 樹**：第一層為 spec topic（SHALL 標示與該 topic 相關的 change 數量），展開後第二層為該
  spec 的 heading。
- **Changes 樹**：第一層為 **Active** 與 **Archived** 兩個群組（SHALL 標示各自的數量），展開後為
  change（SHALL 標示其 tasks 進度）。

樹的形式優於清單，是因為 side panel 只有一欄的寬度 —— 使用者要能同時看見 specs 與 changes 的輪廓，
而不是在兩個分頁之間來回切換。

#### Scenario: 呈現兩棵樹

- **WHEN** 使用者檢視瀏覽視圖
- **THEN** Specs 與 Changes 兩棵樹同時呈現，且各自可收合

#### Scenario: 展開一個 spec topic

- **WHEN** 使用者展開一個 spec topic
- **THEN** 該 spec 的 heading 以子節點呈現

#### Scenario: change 依 active 與 archived 分組

- **WHEN** 使用者檢視 Changes 樹
- **THEN** change 分為 Active 與 Archived 兩個群組，各自標示數量，且每個 change 標示其 tasks 進度

#### Scenario: 檢視單一 spec 的內容

- **WHEN** 使用者觸發一個 spec topic
- **THEN** 呈現該 spec 的內容

### Requirement: 於瀏覽視圖選擇 change 即錨定至當前 session

使用者於 Changes 樹中觸發一個 change 時，該 change SHALL 錨定到**當前 focused session**，且視圖
SHALL 切換至本 change。

當前 focused session 所錨定的 change，其所在的節點 SHALL 於視覺上被標示。

#### Scenario: 觸發 change 建立錨定

- **WHEN** 使用者於 Changes 樹觸發一個 change
- **THEN** 該 change 錨定到當前 focused session，且視圖切換至本 change

#### Scenario: 錨定的 change 被標示

- **WHEN** 當前 focused session 錨定了某個 change，使用者檢視 Changes 樹
- **THEN** 該 change 的節點於視覺上被標示

### Requirement: Graph 與 Timeline 於全視窗 overlay 中呈現

應用程式 SHALL 提供 **Graph**（spec 與 change 的關聯結構）與 **Timeline**（change 生命週期的
Gantt 時間軸）兩個視覺化，且它們 SHALL 於**覆蓋整個視窗**的 overlay 中呈現，SHALL NOT 被塞進
side panel。

side panel 的 OpenSpec 身分 SHALL 提供開啟這兩者的入口。overlay SHALL 可以 `Esc` 關閉。

**理由**：Timeline 的最小可用寬度遠大於 side panel 的上限（label 欄與圖表區的寬度下限相加即超過
900px），在窄欄中只看得到時間軸的一小段。而 Graph 與 Timeline 是「**搞懂全局**」的動作，不是
「一邊駕駛 agent 一邊盯著」的動作 —— 它們沒有與 terminal 並存的需求。

Graph 與 Timeline 是**兩個不同的視覺化**：Graph 呈現 spec ↔ change 的關聯（無時間概念），
Timeline 呈現 change 的生命週期（有時間軸）。SHALL NOT 以其中一個代替另一個。

#### Scenario: 自側欄開啟 Graph

- **WHEN** 使用者觸發 Graph 的入口
- **THEN** Graph 於覆蓋整個視窗的 overlay 中呈現

#### Scenario: 自側欄開啟 Timeline

- **WHEN** 使用者觸發 Timeline 的入口
- **THEN** Timeline 於覆蓋整個視窗的 overlay 中呈現，change 的生命週期以時間軸上的橫條呈現

#### Scenario: 以 Esc 關閉 overlay

- **WHEN** overlay 開啟中，使用者按下 `Esc`
- **THEN** overlay 關閉，side panel 回到原本的視圖

#### Scenario: 於 Graph 中觸發一個 change

- **WHEN** 使用者於 Graph 中觸發一個 change 節點
- **THEN** overlay 關閉，該 change 成為側欄呈現的 change

### Requirement: OpenSpec 與 Files 兩個身分之間可交叉導覽

使用者 SHALL 能自 OpenSpec 身分中的 spec 或 change artifact，跳至其底層的檔案 —— 該操作 SHALL 切換
side panel 至 Files 身分並開啟該檔案。該入口於介面上的標籤為 **Open in Files**。

使用者 SHALL 能自 Files 身分中一個位於 `openspec/` 之下的檔案，跳至其對應的 spec 或 change —— 該操作
SHALL 切換 side panel 至 OpenSpec 身分並呈現對應的內容。該入口於介面上的標籤為 **View in OpenSpec**。

交叉導覽 SHALL NOT 影響未存檔的編輯內容（dirty buffer 跨身分存活，延續 `file-editing` 的既有保證）。

#### Scenario: 自 spec 跳至其檔案

- **WHEN** 使用者於 OpenSpec 身分中觸發某個 spec 的 **Open in Files**
- **THEN** side panel 切換至 Files 身分，並開啟該 spec 的 `.md` 檔

#### Scenario: 自 openspec 目錄下的檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 交叉導覽不丟失未存的編輯

- **WHEN** 使用者在 Files 身分中有未存檔的編輯，切換至 OpenSpec 身分後再切回
- **THEN** 未存檔的編輯內容仍在

### Requirement: 側欄跟隨 focused session 的錨定 change

**本 change** 視圖所呈現的 change SHALL 為**當前 focused terminal session** 所錨定的 change，
且該 change 隸屬於該 session 的**側欄來源** repo（見 `side-panel-source`）。使用者切換 focused
session 時，本 change 視圖 SHALL 隨之呈現新 focused session 所錨定的 change。

錨定關係為 per-session —— 不同的 session 可錨定不同的 change。

**側欄來源** repo **恰有一個** active change 且尚無明確的錨定時，本 change 視圖 SHALL 呈現該
change —— 這是**衍生的預設值**，SHALL NOT 依賴「使用者曾經建立過 session」。使用者選了一個只有
一個 active change 的 repo，卻看到空白的側欄，是說不過去的。

沒有任何 session 時，側欄來源退回 rail 的 focused folder（見 `side-panel-source`）—— 此處的
「側欄來源」在該情境下即為 focused folder。

#### Scenario: 切換 session 後側欄跟隨

- **WHEN** 兩個 session 錨定了不同的 change，使用者將 focus 由其中一個切換至另一個
- **THEN** 本 change 視圖呈現新 focused session 所錨定的 change

#### Scenario: 尚未建立任何 session 時仍呈現唯一的 active change

- **WHEN** 使用者選中一個恰有一個 active change 的 folder，且尚未建立任何 session
- **THEN** 本 change 視圖呈現該 change

#### Scenario: 側欄來源指向另一個 repo 時呈現該 repo 的 change

- **WHEN** focused session 屬於 repoA，其側欄來源被設為 repoB
- **THEN** 本 change 視圖呈現 repoB 的 change（依錨定或衍生預設），而非 repoA 的

### Requirement: 側欄資料隨檔案變更更新

**側欄來源** repo 的 `openspec/` 之下發生檔案變更時，側欄呈現的內容 SHALL 隨之更新 —— 使用者
SHALL NOT 需要手動重新整理。側欄來源與 rail 的 focused folder 不同時，此更新 SHALL 針對**側欄
來源** repo（那正是 agent 正在改的地方），而非 focused folder。

這是本 app 的核心情境：agent 在 terminal 中改 spec、勾 tasks，側欄應當即時反映 —— 即使 agent
改的是 focused folder 之外的另一個 repo（見 `side-panel-source`）。

#### Scenario: agent 勾完一個 task 後進度更新

- **WHEN** 外部程式改動了錨定 change 的 tasks 檔案
- **THEN** 本 change 視圖的 tasks 進度隨之更新

#### Scenario: 新增一個 change 後樹上出現它

- **WHEN** 外部程式於 `openspec/changes/` 下新增一個 change
- **THEN** 瀏覽視圖的 Changes 樹隨之出現該 change

#### Scenario: 側欄來源 repo 的變更即時反映

- **WHEN** 側欄來源指向一個非 focused folder 的 repo，外部程式改動了該 repo 的 `openspec/`
- **THEN** 側欄呈現的內容隨之更新，無需手動重新整理

### Requirement: 資料未到達時呈現載入狀態

OpenSpec 的資料尚未自主行程送達時，側欄 SHALL 呈現載入狀態，SHALL NOT 呈現空白或空狀態 ——
後者會使使用者誤以為該 repo 沒有 OpenSpec 內容，或側欄壞了。

#### Scenario: 首次開啟側欄

- **WHEN** 使用者首次於某個 folder 開啟 OpenSpec 身分，資料尚未送達
- **THEN** 側欄呈現載入狀態，而非空狀態

