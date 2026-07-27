# side-panel-worktree Specification

## Purpose
側欄來源的**工作目錄維度**：既有的`side-panel-source`決定「哪一個 repo」，本能力決定
「該 repo 的哪一個工作目錄」。兩者合起來是 Files 身分呈現的完整座標。

本階段的消費者只有 Files 身分 —— OpenSpec 身分維持聚合該 repo 的全部工作目錄
（見`worktree-aggregation`），那不是疏漏：聚合多個工作目錄的 change 有意義，
而聚合同一組檔案的多個版本沒有。
## Requirements

### Requirement: Files 身分的檔案樹以當前選定的工作目錄為根

side panel 的 Files 身分 SHALL 以**當前選定的工作目錄**為檔案樹的根，樹上呈現的路徑 SHALL 自該
根算起，SHALL NOT 帶有該工作目錄的 folder-relative 前綴。

這是側欄來源的**第二個維度**：既有的來源決定「哪一個 repo」（`side-panel-source`），本能力決定
「該 repo 的哪一個工作目錄」。兩者合起來是 Files 身分呈現的完整座標。

選定 folder 自身時，位於 folder 邊界內的工作目錄目錄本身 SHALL 仍如既往呈現為樹上的一般項目 ——
「可切換到它」SHALL NOT 使它自 folder 自身的視角消失。（**此條為回歸護欄，非新行為的驗收**：它
在本能力實作之前即成立，存在的理由是擋住「既然能切過去，就不該在這裡出現」這個看似合理的錯誤
推論。）

#### Scenario: 選定 worktree 後樹根隨之改變

- **WHEN** 使用者於 Files 身分選定一個位於 folder 邊界內的 linked worktree
- **THEN** 檔案樹呈現該 worktree 根目錄的直接子項目
- **AND** 樹上呈現的路徑不含該 worktree 的 folder-relative 前綴

#### Scenario: 同名檔案在不同工作目錄有不同內容

- **WHEN** 某個相同路徑的檔案在 folder 自身與某個 worktree 各有不同內容，使用者於兩個工作目錄
  之間切換並開啟該檔案
- **THEN** 檔案檢視呈現的是**當前選定工作目錄**的那一份內容

#### Scenario: 工作目錄的內容不重複呈現於 folder 自身的視角

- **WHEN** 使用者選定 folder 自身，而該 repo 的 worktree 位於 folder 邊界內
- **THEN** 檔案樹仍如既往呈現 folder 根目錄的內容（worktree 目錄本身是其中一個項目）

### Requirement: 工作目錄的選擇為 per-session，預設為 folder 自身

每個 session SHALL 記住自己的工作目錄選擇。side panel 呈現的工作目錄 SHALL 為 **focused session
的選擇**；切換 focused session 時 SHALL 隨之改變。

預設值 SHALL 為 **folder 自身**，SHALL NOT 為該 repo 的主工作目錄 —— folder 本身可能就是一個
linked worktree，此時該 repo 的主工作目錄對使用者而言是「別的地方」，而不是預設視角。

沒有任何 session 時（例如剛加入、尚未建立 session 的 folder），工作目錄 SHALL 為 folder 自身。

**folder 自身 SHALL 以「沒有工作目錄識別碼」表示**，SHALL NOT 以其 repo 主工作目錄的識別碼表示
—— 後者會使同一個邏輯狀態有兩種表示，而「切換來源時重置」與「工作目錄已消失時退回」兩條要求就
沒有唯一的正確值可寫。這與 `terminal-sessions` 對「session 開在 folder 根」的既有表示法一致，
且它同時涵蓋 folder 不位於版控之下的情形（那時根本不存在任何識別碼）。

#### Scenario: 預設為 folder 自身

- **WHEN** 使用者於一個尚未選過工作目錄的 session 切換至 Files 身分
- **THEN** 檔案樹以該 folder 的根目錄為根

#### Scenario: folder 本身是 linked worktree

- **WHEN** 一個 workspace folder 本身是某個 repo 的 linked worktree，使用者於其 session 切換至
  Files 身分
- **THEN** 檔案樹以**該 folder**（即該 linked worktree）為根，而非該 repo 的主工作目錄

#### Scenario: 切換 focused session 時工作目錄隨之改變

