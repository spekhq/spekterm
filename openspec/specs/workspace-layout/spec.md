## Purpose

活動列、workspace rail、主舞台三欄的版面骨架。分界可拖動與鍵盤操作、side panel 可收合、
rail 呈現每個 folder 的身分（含「無 `openspec/`」與「路徑失效」的標示）。
UI 版面與行為以 `docs/workspace-mockup.html` 為權威。
## Requirements
### Requirement: 主視窗呈現活動列、workspace rail 與主舞台三個區域

renderer SHALL 呈現 `docs/workspace-mockup.html` 所定義的三塊版面：活動列、workspace rail、主舞台。主舞台 SHALL 內含一個可與其並列的 side panel 區域。

UI 的版面與行為以該雛型為權威。

#### Scenario: 啟動後三個區域同時存在

- **WHEN** 應用程式啟動並完成 renderer 載入
- **THEN** 活動列、workspace rail 與主舞台三個區域同時存在於畫面上，且各自可被程式化識別

### Requirement: 區域之間的分界可拖動且受最小寬度夾制

活動列與 rail、rail 與主舞台、主舞台內部與 side panel 之間的分界 SHALL 可拖動以調整兩側寬度。每個區域 SHALL 有最小寬度，拖動 SHALL 被夾制於該下限，SHALL NOT 使區域寬度歸零。

分界 SHALL 可由鍵盤操作，並具備可被輔助技術辨識的角色語意。

#### Scenario: 拖動分界改變兩側寬度

- **WHEN** 使用者拖動 rail 與主舞台之間的分界
- **THEN** 兩側區域的寬度隨之改變

#### Scenario: 拖動不得使區域寬度歸零

- **WHEN** 使用者將分界拖過某一側的最小寬度
- **THEN** 該側停留於最小寬度，不會消失

#### Scenario: 分界可由鍵盤操作

- **WHEN** 分界取得鍵盤焦點並收到方向鍵
- **THEN** 兩側區域的寬度隨之改變

### Requirement: side panel 可收合並還原原寬度

使用者 SHALL 能收合 side panel，使主舞台的其餘部分佔滿可用寬度。再次展開時 SHALL 還原收合前的寬度。

#### Scenario: 收合 side panel

- **WHEN** 使用者觸發收合
- **THEN** side panel 自畫面消失，主舞台其餘部分佔滿其原本所在的空間

#### Scenario: 展開後還原先前寬度

- **WHEN** 使用者調整 side panel 寬度後將其收合，再重新展開
- **THEN** side panel 以收合前的寬度重新出現

### Requirement: rail 呈現每個 folder 的名稱與身分

workspace rail SHALL 為每個已加入的 folder 呈現一列，顯示其名稱，並反映該 folder 的兩種身分狀態：是否含有 `openspec/`、路徑是否失效。

不含 `openspec/` 的 folder SHALL 被明確標示，且其 OpenSpec 身分的入口 SHALL 為停用狀態 —— 使用者應在點擊之前就知道該 repo 只能以 Files 身分使用。

rail 底部 SHALL 提供加入 folder 的入口。

#### Scenario: 含 openspec 的 folder

- **WHEN** rail 呈現一個含有 `openspec/` 的 folder
- **THEN** 其 OpenSpec 身分的入口為可用狀態

#### Scenario: 不含 openspec 的 folder

- **WHEN** rail 呈現一個不含 `openspec/` 的 folder
- **THEN** 該列明確標示此事，且其 OpenSpec 身分的入口為停用狀態

#### Scenario: 路徑失效的 folder

- **WHEN** rail 呈現一個路徑已失效的 folder
- **THEN** 該列明確標示此事

#### Scenario: 自 rail 加入 folder

- **WHEN** 使用者觸發 rail 底部的加入入口
- **THEN** 開啟原生目錄選擇對話框

### Requirement: 活動列呈現尚未實作的入口為停用狀態

活動列 SHALL 呈現雛型所定義的全部入口。本 change 尚未實作的入口 SHALL 呈現為停用狀態，並說明其尚未可用，SHALL NOT 於點擊後無聲無息。

保留位置而非隱藏，是為了讓版面比例自第一天起就與雛型一致；標示停用而非靜默，是為了讓使用者知道那不是壞掉。

#### Scenario: 尚未實作的活動列入口

