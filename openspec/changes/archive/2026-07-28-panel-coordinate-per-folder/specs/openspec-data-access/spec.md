## MODIFIED Requirements

### Requirement: 主行程供應可供選擇的工作目錄清單

主行程 SHALL 為一個 folder 供應該 folder 所屬 repo 的**可供選擇的工作目錄**清單，每筆 SHALL 含：
其 folder-relative 根（無法翻譯時為 `null`）、分支（detached HEAD 時為 `null`）、該工作目錄的
HEAD 識別（供分支缺席時呈現）、它是否為該 repo 的主工作目錄，以及**不可逆的工作目錄識別碼**。
清單 SHALL NOT 包含任何絕對路徑。

**代表 folder 自身的那一筆，其識別碼 SHALL 可省略**，且 folder 不位於版控之下時 SHALL 為省略
—— 該情形下工作目錄的列舉為空，不存在任何識別碼可用。這與 `terminal-sessions` 對「folder 根」
的既有表示法一致（省略識別碼即 folder 根），使同一個邏輯狀態只有**一種**表示，而非「省略」與
「主工作目錄的識別碼」兩種。

**這與既有的「主行程供應各工作目錄的 folder-relative 根」是兩個不同的問題，兩者並存**：

- 既有的那條回答「哪些根可用於**定位 OpenSpec 內容**」，供反向交叉導覽判定路徑歸屬。邊界外的
  工作目錄與該問題無關（其檔案不在該 folder 的檔案樹中），故整筆省略是它的正確行為。
- 本要求回答「這個 repo **有哪些工作目錄，各自能不能瀏覽**」，供 `side-panel-worktree` 的選擇器
  呈現。邊界外的工作目錄**必須在列**且標示為不可瀏覽 —— 省略它會讓使用者無從得知那是刻意的限制
  還是應用程式沒看見它。

清單 SHALL 恆包含代表 folder 自身的**恰好一筆**，其 folder-relative 根為空字串，不論該 folder
是否位於版控之下、是否為某個 repo 的子目錄、亦不論工作目錄的列舉是否成功（延續既有那條的同一
理由：folder 自身的可瀏覽性 SHALL NOT 取決於 git 的列舉結果）。

**該筆 SHALL 由合併產生，SHALL NOT 額外附加**：工作目錄的列舉中若有一筆其位置即 folder 根，
該筆**就是**代表 folder 自身的那一筆（其 folder-relative 根為空字串，其分支與識別碼照常供應）；
列舉中沒有這樣一筆時，才另行合成一筆。**兩者擇一，恆不並存。**

這條之所以必須明寫：folder-relative 的翻譯對「與根相同的位置」回傳的是「無法翻譯」而非空字串
（那是既有的翻譯語意）。若照「合成一筆 + 翻譯其餘各筆」的結構實作，**每一個 folder 即其 repo 主
工作目錄的普通 repo**（最常見的情形）都會產出兩筆：一筆合成的 folder 自身，加一筆「無法翻譯」的
主工作目錄 —— 而後者正是使用者當下所在的位置，卻會被呈現為位於此 folder 之外、不可瀏覽。

**識別碼與 folder-relative 根兩者皆為必要，且用途不同**：識別碼供 renderer 保存選擇並落盤
（**落盤的座標不得含路徑** —— 見 `side-panel-source` 的「側欄座標跨應用程式重啟存活」；
`session-persistence` 對 session 自己的落盤資料有同源的要求），folder-relative 根供 renderer
組成檔案系統請求的路徑前綴。

清單 SHALL 與 `terminal-sessions` 用於解析 session 工作目錄的列舉**同源同參數** —— 兩者若各自
列舉，使用者在 Files 中看得到的工作目錄集合就可能與他能在其中開 session 的集合不一致。

該清單 SHALL 隨該 folder 的 OpenSpec 結構變更而更新，SHALL NOT 為此另行建立監看（工作目錄的新增
與移除已在既有的監看範圍之內，見 `worktree-aggregation`）。

#### Scenario: 清單包含 folder 自身與邊界內外的工作目錄

- **WHEN** renderer 為一個 folder 請求可供選擇的工作目錄清單，而該 repo 同時有位於 folder 邊界內
  與邊界外的 linked worktree
- **THEN** 清單包含代表 folder 自身的一筆，其 folder-relative 根為空字串
- **AND** 清單包含邊界內的 worktree，其 folder-relative 根為相對路徑
- **AND** 清單包含邊界外的 worktree，其 folder-relative 根為 `null`

#### Scenario: folder 即其 repo 的主工作目錄且無 linked worktree

- **WHEN** 一個 folder 是一個普通 git repo 的根，該 repo 沒有任何 linked worktree
- **THEN** 清單**恰含一筆**，其 folder-relative 根為空字串
- **AND** 清單中不存在另一筆代表同一個位置、而其 folder-relative 根為 `null` 的項目

#### Scenario: folder 不在任何版控之下

- **WHEN** 一個 folder 不是 git repo、也不在任何 git repo 之內
- **THEN** 清單恰包含代表 folder 自身的一筆
- **AND** 該筆不帶工作目錄識別碼

#### Scenario: 清單不含絕對路徑

- **WHEN** 檢視清單中的任一筆
- **THEN** 其中不含任何絕對路徑，邊界外的工作目錄亦僅以識別碼與分支表示

#### Scenario: 代表 folder 自身以外的每一筆皆帶可用於落盤的識別碼

- **WHEN** renderer 取得一個位於版控之下、且有 linked worktree 的 folder 的清單
- **THEN** 代表 folder 自身以外的每一筆皆帶一個不可逆的工作目錄識別碼，且該識別碼與
  `terminal-sessions` 用於指定 session 工作目錄者為同一組

#### Scenario: 分支缺席時仍可辨識工作目錄

- **WHEN** 該 repo 的某個 linked worktree 處於 detached HEAD
- **THEN** 該筆的分支為 `null`，且其 HEAD 識別非空，足以在介面上辨識該工作目錄

#### Scenario: folder 自身為 linked worktree 時仍在列且可辨識

- **WHEN** 一個 workspace folder 本身是某個 repo 的 linked worktree
- **THEN** 清單中代表 folder 自身的那一筆其 folder-relative 根為空字串，且其「是否為主工作目錄」
  為否