- **WHEN** sessionA 選定了某個 worktree、sessionB 維持預設，使用者於兩者之間切換 focus
- **THEN** Files 身分的樹根隨 focused session 的選擇改變

### Requirement: 工作目錄選擇器僅在工作目錄多於一個時呈現

Files 身分 SHALL 於工作目錄多於一個時呈現選擇器，並於恰有一個時 SHALL NOT 呈現它。

**判準為清單的筆數，SHALL NOT 為可選取的筆數。** 一個項目全部停用的清單仍然在回答「這個 repo
還有哪些工作目錄」—— 噪音的定義是「沒有資訊」，不是「沒有可點的東西」。以可選取的筆數為判準會把
「有東西但你看不了」整個藏起來，與本能力對邊界外工作目錄的呈現要求自相矛盾（folder 為 repo 子目錄
時，清單恰為「自身 + 不可瀏覽的主工作目錄」）。

選擇器 SHALL 以分支呈現各工作目錄的身分；分支缺席時（detached HEAD）SHALL 以該工作目錄的 HEAD
識別呈現，SHALL NOT 呈現空白標籤。它 SHALL NOT 呈現任何路徑，且 SHALL 可完全以鍵盤操作（本 repo
對選單的既有紀律）。

該工作目錄是否為其 repo 的主工作目錄 SHALL 僅用於呈現（例如不為其加註來源標記，對齊既有做法），
SHALL NOT 用於判定預設值或任何能力的可用性 —— 那些一律以「是否為 folder 自身」判定。

#### Scenario: 單一工作目錄的 repo 不呈現選擇器

- **WHEN** 側欄來源 repo 只有一個工作目錄
- **THEN** Files 身分不呈現工作目錄選擇器

#### Scenario: 唯一的其他工作目錄不可瀏覽時仍呈現選擇器

- **WHEN** 側欄來源 folder 是某個 repo 的子目錄，該 repo 的主工作目錄位於 folder 邊界之外
- **THEN** Files 身分呈現工作目錄選擇器，其中該主工作目錄為停用項

#### Scenario: 多個工作目錄時可選取

- **WHEN** 側欄來源 repo 有多個工作目錄，使用者開啟選擇器
- **THEN** 各工作目錄以其分支列出，選取其中之一後檔案樹以它為根

#### Scenario: detached HEAD 的工作目錄仍可辨識

- **WHEN** 某個 linked worktree 處於 detached HEAD，使用者開啟選擇器
- **THEN** 該項目以其 HEAD 識別呈現，而非空白標籤

#### Scenario: 選擇器不呈現路徑

- **WHEN** 使用者開啟工作目錄選擇器
- **THEN** 選項中不含任何絕對路徑或 folder-relative 路徑

### Requirement: 位於 folder 邊界外的工作目錄呈現但停用

工作目錄位於 folder 邊界之外時 SHALL 於選擇器中呈現且 SHALL 為停用，並 SHALL 說明其不可瀏覽的
原因。它 SHALL NOT 自選擇器省略。

省略會製造一個更糟的不一致：OpenSpec 身分**看得見**該 worktree 的 change（聚合是完整的，僅檔案
導覽降級 —— 見 `worktree-aggregation`），而 Files 的選擇器卻找不到對應的工作目錄，使用者無從得知
那是刻意的限制還是應用程式沒看見它。

停用項 SHALL NOT 呈現任何路徑（它沒有 folder-relative 路徑，而絕對路徑不得交給 renderer）。

#### Scenario: 邊界外的工作目錄不可選取

- **WHEN** 該 repo 有一個位於 folder 邊界外的 linked worktree，使用者開啟工作目錄選擇器
- **THEN** 該工作目錄出現於選項中且為停用狀態，並附有無法於此瀏覽的說明

#### Scenario: 邊界內的工作目錄可選取

- **WHEN** 該 repo 同時有邊界內與邊界外的 linked worktree，使用者開啟工作目錄選擇器
- **THEN** 邊界內的工作目錄可被選取

### Requirement: 切換側欄來源 repo 時重置工作目錄

使用者切換側欄來源 repo 時，該 session 的工作目錄選擇 SHALL 被重置為 folder 自身。

工作目錄的識別碼隸屬於某個 repo —— 沿用舊 repo 的識別碼，新 repo 的清單中查無此項，檔案樹會對著
一個不存在的根呈現空狀態。這與 `side-panel-source` 既有的「切換來源時重置錨定的 change」是同一條
理由（座標的隸屬關係）。

