# openspec-panel Specification

## Purpose
TBD - created by archiving change openspec-side-panel. Update Purpose after archive.

## Requirements

### Requirement: OpenSpec 身分呈現「本 change」與「瀏覽」兩個視圖

side panel 的 OpenSpec 身分 SHALL 於其內部提供**瀏覽**視圖，並 SHALL 在存在可解析的錨定 change
時額外提供**本 change** 視圖。呈現中的視圖 SHALL 恰有一個，且當前視圖 SHALL 於切換入口上被明確
標示。

**沒有可解析的錨定 change 時，本 change 視圖與其切換入口 SHALL 一併不呈現**，OpenSpec 身分 SHALL
停在瀏覽視圖。一個永遠只能顯示「你還沒有選 change」的視圖，佔著一個入口卻沒有內容 —— 選 change
的地方本來就在瀏覽視圖裡（見「於瀏覽視圖選擇 change 即錨定至當前的側欄座標」）。

**可解析的錨定 change 於本規格中的定義**見「本 change 視圖呈現當前側欄座標所錨定的 change」：
明確的錨定或衍生預設，且該 change 存在於側欄來源 repo 的掃描結果之中。

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
- **THEN** 呈現中的視圖恰有一個

#### Scenario: 沒有可解析的 change 時不呈現本 change 的入口

- **WHEN** 側欄來源 repo 沒有可解析的錨定 change（無明確錨定且衍生預設不成立）
- **THEN** **This change** 的切換入口不呈現，OpenSpec 身分呈現瀏覽視圖

#### Scenario: 錨定之後本 change 的入口出現

- **WHEN** 於前述狀態下，使用者在瀏覽視圖的 Changes 樹選取一個 change
- **THEN** **This change** 的切換入口出現，且該視圖成為當前視圖並呈現該 change

### Requirement: 本 change 視圖以分頁呈現該 change 的每一個 artifact

**本 change** 視圖 SHALL 為錨定 change 的**每一個 artifact**（proposal、design、tasks、specs
以及該 schema 定義的任何其他 artifact）各提供一個分頁，一次 SHALL 只顯示一個。

分頁的順序 SHALL 由**資料來源所提供的排序規則**決定，並以該 change 的 schema 所宣告的順序作為它的
輸入。**本應用程式 SHALL NOT 另行實作該規則** —— 一份自己的實作會在規則演進時與來源靜默分歧，而
分歧的徵狀只是「順序看起來怪怪的」，沒有任何東西會紅。

該規則所產生的行為，以下三條 SHALL 成立：

- schema 宣告的順序可用時，分頁依該順序排列。
- **該順序不可用時，分頁 SHALL 依敘事順序（proposal → design → specs → tasks）排列，SHALL NOT
  沿用資料來源交付 artifact 時的順序** —— 後者以修改時間為基礎，對一個正常寫下來的 change 恰好是
  敘事順序的反序。「不可用」涵蓋且不限於：該 change 已封存、解析該順序所需的外部程式不可解析、
  以及該解析逾時。
- 該順序只涵蓋部分 artifact 時，被涵蓋者依其排在前，未被涵蓋者接在其後。

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

- **WHEN** 該 change 的 schema 宣告了 artifact 的順序，且該順序可用
- **THEN** 分頁依該順序排列

#### Scenario: 取不到 schema 順序時仍依敘事順序

- **WHEN** 錨定的 change 無法取得其 schema 所宣告的 artifact 順序，且資料來源交付的順序中 tasks 在
  proposal 之前
- **THEN** 分頁依 proposal、design、specs、tasks 的順序排列

#### Scenario: 已封存的 change 亦依敘事順序

- **WHEN** 使用者錨定一個已封存的 change
- **THEN** 分頁依 proposal、design、specs、tasks 的順序排列

### Requirement: 退路頂替權威順序時，視圖說明原因

分頁順序來自敘事順序（而非該 change 的 schema 所宣告的順序）時，本 change 視圖 SHALL 於分頁附近
呈現一句說明。

**沒有這句話，使用者無從分辨眼前的順序是權威的還是推測的** —— 而兩者在 spec-driven 之下恰好相同，
於是「看起來正確」不構成任何證據。**已封存的 change 永遠取不到權威順序**（該順序只對進行中的 change
查詢），所以這不是偶發狀態而是常態。