- **WHEN** 使用者檢視活動列中尚未實作的入口
- **THEN** 該入口呈現為停用狀態，並附有說明其尚未可用的提示

#### Scenario: 已實作的活動列入口

- **WHEN** 使用者檢視 Sessions 入口
- **THEN** 該入口為可用狀態且為預設選取

### Requirement: side panel 呈現 OpenSpec 與 Files 兩個同層互斥身分

主舞台的 repo header SHALL 提供切換 side panel 身分的入口。OpenSpec 與 Files 是 side panel 的兩個同層級、互斥的身分：任一時刻 SHALL 只顯示其中一個，且兩者 SHALL 與左側的主舞台其餘部分並存。

身分切換的行為以 `docs/workspace-mockup.html` 的 `#panel-switch` 為權威。

#### Scenario: 切換至 Files 身分

- **WHEN** 使用者於 repo header 觸發 Files 身分的入口
- **THEN** side panel 呈現 Files 身分的內容，OpenSpec 身分的內容不再顯示

#### Scenario: 一次只顯示一個身分

- **WHEN** 檢視 side panel
- **THEN** OpenSpec 與 Files 之中恰有一個身分的內容被呈現

#### Scenario: 當前身分於入口上可辨識

- **WHEN** 使用者檢視身分切換的入口
- **THEN** 當前顯示的身分於該入口上被明確標示

### Requirement: 收合狀態下觸發任一身分皆重新展開 side panel

side panel 處於收合狀態時，觸發任一身分的入口 SHALL 重新展開 side panel 並顯示該身分的內容。

#### Scenario: 收合後觸發身分入口

- **WHEN** side panel 已收合，使用者觸發 Files 身分的入口
- **THEN** side panel 重新展開並呈現 Files 身分的內容

### Requirement: OpenSpec 為條件式身分，Files 恆可用

當前選中的 folder 不含 `openspec/` 時，OpenSpec 身分的入口 SHALL 為停用狀態，且該狀態 SHALL 可被輔助技術辨識。Files 身分 SHALL 恆為可用。

這是「spek 以 OpenSpec 為核心，但版面不因缺少 OpenSpec 就殘廢」的體現 —— 使用者應在點擊之前就知道該 repo 只能以 Files 身分使用。

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** OpenSpec 身分的入口為停用狀態，Files 身分的入口為可用狀態

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder
- **THEN** OpenSpec 與 Files 兩個身分的入口皆為可用狀態

#### Scenario: 停用的身分不可被切換至

- **WHEN** 使用者觸發一個停用的身分入口
- **THEN** side panel 的當前身分不改變

### Requirement: 主舞台為當前 repo 呈現 session 分頁列

主舞台 SHALL 在 repo header 與 terminal／side panel 版面之間，為**當前選中的 repo** 呈現其 session 的分頁列。此分頁列 SHALL 標示當前 focused 的 session、SHALL 提供在 session 之間切換的方式、SHALL 提供建立新 session 的入口（該入口 SHALL 讓使用者選擇 spawn 目標），且每個分頁 SHALL 可關閉。

每個分頁 SHALL 提供右鍵選單，其中 SHALL 至少包含**重新命名**與**關閉**。

建立新 session 的入口 SHALL 緊鄰最後一個分頁之後，SHALL NOT 被推離分頁而置於分頁列的另一端 —— 它是分頁的延伸，使用者剛看完分頁就會伸手去點它。

當前 repo 尚無任何 session 時，該區域 SHALL 呈現空狀態，並提供明顯的建立 session 入口。

分頁列僅呈現當前選中 repo 的 session —— 主舞台只屬於當前選中的 repo。

#### Scenario: 呈現當前 repo 的多個 session

- **WHEN** 當前選中的 repo 有多個 session
- **THEN** 分頁列為每個 session 呈現一項，且當前 focused 的 session 被標示

#### Scenario: 切換 focused session

- **WHEN** 使用者於分頁列點選另一個 session
- **THEN** focused session 切換為該 session，終端顯示其內容

#### Scenario: 建立新 session 可選 spawn 目標

- **WHEN** 使用者觸發建立新 session 的入口
- **THEN** 使用者可選擇 spawn 目標為 `claude` 或 login shell

#### Scenario: 建立入口緊鄰最後一個分頁

- **WHEN** 分頁列中已有一或多個分頁
- **THEN** 建立新 session 的入口緊接於最後一個分頁之後，而非位於分頁列的另一端