#### Scenario: 切換來源 repo 後工作目錄回到預設

- **WHEN** focused session 的側欄來源為 repoA 且選定了 repoA 的某個 worktree，使用者將側欄來源
  切至 repoB
- **THEN** Files 身分以 repoB 的 folder 根目錄為樹根

### Requirement: 使用者主動切換工作目錄時關閉開啟中的檔案

使用者**經選擇器**切換工作目錄時，Files 身分 SHALL 回到檔案樹，SHALL NOT 嘗試於新的工作目錄開啟
同一個路徑的檔案。

**本要求的觸發條件為使用者的選取動作，SHALL NOT 為工作目錄狀態的變更本身。** 跨身分導覽亦會切換
工作目錄（見下一條要求）而其後續正是開啟一個檔案 —— 兩者若共用同一個觸發點，導覽會依實作順序
變成「開了又關」或「關了又開」。

切換工作目錄的語意是**換一個上下文**，不是換同一個檔案的另一個版本。後者是版本比較的需求，而此
機制只給得出它的半吊子版本（檔案於新工作目錄可能不存在、兩份內容無法並排、沒有差異呈現）。

未存的變更 SHALL NOT 因切換工作目錄而遺失（它們以完整的 folder-relative 路徑為鍵，切換樹根不改變
該鍵）。

#### Scenario: 切換工作目錄後回到樹

- **WHEN** 使用者開啟某個檔案後切換工作目錄
- **THEN** Files 身分呈現新工作目錄的檔案樹，而非任何檔案的內容

#### Scenario: 未存的變更跨工作目錄切換存活

- **WHEN** 使用者於某個檔案有未存的變更，切換至另一個工作目錄後再切回並重新開啟該檔案
- **THEN** 該檔案的未存變更仍在

### Requirement: 自 OpenSpec 身分跳往檔案時工作目錄一併切換

自 OpenSpec 身分觸發的檔案導覽 SHALL 使 Files 身分的工作目錄一併切換至該目標所在的工作目錄，
且該檔案 SHALL 於切換後的樹根之下被開啟。

少了這一步，跨身分導覽會把使用者送到一個他沒選過的樹上、或開啟一個樹根之外的檔案 —— 兩者都會讓
麵包屑與樹的內容自相矛盾。

判定目標落在哪一個工作目錄時 SHALL 以最長的相符根為準（工作目錄的根可能互為前綴，見
`worktree-aggregation` 的反向導覽判定）。

#### Scenario: 自 worktree 的 change 跳往其檔案

- **WHEN** 使用者於 OpenSpec 身分檢視一個來源為 worktree 的 change 的 artifact，並觸發檔案導覽
- **THEN** Files 身分以該 worktree 為樹根，並開啟該檔案

#### Scenario: 導覽完成後仍可跳回 OpenSpec 身分

- **WHEN** 承上，使用者於該檔案觸發跳回 OpenSpec 身分的入口
- **THEN** OpenSpec 身分呈現該 change（一趟完整的往返）

### Requirement: 工作目錄的選擇不擴大檔案系統的可達範圍

檔案系統的可達位置集合 SHALL NOT 因工作目錄的選擇而改變。renderer 對檔案系統的定址 SHALL 維持
`(folder 識別碼, folder-relative 路徑)`，SHALL NOT 新增任何指定工作目錄的參數；邊界 SHALL 仍由
主行程於每一次呼叫時夾制。

**本能力的工作目錄查表擔保的是誠實性，不是圍堵性** —— 它只決定樹根的前綴，renderer 即使組出一個
不存在的前綴，可達的位置集合也一點都不會變大（那是 folder 邊界之內）。這與 `terminal-sessions`
的工作目錄識別碼**不同**：後者決定 pty 的工作目錄，而那可以落在 folder 邊界之外，故其查表擔保的
是圍堵性。

#### Scenario: 檔案系統介面不新增工作目錄參數

- **WHEN** 檢視 renderer 可用的檔案系統能力介面
- **THEN** 其中不存在任何讓 renderer 指定工作目錄的參數

#### Scenario: 邊界外的路徑仍被拒絕

- **WHEN** 任一工作目錄被選定後，對一個逃逸出 folder 邊界的路徑發出檔案系統請求
- **THEN** 該請求如既往被拒絕

