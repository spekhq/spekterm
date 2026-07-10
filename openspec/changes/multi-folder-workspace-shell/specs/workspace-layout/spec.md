## ADDED Requirements

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
