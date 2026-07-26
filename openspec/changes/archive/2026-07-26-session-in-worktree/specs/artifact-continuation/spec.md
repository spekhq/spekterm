## MODIFIED Requirements

### Requirement: 續寫入口僅在目標 session 能承接時可用

續寫入口 SHALL 僅在下列條件**全部**成立時可用：

1. 側欄來源 **等於** focused session 自身所屬的 folder；
2. focused session 的 spawn 目標為 `claude`；
3. 該 session 正在執行（有 pty）；
4. 錨定 change 的**來源工作目錄，就是該 session 的工作目錄**。

條件不成立時，入口 SHALL 以**停用狀態**呈現並說明原因，SHALL NOT 消失 —— 消失會讓使用者以為
這個功能不存在或已損壞，而停用加說明才讓他知道怎樣它才會亮。

條件 1 是正確性要求，不是語意潔癖：agent 的工作目錄是它自己的 repo，把另一個 repo 的 change
識別碼送進去會查無此 change；而兩個 repo 恰有同名 change 時，agent 會在**錯的 repo** 動手。

條件 4 是條件 1 在同一個 repo 之內的更細粒度版本，成立的理由完全相同：change 只存在於**另一個**
工作目錄時，送進去的識別碼查無此 change —— 更糟的情況是 agent 在 session 所在之處**建出一個
同名的空 change**。

**此條件 SHALL 以 session 的實際工作目錄判定**，SHALL NOT 以「來源是否為該 repo 的主工作目錄」、
亦 SHALL NOT 以「來源是否為 session 所屬的 folder」判定。前者在 folder 本身即 linked worktree 時
會錯誤地停用一個會成功的入口；後者在 session 開在該 folder 的某個 worktree 時會做出相同的誤判
（`terminal-sessions` 起 session 的工作目錄不再恆等於其 folder 的根目錄）。

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

- **WHEN** 錨定的 change 其來源工作目錄不是 focused session 的工作目錄，而該 session 為正在
  執行的 claude session
- **THEN** 續寫入口呈現為停用狀態
- **AND** 呈現其不可用的原因
- **AND** 不送出任何指示

#### Scenario: session 開在該 change 的工作目錄時入口可用

- **WHEN** 錨定的 change 存在於某個 linked worktree，而 focused session 是一個開在**該 worktree**
  的、正在執行的 claude session
- **THEN** 續寫入口可用

#### Scenario: session 開在別的工作目錄時仍然停用

- **WHEN** 錨定的 change 存在於 worktree A，而 focused session 開在同一個 repo 的 worktree B
- **THEN** 續寫入口呈現為停用狀態 —— 「session 能開在工作目錄」不使這個條件變得多餘，只使它需要
  更精確的判準

#### Scenario: folder 本身是 linked worktree 時入口可用

- **WHEN** 一個 folder 本身是該 repo 的 linked worktree，錨定的 change 存在於該 worktree，
  focused session 為其中正在執行的 claude session
- **THEN** 續寫入口可用 —— 該 change 並非位於主工作目錄，但 session 的工作目錄正是它的所在

#### Scenario: 條件全部成立時可用

- **WHEN** 側欄來源等於 focused session 自身的 folder，該 session 為正在執行的 claude，
  其錨定的 change 來源工作目錄即該 session 的工作目錄，且該 change 尚有未產生的 artifact
- **THEN** 續寫入口可用

## ADDED Requirements

### Requirement: 側欄提供於 change 的來源工作目錄開啟 session 的入口

側欄 SHALL 於**錨定 change 的來源工作目錄不是任何可承接之 session 的工作目錄**時，額外提供一個
入口，觸發後於**該 change 的來源工作目錄**建立一個 `claude` session。

此入口的呈現條件 SHALL NOT 限於「因條件 4 而停用」。停用原因的回報有優先序，`noSession`／
`notClaude`／`notRunning` 皆先於條件 4 —— 而**使用者最常遇到的正是那些**：剛開啟應用程式、在側欄
看到一個 worktree 裡的 change 時，他還沒有任何 session。若只在條件 4 停用時呈現，他就得**先在
錯的地方開一個 session**，才看得見「在對的地方開一個 session」的入口。

該來源工作目錄未出現於該 repo 的工作目錄列舉中時，此入口 SHALL NOT 呈現 —— 呈現一個必定失敗的
入口比不呈現更糟。**位於 folder 邊界外並不構成不可用**：邊界外的工作目錄照樣開得了 session，
只有**檔案導覽**會因翻不出 folder-relative 路徑而降級（見 `worktree-aggregation`）。

此入口 SHALL 僅建立 session，SHALL NOT 一併送出續寫指示。建立 session 與送出指示是兩件可各自
失敗的事；併為一次點擊時，使用者無從得知失敗的是哪一件。

新建的 session SHALL 錨定該 change —— 否則它成為 focused session 之後，側欄會落入「尚無錨定」的
空狀態（衍生預設只在該 repo 恰有一個 active change 時成立，而「一個 change 一個 worktree」的
工作流下通常不只一個），續寫入口連呈現的機會都沒有。

#### Scenario: 尚無任何 session 時即呈現該入口

- **WHEN** 錨定的 change 存在於某個 linked worktree，而該 repo 尚無任何 session
- **THEN** 側欄呈現一個「於該工作目錄開啟 session」的入口

#### Scenario: focused session 的工作目錄不是該 change 的來源時呈現該入口

- **WHEN** 錨定的 change 存在於某個 linked worktree，而 focused session 是一個開在別處的、
  正在執行的 claude session
- **THEN** 側欄呈現一個「於該工作目錄開啟 session」的入口

#### Scenario: 觸發後於該工作目錄建立 session 並錨定該 change

- **WHEN** 使用者觸發該入口
- **THEN** 一個 `claude` session 於該 change 的來源工作目錄建立，成為 focused session，並錨定該 change
- **AND** 未送出任何續寫指示

#### Scenario: 建立後續寫入口可用

- **WHEN** 使用者接續上一個情境
- **THEN** 續寫入口不再停用

#### Scenario: 已有開在該工作目錄的 session 時不呈現該入口

- **WHEN** focused session 正是一個開在該 change 來源工作目錄的、正在執行的 claude session
- **THEN** 不呈現「於該工作目錄開啟 session」的入口（續寫入口本身已可用）

#### Scenario: 來源工作目錄不可用時不呈現該入口

- **WHEN** 錨定 change 的來源工作目錄未出現於該 repo 的工作目錄列舉中
- **THEN** 不呈現「於該工作目錄開啟 session」的入口

#### Scenario: 來源工作目錄位於 folder 邊界外時仍呈現該入口

- **WHEN** 錨定 change 的來源工作目錄位於 folder 邊界之外，但出現於工作目錄的列舉中
- **THEN** 呈現該入口 —— 邊界外只影響檔案導覽，不影響能否於該處開啟 session
