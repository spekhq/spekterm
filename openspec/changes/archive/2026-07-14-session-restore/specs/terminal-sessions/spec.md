## MODIFIED Requirements

### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 落在該 folder 的**邊界內** —— 新建的 session SHALL 為該 folder 的根目錄；由 `session-persistence` **重建**的 session SHALL 為其最後已知的工作目錄，該目錄無法取得或越出邊界時 SHALL 退回該 folder 的根目錄。

renderer SHALL 僅以 `folderId` 指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑 —— 於是 renderer 在語彙上無法把 session 的初始工作目錄指向 workspace folder 之外。此定址方式使邊界由結構保證，而非由字串驗證事後補救。**重建的工作目錄不構成例外**：它由主行程自行取得、驗證與夾制，不經 renderer 之手（見 `session-persistence`）。

此邊界只約束**初始**工作目錄。session 一旦啟動即為真實 shell，pty 內執行的命令 SHALL NOT 被此邊界限制 —— 這與 `filesystem-access` 那種「renderer 只能觸及 workspace」的沙箱語意不同。

#### Scenario: 於可用 folder 建立成功

- **WHEN** renderer 以一個已加入且狀態正常的 `folderId` 建立 session
- **THEN** 主行程回傳一個 session 識別碼，且該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 重建的 session 其初始工作目錄仍落在邊界內

- **WHEN** 一個重建的 session 被啟動，而其最後已知的工作目錄位於該 folder 之外
- **THEN** 該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 拒絕未註冊的 folder 識別碼

- **WHEN** 建立 session 的 `folderId` 不對應任何已加入 workspace 的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 拒絕路徑失效的 folder

- **WHEN** 建立 session 的 `folderId` 對應一個路徑已失效的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 建立介面不接受任何路徑參數

- **WHEN** 檢視建立 session 的能力介面
- **THEN** 它僅接受 `folderId` 與 spawn 目標，不存在讓 renderer 指定工作目錄路徑的參數
