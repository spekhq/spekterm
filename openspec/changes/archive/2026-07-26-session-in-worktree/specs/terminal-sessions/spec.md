## MODIFIED Requirements

### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 為該 folder 的根目錄，**或該 folder 所屬 repo 的某個工作目錄（git worktree）的根**；由 `session-persistence` **重建**的 session SHALL 為其最後已知的工作目錄，該目錄無法取得或不落在上述任一之下時 SHALL 退回該 folder 的根目錄。

renderer SHALL 僅以 `folderId` 與一個**工作目錄識別碼**指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑。工作目錄識別碼 SHALL 為不可逆的值（不含路徑資訊），主行程 SHALL 以**查表**方式將它解析為路徑，且查表的範圍 SHALL 為 `folderId` 所指涉之 folder 所屬的 repo —— 於是 renderer 可達的位置集合恆等於**該 folder 所屬 repo** 之工作目錄的列舉結果，仍由結構保證，而非由字串驗證事後補救。

工作目錄的列舉 SHALL 與側欄 OpenSpec 資料所用的列舉**同源且同參數**。兩者若各自列舉，可達的位置集合就可能大於使用者在介面上看得到的集合，而上述「恆等於」的保證即失效。

主行程 SHALL 在工作目錄識別碼查無對應時**拒絕建立**，SHALL NOT 退回 folder 的根目錄 —— 靜默退回會讓一個錯誤的識別碼把 session 開在別的地方，而使用者以為它開在他選的工作目錄裡。

**重建的工作目錄仍不經 renderer 之手**：renderer 至多供應一個不可逆識別碼，路徑的解析、驗證與夾制一律由主行程完成（見 `session-persistence`）。主行程自行取得的工作目錄（例如 shell 的最後位置）SHALL NOT 送往 renderer。

此邊界只約束**初始**工作目錄。session 一旦啟動即為真實 shell，pty 內執行的命令 SHALL NOT 被此邊界限制 —— 這與 `filesystem-access` 那種「renderer 只能觸及 workspace」的沙箱語意不同。

#### Scenario: 於可用 folder 建立成功

- **WHEN** renderer 以一個已加入且狀態正常的 `folderId` 建立 session，未指定工作目錄
- **THEN** 主行程回傳一個 session 識別碼，且該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 於指定的工作目錄建立 session

- **WHEN** renderer 以一個 `folderId` 與該 repo 某個 linked worktree 的工作目錄識別碼建立 session
- **THEN** 該 session 的 pty 初始工作目錄為該 worktree 的根

#### Scenario: 於 folder 邊界之外的工作目錄建立 session

- **WHEN** 指定的 worktree 位於該 folder 的邊界之外（例如 `/tmp` 之下）
- **THEN** 該 session 仍於該 worktree 的根建立 —— 合法性來自工作目錄的列舉，不是路徑的包含關係

#### Scenario: 拒絕查無對應的工作目錄識別碼

- **WHEN** 建立 session 所帶的工作目錄識別碼不對應該 repo 的任何工作目錄
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty
- **AND** 不以該 folder 的根目錄替代之

#### Scenario: 重建的 session 其初始工作目錄仍受夾制

- **WHEN** 一個重建的 session 被啟動，而其最後已知的工作目錄既不在該 folder 之下、也不在該 repo 任何工作目錄之下
- **THEN** 該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 拒絕未註冊的 folder 識別碼

- **WHEN** 建立 session 的 `folderId` 不對應任何已加入 workspace 的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 拒絕路徑失效的 folder

- **WHEN** 建立 session 的 `folderId` 對應一個路徑已失效的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 建立介面不接受任何路徑參數

- **WHEN** 檢視建立 session 的能力介面
- **THEN** 它僅接受 `folderId`、spawn 目標與工作目錄識別碼，不存在讓 renderer 指定工作目錄路徑的參數

#### Scenario: 工作目錄識別碼不含路徑資訊

- **WHEN** 檢視 renderer 取得的工作目錄識別碼
- **THEN** 其值不可逆推為檔案系統路徑，且不含 workspace 之外位置的任何片段