說明 SHALL 區分兩種情形：**已封存**（該順序本就不為封存的 change 追蹤），以及**其餘任何原因**。

**其餘那句 SHALL NOT 指出單一成因。** 進行中的 change 取不到該順序有多種可能（解析所需的外部程式
不可解析、逾時、非零結束、其輸出不含可對應的項目），而視圖手上沒有足以分辨的資訊 —— 指定一個成因
會是編造。

權威順序可用時 SHALL NOT 呈現這句說明。一句恆常顯示的說明等於沒有說明。

**這一條的驗收 SHALL 以「決定是否呈現」的判斷為對象，SHALL NOT 倚賴端對端執行中該順序是否恰好
可得。** 該順序由外部程式取得，而資料來源對其結果（**包含取不到**）設有數十秒的快取 —— 一次暫時性
的失敗會讓同一個來源在該窗口內持續回報取不到。實測同一份程式碼於兩種啟動模式下一紅一綠，差別只在
啟動時序落在快取窗口的哪一邊。**一條會間歇通過的驗收比沒有驗收更糟**：它下次失敗時，沒有人知道
該不該相信它。

#### Scenario: 已封存的 change 說明順序未被追蹤

- **WHEN** 使用者錨定一個已封存的 change
- **THEN** 視圖說明該順序不為已封存的 change 追蹤，且分頁依敘事順序排列

#### Scenario: 進行中的 change 取不到順序時說明退路

- **WHEN** 錨定一個進行中的 change，而其 schema 宣告的順序不可用
- **THEN** 視圖說明該順序不可得、目前呈現的是預設順序

#### Scenario: 權威順序可用時不呈現說明

- **WHEN** 錨定的 change 取得了其 schema 所宣告的順序
- **THEN** 視圖不呈現任何關於退路的說明

### Requirement: tasks 分頁呈現進度與分組的項目

tasks 分頁 SHALL 呈現**依 section 分組**的項目清單。每個項目 SHALL 標示其完成狀態；已完成的項目
SHALL 於視覺上與未完成者可區分。

**一個項目的文字可能有多行**（作者寫在該項目之下的續行、子項、說明段落）。該文字 SHALL 依 markdown
的規則呈現，**SHALL NOT 被摺成單一行**：作者寫的子項 SHALL 呈現為子項，行內標記（強調、行內程式碼、
連結）SHALL 被渲染而非以原始字元呈現。

**「依 markdown 的規則」是承重的措辭，不等於「保留每一個換行」** —— 續行的斷行位置多半是原始檔案的
排版寬度而非內容的語意，逐字保留它會在側欄的有限寬度內產生與內容無關的斷行。哪些換行有意義由
markdown 的規則決定（硬換行保留、段落的續行合併、清單成為清單）。

呈現這段文字 SHALL 走與其他 markdown 內容**同一條渲染路徑**，SHALL NOT 另建一條。該文字與 change
的其他 artifact 同樣來自使用者的 repo，屬**不受信任的輸入**，而該路徑的安全性來自一組必須維持的
預設值（原始 HTML 降級為純文字、URL 經協定過濾、連結不在應用程式內導航）。第二條渲染路徑就是第二處
必須記得維持那些預設值的地方，**而遺漏不會產生任何可見的失敗**。

**視覺區分 SHALL 涵蓋該項目文字經 markdown 渲染出來的行內元素**（強調、行內程式碼、連結、
關鍵字標示，以及日後新增的任何一種），且 SHALL 以「那些元素採用與該項目內文相同的顏色」達成。
換言之，**一個已完成項目的文字通篇只有一種前景色。**

**作用域是文字，不含完成狀態標記。** 標記承載的是「這一項完成了」這個狀態本身，不是被淡化的
內容 —— 它 SHALL NOT 隨文字一起淡化。（雛型明文如此：`workspace-mockup.html:374` 讓已完成項目的
標記保留 `--green` 且不帶刪除線。）

