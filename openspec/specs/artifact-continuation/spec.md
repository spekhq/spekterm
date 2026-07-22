# artifact-continuation Specification

## Purpose
TBD - created by archiving change panel-drive-and-shell-affordances. Update Purpose after archive.
## Requirements
### Requirement: 側欄於 change 尚有未產生的 artifact 時提供續寫入口

OpenSpec 側欄的「本 change」視圖 SHALL 在其呈現的 change **尚有未產生的 artifact** 時，
提供一個續寫入口，並 SHALL 指出**尚缺哪些** artifact。

入口 SHALL NOT 承諾它將產生哪一個特定的 artifact —— 挑選的權威在 OpenSpec 的 schema 依賴規則
（`design` / `specs` 依賴 `proposal`、`tasks` 依賴兩者），側欄複製那套規則就是複製一份會過期的
權威。因此入口 SHALL 為單一入口，而非每個缺漏的 artifact 各一個。

#### Scenario: change 尚缺 artifact 時呈現入口

- **WHEN** 側欄呈現的 change 已有 proposal，但尚無 design、specs 與 tasks
- **THEN** 本 change 視圖呈現續寫入口
- **AND** 入口指出尚缺 design、specs 與 tasks

#### Scenario: artifact 齊備時不呈現入口

- **WHEN** 側欄呈現的 change 的 proposal、design、specs、tasks 皆已存在
- **THEN** 本 change 視圖不呈現續寫入口

#### Scenario: 無錨定 change 時不呈現入口

- **WHEN** 當前 focused session 沒有錨定任何 change
- **THEN** 本 change 視圖不呈現續寫入口

### Requirement: 觸發續寫入口即把指示送進該 session 並執行

觸發續寫入口 SHALL 把一則續寫指示寫入 **focused session 的 pty 並使其執行**（即附帶
Enter），SHALL NOT 僅填入而等待使用者再次確認。

該指示 SHALL **明確指名**側欄當下呈現的那個 change（以其識別碼），SHALL NOT 倚賴 agent 自行
推斷要續寫哪一個 change —— 未指名時 OpenSpec 的續寫流程必須反問使用者，而那正是本能力要消除
的來回。

觸發後，焦點 SHALL 落在該 session 的終端上，使用者 SHALL 能立即接續與 agent 對話而不必再次
點擊終端。

#### Scenario: 觸發後 pty 收到指名該 change 的指示並執行

- **WHEN** 使用者觸發續寫入口
- **THEN** 該 session 的 pty 收到一則包含該 change 識別碼的指示
- **AND** 該指示以 Enter 結尾（即已送出執行）

#### Scenario: 觸發後焦點落在終端

- **WHEN** 使用者以滑鼠觸發續寫入口
- **THEN** 焦點位於該 session 的終端
- **AND** 使用者隨即鍵入的字元進入該 pty

### Requirement: 續寫入口僅在目標 session 能承接時可用

續寫入口 SHALL 僅在下列條件**全部**成立時可用：

1. 側欄來源 **等於** focused session 自身所屬的 folder；
2. focused session 的 spawn 目標為 `claude`；
3. 該 session 正在執行（有 pty）；
4. 錨定 change 的**來源工作目錄，就是該 session 所屬的 folder 本身**。

條件不成立時，入口 SHALL 以**停用狀態**呈現並說明原因，SHALL NOT 消失 —— 消失會讓使用者以為
這個功能不存在或已損壞，而停用加說明才讓他知道怎樣它才會亮。

條件 1 是正確性要求，不是語意潔癖：agent 的工作目錄是它自己的 repo，把另一個 repo 的 change
識別碼送進去會查無此 change；而兩個 repo 恰有同名 change 時，agent 會在**錯的 repo** 動手。

條件 4 是條件 1 在同一個 repo 之內的更細粒度版本，成立的理由完全相同：session 的工作目錄是該
folder 的**根目錄**，而 change 只存在於**另一個**工作目錄時，送進去的識別碼同樣查無此 change ——
更糟的情況是 agent 在 session 所在之處**建出一個同名的空 change**。

此條件 SHALL NOT 以「來源是否為該 repo 的主工作目錄」判定 —— folder 本身就是一個 linked worktree
時，session 的 cwd 正是該 worktree，指示會成功，而那個判準會錯誤地停用入口。要問的是**來源與
session 所屬 folder 是否為同一個工作目錄**。

此條件 SHALL 隨「session 能開在其他工作目錄」的能力出現而重新評估。

當 focused session 不符條件、但同一個 repo 另有符合條件的 session 時，入口 SHALL 維持停用，
SHALL NOT 改送給那個 session —— 對一個使用者沒有在看的終端發話，比停用更糟。

#### Scenario: 側欄來源指向別的 repo 時停用

- **WHEN** 側欄來源被指向 workspace 中另一個 folder，而 focused session 屬於原本的 folder
- **THEN** 續寫入口呈現為停用狀態
- **AND** 呈現其不可用的原因

#### Scenario: focused session 為 shell 時停用

- **WHEN** focused session 的 spawn 目標為 login shell
- **THEN** 續寫入口呈現為停用狀態
- **AND** 即使同一個 repo 另有正在執行的 claude session，指示亦不送出

#### Scenario: session 休眠或已結束時停用

- **WHEN** focused session 處於休眠或已結束狀態
- **THEN** 續寫入口呈現為停用狀態

#### Scenario: 錨定 change 來自另一個工作目錄時停用

- **WHEN** 錨定的 change 其來源工作目錄不是 focused session 所屬的 folder，而該 session 為正在
  執行的 claude session
- **THEN** 續寫入口呈現為停用狀態
- **AND** 呈現其不可用的原因
- **AND** 不送出任何指示

#### Scenario: folder 本身是 linked worktree 時入口可用

- **WHEN** 一個 folder 本身是該 repo 的 linked worktree，錨定的 change 存在於該 worktree，
  focused session 為其中正在執行的 claude session
- **THEN** 續寫入口可用 —— 該 change 並非位於主工作目錄，但 session 的工作目錄正是它的所在

#### Scenario: 條件全部成立時可用

- **WHEN** 側欄來源等於 focused session 自身的 folder，該 session 為正在執行的 claude，
  其錨定的 change 來源工作目錄即該 folder 本身，且該 change 尚有未產生的 artifact
- **THEN** 續寫入口可用

