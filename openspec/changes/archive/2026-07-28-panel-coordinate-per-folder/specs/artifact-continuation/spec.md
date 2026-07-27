## MODIFIED Requirements

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

- **WHEN** 當前的側欄座標沒有錨定任何 change，且衍生預設不成立
- **THEN** 本 change 視圖不呈現續寫入口

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

**該 change SHALL 成為新 session 所屬 folder 的錨定** —— 否則使用者切到該 folder 之後，側欄會
落入「尚無錨定」的空狀態（衍生預設只在該 repo 恰有一個 active change 時成立，而「一個 change
一個 worktree」的工作流下通常不只一個），續寫入口連呈現的機會都沒有。

**錨定的對象是 folder 而非該 session**（錨定自 `terminal-sessions` 改基至 `side-panel-source`
的側欄座標）。側欄來源即 rail 上選中的 folder 時，該 change **本來就已經**是那個 folder 的錨定
（否則側欄不會正在呈現它），此要求自動成立；側欄來源指向另一個 repo 時，錨定 SHALL 被寫入**該
來源 folder** 的座標 —— 使用者切換過去時讀到的正是那一筆。

#### Scenario: 尚無任何 session 時即呈現該入口

- **WHEN** 錨定的 change 存在於某個 linked worktree，而該 repo 尚無任何 session
- **THEN** 側欄呈現一個「於該工作目錄開啟 session」的入口

#### Scenario: focused session 的工作目錄不是該 change 的來源時呈現該入口

- **WHEN** 錨定的 change 存在於某個 linked worktree，而 focused session 是一個開在別處的、
  正在執行的 claude session
- **THEN** 側欄呈現一個「於該工作目錄開啟 session」的入口

#### Scenario: 觸發後於該工作目錄建立 session 並錨定該 change

- **WHEN** 使用者觸發該入口
- **THEN** 一個 `claude` session 於該 change 的來源工作目錄建立，成為 focused session，且該
  change 為其所屬 folder 的錨定
- **AND** 未送出任何續寫指示

#### Scenario: 建立後續寫入口可用

- **WHEN** 使用者接續上一個情境
- **THEN** 續寫入口不再停用

#### Scenario: 側欄來源指向另一個 repo 時錨定寫入該來源 folder

- **WHEN** rail 上選中的 folder 為 repoA、側欄來源為 repoB，使用者觸發該入口
- **THEN** 該 change 成為 **repoB** 的錨定；使用者於 rail 上切換到 repoB 時，本 change 視圖
  呈現該 change

#### Scenario: 已有開在該工作目錄的 session 時不呈現該入口

- **WHEN** focused session 正是一個開在該 change 來源工作目錄的、正在執行的 claude session
- **THEN** 不呈現「於該工作目錄開啟 session」的入口（續寫入口本身已可用）

#### Scenario: 來源工作目錄不可用時不呈現該入口

- **WHEN** 錨定 change 的來源工作目錄未出現於該 repo 的工作目錄列舉中
- **THEN** 不呈現「於該工作目錄開啟 session」的入口

#### Scenario: 來源工作目錄位於 folder 邊界外時仍呈現該入口

- **WHEN** 錨定 change 的來源工作目錄位於 folder 邊界之外，但出現於工作目錄的列舉中
- **THEN** 呈現該入口 —— 邊界外只影響檔案導覽，不影響能否於該處開啟 session