**這是承重的措辭，不是排版細節。** 區分是套用在整個項目上、由內文繼承而來的，而一個自己宣告了
顏色的行內元素會贏過繼承 —— 症狀是一條已被劃掉的 task 仍夾著數段最亮的前景色。tasks 清單正是
使用者掃視「哪些還沒做」的地方，那幾段字會偽裝成那個訊號。**它不會產生任何錯誤**：
只看整段是否被標示為已完成的驗收照樣通過。

「採用與內文相同的顏色」也界定了這件事怎麼做**不對**：任何在顏色決定之後才套用、且一次作用於
整棵子樹的手段（例如對整列施加透明度）都不滿足本條款 —— 它連「只有一種前景色」都保不住。

#### Scenario: 依 section 分組

- **WHEN** 使用者檢視 tasks 分頁
- **THEN** 項目依其所屬 section 分組呈現

#### Scenario: 區分已完成與未完成的 task

- **WHEN** 檢視 tasks 清單
- **THEN** 已完成的項目於視覺上與未完成的項目可區分

#### Scenario: 項目的續行不被摺成單一行

- **WHEN** 某個 task 項目在其第一行之下寫有子項
- **THEN** 該子項呈現為清單項目，而非接在第一行之後成為同一段連續文字

#### Scenario: 項目文字中的行內標記被渲染

- **WHEN** 某個 task 項目的文字含行內程式碼或強調標記
- **THEN** 它們以對應的樣式呈現，而非顯示為原始的標記字元

#### Scenario: 多行項目仍可區分完成狀態

- **WHEN** 一個已完成的 task 項目其文字有多行
- **THEN** 它與未完成項目的視覺區分仍然成立，且涵蓋該項目的整段文字

#### Scenario: 已完成項目中的行內標記不保留自己的顏色

- **WHEN** 一個已完成的 task 項目其文字含強調標記、連結或關鍵字標示
- **THEN** 它們各自與該項目的內文以相同的顏色呈現

#### Scenario: 已完成與未完成項目的內文顏色不同

- **WHEN** 同一份 tasks 清單中同時有已完成與未完成的項目
- **THEN** 已完成項目中行內標記的顏色與未完成項目內文的顏色不同

#### Scenario: 完成狀態標記不隨文字淡化

- **WHEN** 一個已完成的 task 項目其文字被淡化
- **THEN** 該項目的完成狀態標記仍以其原本的顏色呈現

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

### Requirement: 非 Markdown 的 artifact 以原文呈現

一個 change 的 artifact 不必然是 Markdown —— schema 可以宣告資料檔（change 根目錄下的
`.yaml` / `.yml` / `.json`）。這類 artifact 的分頁 SHALL 呈現其**原文**，SHALL NOT 交由
Markdown 渲染。

**一個點得到卻空白的分頁等同於省略了那個 artifact。** 前一條 requirement 的「artifact SHALL
NOT 被省略」只約束分頁的**存在**；內容的呈現是逐一按 artifact 的種類窮舉的，於是一個新的種類
落空時分頁仍在、標題仍在，只有內容是空的 —— 它在型別上完全合法，在畫面上看起來像「這個檔案
是空的」。這條 requirement 約束的是那一面。

交由 Markdown 渲染**不會失敗，它會重新排版**：縮排成為程式碼區塊、`#` 成為標題、開頭的破折號
成為清單項。資料檔的縮排承載結構，把結構呈現錯比不呈現更糟。

該 artifact 的「在 Files 中開啟」入口 SHALL 指向它**實際的檔案**。artifact 的識別碼是檔名去掉
副檔名，**SHALL NOT 假設補上 `.md` 就能還原檔名** —— 那對資料檔會指向一個不存在的路徑，而那個
入口失敗時畫面上只是沒有反應。

#### Scenario: 資料 artifact 的分頁呈現其原文

- **WHEN** 錨定的 change 在其根目錄下有一份資料檔（如 `.yaml`）
- **THEN** 該 artifact 有一個分頁，且切換到它時呈現該檔案的原文

#### Scenario: 資料 artifact 的檔案入口指向實際的檔案

- **WHEN** 應用程式為一份 `.yaml` 資料 artifact 解析「在 Files 中開啟」的目標
- **THEN** 目標是該 `.yaml` 檔案本身，而非以識別碼補上 `.md` 組成的路徑

