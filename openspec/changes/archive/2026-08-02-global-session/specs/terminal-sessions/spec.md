## ADDED Requirements

### Requirement: session 的歸屬有兩種，且兩者在型別上互斥

一個 session 的**歸屬** SHALL 為下列之一：某個 workspace folder，或**全域**（不隸屬於任何
folder，見 `global-session`）。

renderer 與 preload 的介面 SHALL 在型別上使這兩者**互斥且不可混淆**：表達「不隸屬任何 folder」的
方式 SHALL NOT 是一個保留的 folder 識別碼字串。以字串偽裝會使每一處「以識別碼查找 folder」的呼叫
靜默地查回空值而非錯誤，而型別檢查對此無能為力。

**型別互斥發生在 renderer 與 preload，輸入驗證發生在 IPC 的入口** —— 兩者不可互相取代：主行程收到
的是**不受信任的輸入**（IPC 的另一端可能是被入侵或過期的 renderer），因此
`global-session`「全域 session 帶工作目錄識別碼即拒絕」那條 SHALL 在主行程實作並可被測試，
SHALL NOT 以「型別上表達不出來」為由略去。

本能力的其餘要求（雙向串流、尺寸同步、生命週期釋放、標題、複製貼上、命名權）SHALL 同等適用於兩種
歸屬的 session，SHALL NOT 因歸屬而有差異。

#### Scenario: 兩種歸屬的 session 並存

- **WHEN** 使用者同時開啟一個隸屬於某 folder 的 session 與一個全域 session
- **THEN** 兩者各自運作，各自的終端內容互不影響

#### Scenario: 全域 session 同樣享有本能力的其餘保證

- **WHEN** 使用者於一個全域 session 內調整終端尺寸、選取文字並複製、為該 session 命名
- **THEN** 其行為與隸屬於 folder 的 session 相同

#### Scenario: 歸屬的表達不以保留識別碼字串偽裝

- **WHEN** 檢視建立 session 的能力介面與 session 的執行期狀態
- **THEN** 「不隸屬任何 folder」以一個與 folder 識別碼互斥的形式表達，而非一個保留的字串值

## MODIFIED Requirements

### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 為該 folder 的根目錄，**或該 folder 所屬 repo 的某個工作目錄（git worktree）的根**；由 `session-persistence` **重建**的 session SHALL 為其最後已知的工作目錄，該目錄無法取得或不落在上述任一之下時 SHALL 退回該 folder 的根目錄。

**本要求的適用範圍為隸屬於某個 folder 的 session。** 不隸屬任何 folder 的 session 其位置解析、
工作目錄與邊界論證由 `global-session` 定義。

renderer SHALL 僅以 `folderId` 與一個**工作目錄識別碼**指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑。工作目錄識別碼 SHALL 為不可逆的值（不含路徑資訊），主行程 SHALL 以**查表**方式將它解析為路徑，且查表的範圍 SHALL 為 `folderId` 所指涉之 folder 所屬的 repo —— 於是 renderer 可達的位置集合恆等於**該 folder 所屬 repo** 之工作目錄的列舉結果，仍由結構保證，而非由字串驗證事後補救。

**全域歸屬 SHALL NOT 使上述保證鬆動**：它不引入任何新的路徑詞彙、識別碼空間或查表 —— renderer 至多
表達「這是一個全域 session」這件事，位置是主行程的常數。於是可達的位置集合恰好擴大**一個由主行程
決定的元素**（見 `global-session`）。

工作目錄的列舉 SHALL 與側欄 OpenSpec 資料所用的列舉**同源且同參數**。兩者若各自列舉，可達的位置集合就可能大於使用者在介面上看得到的集合，而上述「恆等於」的保證即失效。

主行程 SHALL 在工作目錄識別碼查無對應時**拒絕建立**，SHALL NOT 退回 folder 的根目錄 —— 靜默退回會讓一個錯誤的識別碼把 session 開在別的地方，而使用者以為它開在他選的工作目錄裡。

**重建的工作目錄仍不經 renderer 之手**：renderer 至多供應一個不可逆識別碼，路徑的解析、驗證與夾制一律由主行程完成（見 `session-persistence`）。主行程自行取得的工作目錄（例如 shell 的最後位置）SHALL NOT 送往 renderer。**此禁令的作用域為持久化** —— 狀態列為呈現而取得的當下工作目錄不在其內（見 `status-bar`）。

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
- **THEN** 它僅接受歸屬（`folderId`，或全域）、spawn 目標與工作目錄識別碼，不存在讓 renderer 指定工作目錄路徑的參數

#### Scenario: 工作目錄識別碼不含路徑資訊

- **WHEN** 檢視 renderer 取得的工作目錄識別碼
- **THEN** 其值不可逆推為檔案系統路徑，且不含 workspace 之外位置的任何片段
