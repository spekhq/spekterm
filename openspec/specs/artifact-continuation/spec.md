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

- **WHEN** 當前的側欄座標沒有錨定任何 change，且衍生預設不成立
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

**focused session 為全域 session 時，條件 1 SHALL 判定為不成立。** 全域 session 沒有自身所屬的
folder（見 `global-session`），因此無論側欄來源為何，該條件都無法成立。

**此判定 SHALL 先確認該 session 是否為全域 session，SHALL NOT 由兩個缺席值的相等比較得出。**
全域 session 所屬的 folder 為缺席值，而全域項目的側欄來源**預設也是**缺席值 —— 樸素的相等比較會
使兩者「相等」而讓入口**亮起來**，隨後把 change 識別碼送進一個站在家目錄的 agent，它會在家目錄
建出一個同名的空 change。**這個誤判的方向是啟用而非停用**，其後果不是少一個可用的按鈕，而是
agent 在錯的地方動手，且使用者以為它在對的地方。

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

#### Scenario: focused session 為全域 session 時停用

- **WHEN** focused session 為一個正在執行的**全域** claude session，而側欄來源指向某個 repo
  且錨定了它的一個 change
- **THEN** 續寫入口呈現為停用狀態
- **AND** 呈現其不可用的原因
- **AND** 不送出任何指示

#### Scenario: 全域 session 且來源亦未選定時仍然停用

- **WHEN** focused session 為一個正在執行的**全域** claude session，且該全域項目的側欄來源尚未選定
- **THEN** 續寫入口呈現為停用狀態 —— SHALL NOT 因 session 所屬 folder 與側欄來源同為缺席值而啟用

#### Scenario: 條件全部成立時可用

- **WHEN** 側欄來源等於 focused session 自身的 folder，該 session 為正在執行的 claude，
  其錨定的 change 來源工作目錄即該 session 的工作目錄，且該 change 尚有未產生的 artifact
- **THEN** 續寫入口可用

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

### Requirement: 錨定的跨項目寫入，其驗收以來源與選中項為不同兩筆進行

「於該工作目錄開啟 session」的入口把錨定寫入**側欄來源 folder**，此行為的驗收 SHALL 以
「側欄來源 folder 與 rail 上選中的 folder 為**不同兩筆**」進行，SHALL NOT 僅以兩者為同一筆的
情形代表。

**理由是鑑別力，而且失效方向是假綠**：兩者為同一筆時，「寫入來源 folder」與「寫入 focused
folder」**產生完全相同的結果**。一個總是寫進 focused folder 的實作，在該前提下與正確實作在
可觀察行為上無法區分 —— 而那正是本能力**唯一的跨項目寫入**，它的失效是靜默的（使用者要切
rail focus 過去才會發現側欄是空狀態，那時他已經不記得是哪一步造成的）。

**判準 SHALL 為正向的（來源 folder 收到了錨定），SHALL NOT 表述為「rail 上選中的那一筆未被
寫入」。** 後者無論怎麼寫都沒有鑑別力，理由是一個結構事實：**錨定的鍵是 rail 上選中的項目，
不是側欄來源**。要讓側欄呈現來源 repo 的某個 change，使用者必須先錨定它，而那一筆就寫進 rail
選中的 folder（唯一的例外是側欄來源**恰有一個** active change 時的衍生預設）。於是在觸發該入口
的那一刻，該 change **已經**是 rail 選中那一筆的錨定：

- 寫成「未**變為**該 change」⇒ 對**正確**實作為假
- 寫成「未**被改動**」⇒ 對「兩邊都寫」的實作為真（它寫入的是一個已經在那裡的值）

而「兩邊都寫」在這條路徑上**沒有可觀察的傷害** —— 選中那一筆的錨定本來就是該 change，不存在
「先前的錨定被無聲換掉」。**為它增設載體是在防一個不存在的傷害。**

#### Scenario: 跨項目寫入的驗收以不同兩筆進行

- **WHEN** 驗證「側欄來源指向另一個 repo 時錨定寫入該來源 folder」
- **THEN** 該次驗收所建立的前置中，rail 上選中的 folder 與側欄來源為不同兩筆
- **AND** 判準為「切換至來源 folder 後其錨定為該 change」，而非「rail 上選中的那一筆未被寫入」