### Requirement: 瀏覽視圖以兩棵樹呈現 specs 與 changes

**瀏覽** 視圖 SHALL 以上下堆疊的**兩棵樹**呈現**側欄來源** repo 的 OpenSpec 結構，兩棵樹 SHALL
各自可收合。

- **Specs 樹**：第一層為 spec topic（SHALL 標示與該 topic 相關的 change 數量），展開後第二層為該
  spec 的 heading。
- **Changes 樹**：第一層為 **Active** 與 **Archived** 兩個群組（SHALL 標示各自的數量），展開後為
  change（SHALL 標示其 tasks 進度）。

樹的形式優於清單，是因為 side panel 只有一欄的寬度 —— 使用者要能同時看見 specs 與 changes 的輪廓，
而不是在兩個分頁之間來回切換。

（措辭自「當前 folder」改為「側欄來源」—— 那是 `side-panel-repo-anchor` 起就已過期的說法，本 change
把整份側欄的座標寫清楚時一併修正，行為不變。）

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

### Requirement: 於瀏覽視圖選擇 change 即錨定至當前的側欄座標

使用者於 Changes 樹中觸發一個 change 時，該 change SHALL 錨定到 **rail 上選中之項目的側欄
座標**，且視圖 SHALL 切換至本 change。**此動作 SHALL NOT 以存在 session 為前提。**

當前座標所錨定的 change，其所在的節點 SHALL 於視覺上被標示。

#### Scenario: 觸發 change 建立錨定

- **WHEN** 使用者於 Changes 樹觸發一個 change
- **THEN** 該 change 錨定到 rail 上選中之項目的側欄座標，且視圖切換至本 change

#### Scenario: 尚無 session 時仍可建立錨定

- **WHEN** 使用者於一個尚未建立任何 session 的 folder，於 Changes 樹觸發一個 change
- **THEN** 該 change 成為該 folder 的錨定，且視圖切換至本 change

#### Scenario: 錨定的 change 被標示

- **WHEN** 當前的側欄座標錨定了某個 change，使用者檢視 Changes 樹
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

使用者 SHALL 能自 Files 身分中一個位於**某個工作目錄**的 `openspec/` 之下的檔案，跳至其對應的
spec 或 change —— 該操作 SHALL 切換 side panel 至 OpenSpec 身分並呈現對應的內容。該入口於介面上
的標籤為 **View in OpenSpec**。

**「某個工作目錄」涵蓋 folder 自身與該 repo 位於 folder 邊界內的 linked worktree**，其清單由主
行程供應（見 `openspec-data-access`）。判定 SHALL 為：**以工作目錄根由長至短逐一嘗試 —— 剝除該
根之後的第一段為 `openspec` 且其後符合已知結構者即命中，取第一個命中的結果**。由長至短是
tie-break（工作目錄可能巢狀），逐一嘗試則使某個根剝出後不成立時仍會試其餘的根。

判定 SHALL NOT 鬆綁為「路徑中任一段為 `openspec`」—— 一個位於 `docs/openspec/` 之下、且其後
結構與 OpenSpec 相同的檔案不是 OpenSpec artifact，SHALL NOT 呈現 **View in OpenSpec**。

工作目錄根的比對 SHALL 以路徑分段進行，SHALL NOT 以字串前綴進行 —— 否則當清單中同時存在兩個
根、其一為另一之字串前綴時，較短的那個會先命中並剝出錯誤的剩餘路徑。

工作目錄根清單尚未取得時 SHALL NOT 呈現 **View in OpenSpec**，清單抵達後 SHALL 呈現 —— 該清單
per-folder 取得一次並隨結構變更更新，SHALL NOT 於每次開啟檔案時重新請求。

自 worktree 的 `openspec/specs/<topic>/` 之下的檔案觸發時，SHALL 呈現該 **topic**（反向導覽的
目標是 spec 這個實體，不是某一個檔案）。側欄呈現的是該 topic 當前納入的版本，其來源由
`worktree-aggregation` 決定 —— 該版本與觸發時所開啟的檔案可能不同份。

