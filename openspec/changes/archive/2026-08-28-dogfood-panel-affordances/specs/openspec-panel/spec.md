## MODIFIED Requirements

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

## REMOVED Requirements

### Requirement: 無錨定 change 時本 change 視圖呈現空狀態

**Reason**: 本 change 視圖在沒有可解析的錨定 change 時**不再呈現**（見「OpenSpec 身分呈現
「本 change」與「瀏覽」兩個視圖」的新條款），該空狀態與它的「前往選擇一個 change」入口因此永遠
不可達。原條款所保障的兩件事各自有了新的載體：「瀏覽視圖不因此失效」由「沒有可解析的 change 時
不呈現本 change 的入口」承接（該情形下 OpenSpec 身分停在瀏覽視圖），「引導使用者選擇 change」則
回到瀏覽視圖的 Changes 樹本身。

**Migration**: 無資料遷移。使用者原本看到空狀態的情形，現在看到的是瀏覽視圖的兩棵樹；選擇
change 的動作與位置不變（Changes 樹）。
