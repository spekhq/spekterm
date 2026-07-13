## ADDED Requirements

### Requirement: 主行程為每個 folder 供應其 git 當前分支

主行程 SHALL 為 workspace 中的每個 folder 判定其 git 當前分支，並提供給 renderer。

分支 SHALL 為**衍生狀態** —— 於載入 workspace 與加入 folder 時判定，SHALL NOT 持久化於設定檔。
（比照 `hasOpenSpec`：持久化一個會在 app 之外改變的值，只會保證它是錯的。）

#### Scenario: 位於某分支上的 repo

- **WHEN** 主行程判定一個 checkout 於分支 `master` 的 folder
- **THEN** 該 folder 的分支為 `master`

#### Scenario: 不是 git repo 的 folder

- **WHEN** 主行程判定一個不含 git 版控的 folder
- **THEN** 該 folder 沒有分支（無分支是**合法狀態**，不是錯誤）
- **AND** 該 folder 仍正常出現在 workspace 中，其餘功能不受影響

### Requirement: 分支讀取不得執行外部程式

分支的判定 SHALL 以檔案系統讀取完成，SHALL NOT spawn `git` 或任何其他外部程式。

理由與 `workspace-folders` 的「偵測 folder 是否含有 openspec 目錄」同源：這是在**每個 folder、
每次載入**都會發生的判定，且 rail 是使用者最先看到的東西。它必須是廉價且同步可得的。

#### Scenario: 判定期間不產生子行程

- **WHEN** 主行程為所有 folder 判定分支
- **THEN** 判定期間未 spawn 任何子行程

### Requirement: 分支變動時 rail 隨之更新

當 folder 的當前分支在 app 之外改變時，rail 呈現的分支 SHALL 隨之更新，SHALL NOT 停留在舊值。

這是本 app 的前提：使用者就在旁邊的 terminal 裡操作這些 repo。一個切完 branch 還顯示舊分支的
rail，比不顯示分支更糟 —— 它看起來像是真的。

#### Scenario: 於 terminal 中切換分支

- **WHEN** 使用者在該 folder 的 terminal session 中切換到另一個分支
- **THEN** rail 上該 folder 的分支更新為新分支，無需重新啟動 app 或重新載入 workspace

#### Scenario: folder 在 app 執行期間變成 git repo

- **WHEN** 一個原本不是 git repo 的 folder 於 app 執行期間被初始化為 git repo
- **THEN** rail 上該 folder 開始呈現其分支

### Requirement: detached HEAD 與非分支狀態不使 rail 失效

當 repo 處於 detached HEAD（HEAD 不指向任何分支）時，該 folder SHALL 呈現一個可辨識的替代標示
（如短 commit sha），SHALL NOT 呈現空白、亦 SHALL NOT 使該列或 rail 進入錯誤狀態。

git 有多種 HEAD 不指向分支的狀態（detached、rebase 中、bisect 中）。rail 是一個**旁觀者**，
它 SHALL 在任何 git 狀態下都能安然呈現。

#### Scenario: detached HEAD

- **WHEN** 一個 folder 的 HEAD 為 detached
- **THEN** 該列呈現可辨識的替代標示（短 commit sha），rail 正常運作

#### Scenario: 損毀或無法解讀的 git 狀態

- **WHEN** 一個 folder 的 git 狀態無法解讀
- **THEN** 該 folder 視為沒有分支，rail 正常運作，app 不崩潰

### Requirement: git 目錄與工作目錄分離的形式必須被支援

分支判定 SHALL 在 git 目錄與工作目錄分離時仍然正確 —— 即 `.git` 是一個**檔案**而非目錄、其內容
指向他處的真正 git 目錄（git worktree 與 submodule 的形式）。

#### Scenario: folder 是一個 git worktree

- **WHEN** 主行程判定一個 `.git` 為檔案（內容指向他處 git 目錄）的 folder
- **THEN** 正確得出該 worktree 的當前分支

### Requirement: 分支的供應不擴大 renderer 的檔案系統詞彙

推送給 renderer 的 SHALL 僅為分支名稱（或其替代標示）字串，SHALL NOT 包含任何檔案系統路徑。

主行程為讀取分支所存取的檔案 MAY 位於 folder 邊界之外（git worktree 的 git 目錄常在他處），
但那是**主行程自己的**檔案存取，不經 renderer 的 `(folderId, relPath)` 詞彙，因此 SHALL NOT
被誤解為 `filesystem-access` 白名單的擴大 —— renderer 依然無從指定要讀哪個路徑。

#### Scenario: renderer 只收到分支名稱

- **WHEN** renderer 取得某 folder 的分支
- **THEN** 它收到的是分支名稱字串，其中不含任何絕對路徑
