## ADDED Requirements

### Requirement: 本 change 視圖呈現當前側欄座標所錨定的 change

**本 change** 視圖所呈現的 change SHALL 為 **rail 上選中之項目其側欄座標**所錨定的 change，且該
change SHALL 隸屬於該座標的**側欄來源** repo（見 `side-panel-source`）。使用者切換 rail 上選中的
項目時，本 change 視圖 SHALL 隨之呈現新項目所錨定的 change。

錨定關係為 per-folder —— 同一個 folder 的多個 session 共用同一個錨定；**它 SHALL NOT 以「是否
存在 session」為前提**。

**側欄來源** repo **恰有一個** active change 且尚無明確的錨定時，本 change 視圖 SHALL 呈現該
change —— 這是**衍生的預設值**。使用者選了一個只有一個 active change 的 repo，卻看到空白的側欄，
是說不過去的。

**該衍生預設 SHALL 為動態的：它隨 active change 的數量重新解析，SHALL NOT 因時間經過或 active
change 數量變化而自行固化為明確的錨定。** 於是一個原本靠衍生預設呈現的 change，在該 repo 出現
第二個 active change 之後 **SHALL 讓位給空狀態**（見「無錨定 change 時本 change 視圖呈現空狀態」）
——那是規格而非缺陷：系統不在多個候選之間猜測。

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
- **THEN** 本 change 視圖不再呈現原本那個 change，改為呈現空狀態

#### Scenario: 明確的錨定不受 active change 數量影響

- **WHEN** 使用者已明確選擇了某個 change，而後同一個 repo 新增了另一個 active change
- **THEN** 本 change 視圖仍呈現使用者所選的那個 change

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

## MODIFIED Requirements

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

### Requirement: 無錨定 change 時本 change 視圖呈現空狀態

**本 change** 視圖 SHALL 在當前側欄座標沒有錨定的 change、且衍生預設不成立時呈現空狀態，並
SHALL 引導使用者前往「瀏覽」視圖選擇一個 change。

空狀態 SHALL NOT 使「瀏覽」視圖失效 —— 一個只有 archived change 的 repo，其兩棵樹仍然完全有用。

#### Scenario: folder 沒有 active change

- **WHEN** 當前 folder 沒有任何 active change，且使用者尚未選擇 change
- **THEN** 本 change 視圖呈現空狀態，且瀏覽視圖仍可正常使用

#### Scenario: 空狀態提供選擇 change 的引導

- **WHEN** 本 change 視圖呈現空狀態
- **THEN** 該狀態提供前往選擇一個 change 的入口

## REMOVED Requirements

### Requirement: 側欄跟隨 focused session 的錨定 change

**Reason**: 名稱與內容皆以 focused session 為錨定的歸屬（「本 change 視圖所呈現的 change SHALL
為當前 focused terminal session 所錨定的 change」「錨定關係為 per-session」），而本 change 把
錨定改基到 rail 的項目上。它並且以一段唯讀的 fallback 收尾（「沒有任何 session 時，側欄來源退回
rail 的 focused folder」）—— 那正是本 change 要消滅的分歧。

**Migration**: 由 `## ADDED Requirements` 的「本 change 視圖呈現當前側欄座標所錨定的 change」
承接。三個既有 scenario 全數保留：「切換 session 後側欄跟隨」改基為「切換 rail 上選中的項目後
本 change 視圖跟隨」；「尚未建立任何 session 時仍呈現唯一的 active change」標題與內容逐字保留；
「側欄來源指向另一個 repo 時呈現該 repo 的 change」**標題逐字保留、WHEN 改基**（「focused session
屬於 repoA」→「rail 上選中的 folder 為 repoA」）。並新增兩條把衍生預設的**動態性**寫成可驗收的
行為。

### Requirement: 於瀏覽視圖選擇 change 即錨定至當前 session

**Reason**: 名稱與內容以 session 為錨定的目的地。錨定改基為 per-folder 之後，「錨定至當前
session」不再是一個存在的關係；且該動作在尚無 session 的 folder 上必須同樣可用。

**Migration**: 由 `## ADDED Requirements` 的「於瀏覽視圖選擇 change 即錨定至當前的側欄座標」
承接。兩個既有 scenario 全數保留（主詞由 session 改為側欄座標），並新增「尚無 session 時仍可
建立錨定」—— 那正是本 change 修的痛點在此處的形狀。