因此 spec 檢視 SHALL 標示其內容的來源工作目錄，**但僅在該 repo 有多於一個工作目錄時** ——
只有一個工作目錄時不存在任何歧義，標示會成為每個 repo 都喊一次的噪音（比照 change 的來源徽章
不標示主工作目錄）。

交叉導覽 SHALL NOT 影響未存檔的編輯內容（dirty buffer 跨身分存活，延續 `file-editing` 的既有保證）。

#### Scenario: 自 spec 跳至其檔案

- **WHEN** 使用者於 OpenSpec 身分中觸發某個 spec 的 **Open in Files**
- **THEN** side panel 切換至 Files 身分，並開啟該 spec 的 `.md` 檔

#### Scenario: 自 openspec 目錄下的檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 自 worktree 中的 change 檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的
  `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 自 worktree 中的 spec 檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的
  `openspec/specs/<topic>/` 之下的檔案，該 topic 已納入側欄呈現的 spec 清單，並觸發
  **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 topic
- **AND** 呈現的內容標示其來源工作目錄

#### Scenario: topic 僅存在於該 worktree

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的 `openspec/specs/<topic>/` 之下的
  檔案，而該 topic 尚未納入側欄呈現的 spec 清單（例如它是該 worktree 中新增的 capability）
- **THEN** 觸發 **View in OpenSpec** 後呈現該 topic 不存在的狀態，且不呈現任何其他 topic 的內容

#### Scenario: 位於 docs 之下、結構相同的檔案不呈現入口

- **WHEN** 使用者於 Files 身分中開啟 `docs/openspec/changes/<slug>/proposal.md`
- **THEN** 不呈現 **View in OpenSpec** 入口
- **AND** 該檔案位於邊界內 worktree 的 `docs/openspec/changes/<slug>/` 之下時亦不呈現

#### Scenario: 兩個工作目錄根互為字串前綴

- **WHEN** 工作目錄根清單同時包含 `<root>` 與 `<root><suffix>`（前者為後者的字串前綴），而使用者
  開啟位於 `<root><suffix>/openspec/changes/<slug>/` 之下的檔案
- **THEN** 呈現 **View in OpenSpec**，且觸發後呈現該 change

#### Scenario: 交叉導覽不丟失未存的編輯

- **WHEN** 使用者在 Files 身分中有未存檔的編輯，切換至 OpenSpec 身分後再切回
- **THEN** 未存檔的編輯內容仍在

### Requirement: 本 change 視圖呈現當前側欄座標所錨定的 change

**本 change** 視圖所呈現的 change SHALL 為 **rail 上選中之項目其側欄座標**所錨定的 change，且該
change SHALL 隸屬於該座標的**側欄來源** repo（見 `side-panel-source`）。使用者切換 rail 上選中的
項目時，本 change 視圖 SHALL 隨之呈現新項目所錨定的 change。

錨定關係為 per-folder —— 同一個 folder 的多個 session 共用同一個錨定；**它 SHALL NOT 以「是否
存在 session」為前提**。

**錨定的 slug SHALL 對照側欄來源 repo 的掃描結果解析；查無此項時 SHALL 視同沒有明確的錨定**
（讓位給衍生預設，衍生預設也不成立時該視圖不呈現）。錨定跨重啟存活，而 change 的 slug 會在其
生命週期中改變或消失 —— `openspec archive` 會把 slug 改名為帶日期前綴的形式，worktree 移除也會
讓一整批 change 自掃描結果中消失。**SHALL NOT 將無法解析的 slug 呈現為錯誤**：使用者從未做錯
任何事，他只是把一個 change 封存了。

**無法解析的錨定 SHALL NOT 被自動自落盤的座標中清除。** 清除是一次由掃描結果驅動的寫入，而掃描
可能因暫時性的原因回報不到該 change（worktree 尚未掛回、目錄暫時無法讀取）—— 那會把一個仍然正確
的錨定永久抹掉，且是靜默的。留著它沒有代價：它隨時可能再度可解析，而在那之前它不影響任何呈現。

**側欄來源** repo **恰有一個** active change 且尚無明確的錨定（或明確的錨定無法解析）時，本
change 視圖 SHALL 呈現該 change —— 這是**衍生的預設值**。使用者選了一個只有一個 active change
的 repo，卻看到空白的側欄，是說不過去的。

**該衍生預設 SHALL 為動態的：它隨 active change 的數量重新解析，SHALL NOT 因時間經過或 active
change 數量變化而自行固化為明確的錨定。** 於是一個原本靠衍生預設呈現的 change，在該 repo 出現
第二個 active change 之後 **SHALL 讓位** —— 本 change 視圖與其入口一併不再呈現。那是規格而非
缺陷：系統不在多個候選之間猜測。

**明確的錨定 SHALL 只來自使用者的明確動作** —— 於 Changes 樹選取、於 Graph／Timeline 選取、或
觸發 `artifact-continuation` 的「於該 change 的來源工作目錄開啟 session」入口。**被禁止的是
「系統自行挑一個時刻把衍生預設寫成錨定」，SHALL NOT 被讀成「衍生預設呈現中的 change 不得成為
使用者動作的對象」** —— 後者會與 `artifact-continuation`「該 change SHALL 成為新 session 所屬
folder 的錨定」直接衝突，而那條要求的對象**正是側欄當下呈現的 change**（它可能來自衍生預設）。

**替代方案「一旦解析出來就固化」已被否決**：它需要額外裁決「何時固化」（建立 session 時？首次
呈現時？選中 folder 時？），而那個裁決沒有一個自明的答案 —— 一條需要額外裁決的規則，通常表示
模型錯了。動態是一條規則、零額外裁決。

#### Scenario: 切換 rail 上選中的項目後本 change 視圖跟隨

- **WHEN** 兩個 folder 的座標錨定了不同的 change，使用者於 rail 上由其中一個切換至另一個
- **THEN** 本 change 視圖呈現新選中項目所錨定的 change

#### Scenario: 尚未建立任何 session 時仍呈現唯一的 active change

- **WHEN** 使用者選中一個恰有一個 active change 的 folder，且尚未建立任何 session
- **THEN** 本 change 視圖呈現該 change

#### Scenario: 側欄來源指向另一個 repo 時呈現該 repo 的 change

- **WHEN** rail 上選中的 folder 為 repoA，其側欄來源被設為 repoB
- **THEN** 本 change 視圖呈現 repoB 的 change（依錨定或衍生預設），而非 repoA 的

#### Scenario: 衍生預設隨 active change 數量重新解析

- **WHEN** 本 change 視圖正靠衍生預設呈現某個唯一的 active change，而後外部程式於同一個 repo
  新增了第二個 active change
- **THEN** 本 change 視圖不再呈現原本那個 change，且 **This change** 的入口不再呈現

#### Scenario: 明確的錨定不受 active change 數量影響

- **WHEN** 使用者已明確選擇了某個 change，而後同一個 repo 新增了另一個 active change
- **THEN** 本 change 視圖仍呈現使用者所選的那個 change

#### Scenario: 錨定的 change 不存在於來源 repo 時不呈現錯誤

- **WHEN** 某個 folder 的座標錨定了一個已不存在於該 repo 掃描結果中的 slug（例如它已被封存而
  改名），使用者選中該 folder
- **THEN** side panel 不呈現任何錯誤訊息；該 repo 恰有一個 active change 時本 change 視圖呈現
  那一個，否則 **This change** 的入口不呈現

#### Scenario: 無法解析的錨定不被自落盤內容清除

- **WHEN** 某個 folder 的座標錨定了一個無法解析的 slug，使用者選中該 folder、切換至別的 folder
  再切回
- **THEN** 該座標於落盤內容中仍保有原本的錨定

### Requirement: 錨定關係由使用者建立，不由系統推測

change 的錨定 SHALL 由使用者建立，SHALL NOT 由系統自 pty 的輸出或終端標題推測。

pty 中執行的 agent 不會宣告它正在處理哪個 change，任何由輸出內容進行的推測都會在「標題碰巧提到
某個 slug」時假陽性、在「agent 用別的說法描述同一件事」時假陰性 —— 一個大部分時候對、偶爾莫名
其妙跳到別的 change 的側欄，比沒有側欄更糟，因為使用者會開始不信任它。

這與「session 的標籤反映 pty 設定的終端標題」不矛盾：那條之所以成立，是因為 pty **真的以 OSC
序列宣告了標題**（一個明確的協定）。change 的錨定沒有這樣的協定。

**本要求自 `terminal-sessions`「session 可錨定一個 change」遷入** —— 該 requirement 隨錨定改基為
per-folder 而被移除，但這段論證的效力與錨定隸屬於誰無關。

#### Scenario: 錨定不隨 pty 的輸出改變

- **WHEN** 一個已錨定 change 的 folder，其 session 的 pty 輸出了含有另一個 change slug 的內容
  或終端標題
- **THEN** 該 folder 的錨定不改變

### Requirement: 側欄資料隨檔案變更更新

**側欄來源** repo 的 `openspec/` 之下發生檔案變更時，側欄呈現的內容 SHALL 隨之更新 —— 使用者
SHALL NOT 需要手動重新整理。側欄來源與 rail 的 focused folder 不同時，此更新 SHALL 針對**側欄
來源** repo（那正是 agent 正在改的地方），而非 focused folder。

此處的「該 repo 的 `openspec/`」SHALL 涵蓋該 repo 的**每一個工作目錄**的 `openspec/`，而非僅主
工作目錄的那一個（見 `worktree-aggregation`）—— agent 在一個 linked worktree 裡改 spec、勾 tasks，
與它在主工作目錄裡做同樣的事，對使用者而言是同一件事。

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

#### Scenario: linked worktree 中的變更即時反映

- **WHEN** 外部程式改動了側欄來源 repo 的某個 linked worktree 中、錨定 change 的 tasks 檔案
- **THEN** 本 change 視圖的 tasks 進度隨之更新，無需手動重新整理

### Requirement: 資料未到達時呈現載入狀態

OpenSpec 的資料尚未自主行程送達時，側欄 SHALL 呈現載入狀態，SHALL NOT 呈現空白或空狀態 ——
後者會使使用者誤以為該 repo 沒有 OpenSpec 內容，或側欄壞了。

#### Scenario: 首次開啟側欄

- **WHEN** 使用者首次於某個 folder 開啟 OpenSpec 身分，資料尚未送達
- **THEN** 側欄呈現載入狀態，而非空狀態

### Requirement: change 標示其來源工作目錄

側欄呈現 change 時，來源**非主工作目錄**的 change SHALL 標示其來源。標示的內容 SHALL 為該工作
目錄的分支名稱；分支無法判定（detached HEAD）時 SHALL 呈現一個固定的替代字樣。

來自**主工作目錄**的 change SHALL NOT 標示來源 —— 在單一工作目錄的 repo 裡那會是每一列都重複一次
的雜訊（比照 rail 曾把「每列都喊一次的 `OpenSpec`」降級的判斷）。

標示 SHALL NOT 呈現來源工作目錄的絕對路徑 —— renderer 不持有該資訊（見 `worktree-aggregation`）。

#### Scenario: 來自 linked worktree 的 change 標示分支

- **WHEN** 側欄呈現一個來源為 linked worktree 的 change
- **THEN** 該 change 標示其來源工作目錄的分支名稱

#### Scenario: 來自主工作目錄的 change 不標示

- **WHEN** 側欄呈現一個來源為主工作目錄的 change
- **THEN** 該 change 不呈現來源標示

#### Scenario: 標示不含路徑

- **WHEN** 側欄呈現任一 change 的來源標示
- **THEN** 標示及其提示文字均不含檔案系統路徑

### Requirement: 側欄來源未選定時 OpenSpec 身分呈現可行動的空狀態

側欄座標的來源 repo **尚未選定**時，OpenSpec 身分 SHALL 呈現空狀態並說明可選擇一個 repo 來檢視。
此狀態自 `global-session` 起存在 —— 全域項目沒有自身 repo 可作為預設來源。

空狀態 SHALL NOT 只是一塊沉默的空白 —— 使用者無從分辨那是刻意的狀態、是還沒載入完，還是壞了。
它 SHALL 指向來源指示器，使「怎樣才會有內容」這個問題在原地就有答案。

此狀態 SHALL 與「來源已選定但該 repo 不含 `openspec/`」相區別：後者是該 repo 的性質 —— 依
`workspace-layout`，那時 OpenSpec **身分本身**為停用並退回 Files；而前者是尚未作出的選擇 ——
身分為可用，面板呈現本條所述的空狀態。**兩者的差別在身分入口的狀態，不只在面板的內容。**

#### Scenario: 全域項目預設呈現空狀態

- **WHEN** 使用者選中全域項目而尚未選擇側欄來源，且 side panel 為 OpenSpec 身分
- **THEN** 面板呈現空狀態，並說明可選擇一個 repo 來檢視

#### Scenario: 選擇來源後即呈現該 repo 的內容

- **WHEN** 使用者於來源指示器為全域項目選擇一個含 `openspec/` 的 repo
- **THEN** 面板呈現該 repo 的 OpenSpec 內容

#### Scenario: 與「來源不含 openspec」的狀態相區別

- **WHEN** 使用者為全域項目選擇一個不含 `openspec/` 的 repo
- **THEN** OpenSpec 身分的入口轉為停用、side panel 退回 Files 身分
- **AND** 不呈現「尚未選擇來源」的空狀態 —— 選擇已經作出了

### Requirement: The change view's artifact content can be scrolled from the keyboard

The content area showing the active artifact in the **this change** view SHALL be able to hold
focus, and while it holds focus the standard scrolling keys (arrow keys, `PageUp` / `PageDown`,
`Home` / `End`, `Space`) SHALL scroll it.

Clicking inside the content SHALL give it focus. **Choosing an artifact** — clicking its tab, or
switching with the keyboard (see "`Ctrl+Tab` switches artifacts while focus is in the change view")
— SHALL move focus to the content area, so the next scrolling key scrolls the artifact just chosen.
Choosing a different artifact SHALL show it from its top, not at the previous artifact's scroll
offset; choosing the artifact already shown SHALL NOT change its scroll position.

While the same change's data is refreshed (for example its files are updated while an agent works),
the view SHALL NOT move focus and SHALL NOT change the scroll position.

#### Scenario: Clicking the content lets the keyboard scroll it

- **WHEN** the active artifact is taller than the content area, the user clicks inside the content
  and presses `PageDown`
- **THEN** the content scrolls down
- **AND** pressing `End` scrolls it to the bottom

#### Scenario: Choosing an artifact lets the keyboard scroll it right away

- **WHEN** the user clicks the tab of an artifact taller than the content area and then presses
  `ArrowDown`
- **THEN** that artifact's content scrolls down

#### Scenario: A newly chosen artifact starts at the top

- **WHEN** the user has scrolled one artifact down and then chooses another artifact
- **THEN** the other artifact is shown from its top

#### Scenario: An update to the change does not move the reader

- **WHEN** the user has scrolled an artifact down and the change's tasks file is modified on disk
- **THEN** after the view shows the new task progress, the scroll position and the focus are unchanged

### Requirement: `Ctrl+Tab` switches artifacts while focus is in the change view

While focus is anywhere inside the **this change** view, `Ctrl+Tab` SHALL select the next
artifact tab and `Ctrl+Shift+Tab` the previous one, in tab-strip order, wrapping at both ends.
Selecting this way is choosing an artifact (focus and scroll as in "The change view's artifact
content can be scrolled from the keyboard"), and the selected tab SHALL be scrolled into view in the
tab strip.

These keys SHALL NOT also switch the focused session (see `keyboard-navigation`). While a dialog or
a menu is open they SHALL do nothing, as for every other shortcut.

#### Scenario: Ctrl+Tab selects the next artifact

- **WHEN** focus is in the change view on the proposal's content and the user presses `Ctrl+Tab`
- **THEN** the artifact after proposal in the tab strip is selected
- **AND** focus is on that artifact's content

#### Scenario: Ctrl+Shift+Tab wraps to the last artifact

- **WHEN** the first artifact is selected, focus is in the change view, the tab strip is too narrow
  to show every tab, and the user presses `Ctrl+Shift+Tab`
- **THEN** the last artifact in the tab strip is selected
- **AND** its tab is visible in the tab strip

#### Scenario: An open overlay blocks artifact switching

- **WHEN** focus is in the change view, the Graph overlay is open, and the user presses `Ctrl+Tab`
- **THEN** the selected artifact does not change