#### Scenario: 分頁的右鍵選單

- **WHEN** 使用者於一個分頁按下右鍵
- **THEN** 出現包含重新命名與關閉的選單，且該選單完整落在可視範圍內

#### Scenario: 關閉分頁

- **WHEN** 使用者關閉分頁列中的一個 session
- **THEN** 該 session 自分頁列移除

#### Scenario: 當前 repo 無 session

- **WHEN** 當前選中的 repo 沒有任何 session
- **THEN** 該區域呈現空狀態與建立 session 的入口

### Requirement: rail 於每個 folder 之下呈現其 session 子列

workspace rail 的每個 folder 列之下 SHALL 呈現該 folder 的 session 子列，反映該 folder 的所有 session（不限於當前選中的 repo）。子列 SHALL 可被點選以聚焦該 session，點選時 SHALL 選中其所屬的 folder 並將該 session 設為 focused。folder 的 session 子列 SHALL 可展開與收合。

rail 的每個 folder 列 SHALL 提供建立 session 的入口，該入口 SHALL 讓使用者選擇 spawn 目標，且 SHALL 選中該 folder 並聚焦新建立的 session —— 使用者在 rail 上看得到 session，就應當能在原地開一個，不必先切換到主舞台。

rail 的每個 session 子列 SHALL 提供關閉該 session 的入口，其效果與自分頁列關閉相同，並 SHALL 提供右鍵選單，其中 SHALL 至少包含**重新命名**與**關閉**。

#### Scenario: folder 之下呈現其 session

- **WHEN** 一個 folder 有一或多個 session
- **THEN** 其列之下呈現對應的 session 子列

#### Scenario: 自 rail 聚焦 session

- **WHEN** 使用者點選一個 folder 的某個 session 子列
- **THEN** 該 folder 被選中，且該 session 成為其 focused session

#### Scenario: 自 rail 建立 session

- **WHEN** 使用者於 rail 的某個 folder 列觸發建立 session 的入口並選擇 spawn 目標
- **THEN** 該 folder 之下新增一個 session，該 folder 被選中，且新 session 成為 focused

#### Scenario: 自 rail 關閉 session

- **WHEN** 使用者於 rail 的某個 session 子列觸發關閉入口
- **THEN** 該 session 被關閉並自 rail 與分頁列一併移除

#### Scenario: rail 子列的右鍵選單

- **WHEN** 使用者於 rail 的一個 session 子列按下右鍵
- **THEN** 出現包含重新命名與關閉的選單，且該選單完整落在可視範圍內

#### Scenario: 收合與展開 session 子列

- **WHEN** 使用者收合一個 folder，其後再展開
- **THEN** 收合時其 session 子列隱藏，展開時還原呈現

### Requirement: session 的順序可由使用者拖曳調整，且兩個視圖共用同一順序

使用者 SHALL 能以滑鼠拖曳調整同一 repo 之下 session 的順序，於**分頁列**與 **rail 的 session 子列**兩處皆可。

兩處 SHALL 反映**同一個順序** —— 它是 session 在該 repo 內的次序，不是某個視圖的裝飾。於一處調整順序後，另一處 SHALL 隨之呈現相同的次序。

拖曳 SHALL 僅在同一個 repo 之內進行。session 的工作目錄於其 pty 啟動時即已決定，將它移到另一個 repo 之下在語意上不成立。

拖曳與點擊 SHALL 被區分：未產生實際位移的按下與放開 SHALL 被視為一次點擊（切換 focused session），SHALL NOT 被當作拖曳。

#### Scenario: 拖曳分頁改變順序

- **WHEN** 使用者將分頁列中的一個 session 拖曳至另一個位置
- **THEN** 分頁列以新的順序呈現該 repo 的 session

#### Scenario: 兩個視圖的順序一致

- **WHEN** 使用者於分頁列調整了 session 的順序
- **THEN** rail 的 session 子列以相同的順序呈現

#### Scenario: 自 rail 拖曳亦改變順序

- **WHEN** 使用者於 rail 的 session 子列拖曳一個 session 至另一個位置
- **THEN** 該 repo 的 session 順序改變，且分頁列以相同的新順序呈現

#### Scenario: 未位移的按下視為點擊

- **WHEN** 使用者於一個 session 上按下並放開滑鼠，期間未產生實際位移
- **THEN** 該 session 成為 focused，順序不變

