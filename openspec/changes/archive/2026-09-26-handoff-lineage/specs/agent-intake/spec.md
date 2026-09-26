## MODIFIED Requirements

### Requirement: 接受一則 intake 於確認的 folder 建立 agent session

**建立一個由 intake 觸發的 session 時**（使用者接受一則待處理的 intake，或一則到達時即被接受的
項目），系統 SHALL 於該則 intake 的**目標 folder** 建立一個 **agent 目標**的 session。目標 folder
為：使用者接受時**確認的** folder（見 `intake-routing`「接受時由使用者確認目標 folder，系統不替他
補預設值」）；到達時即被接受的項目為**接收端解析出的** folder。

session SHALL 經與使用者手動建立時**相同的路徑**建立 —— 於是它一樣進入 session 清單、一樣被
持久化、一樣可被關閉與重建。系統 SHALL NOT 以繞過該路徑的方式建立 pty。該路徑所接受的參數
SHALL 只為此多出**一項**：一張由主行程簽發、指明「這個新 session 是為哪一則交接建立的」的**單次憑證**
（見 `session-lineage`）。它 SHALL NOT 影響 pty 的啟動參數、工作目錄與注入設定 —— 它唯一的效果是
讓主行程寫入該 session 的來源。

**本條的作用域以「session 由 intake 觸發」為準，不以「使用者按下接受」為準** —— 否則一條到達時
即接受的路徑會在字面上不受本條約束，而它建立 pty 的方式正是本條要管的事。

**系統 SHALL NOT 代使用者指定該 session 的名稱**（spekterm 的標籤）—— 指定名稱在既有能力中被
定義為「使用者永久接管命名權」，此後 pty 宣告的終端標題將被靜默地不予呈現。由系統代為指定，等於
替使用者按下一個只有他能按的開關，而他不會知道要如何還原。

**這與 agent 的固定名字（見 `agent-peer-name`）是兩件事。** 後者是 agent CLI 的訊息地址，對**每一個**
claude session 一律指定、不分是否由 intake 建立；它的已知效果是 agent 宣告的終端標題固定為該名字、
不再依任務改寫。那是使用者知情接受的代價，由 `agent-peer-name` 記載，**不是**本條所禁止的「代為
指定標籤」—— 標籤仍反映 pty 宣告的標題，使用者仍可自行命名。

**由 intake 建立的 session，其啟動參數 SHALL 與同一個 folder 手動建立者等價**：除了對話識別碼、
系統注入設定的位置與固定名字的**值**之外**逐項相同**，且參數的**個數相同**。系統注入的 agent 設定，其頂層欄位
**SHALL 恰為**既有注入所定義的那一組。

**兩處都刻意寫成等價／白名單而非「不得含某些值」**：後者是黑名單，只擋得住列舉得出來的東西，
而它在今日恆真（啟動路徑根本沒有能加旗標的參數）——**一條恆真的斷言撐不住任何東西**。

**本能力 SHALL NOT 宣稱它保證了 agent 的許可姿態。** 那由使用者自己的設定與**目標 repo 自己的
設定**決定，而目標 repo 是由 routing 或使用者選出的 —— 本能力保證的是「不降低它」，不是「它夠緊」。

#### Scenario: 於解析出的 folder 建立，而不是於選中的或第一個 folder

- **WHEN** workspace 中有三個 folder，rail 上選中的是第三個，routing 規則解析到第二個，使用者
  未改選即接受
- **THEN** 新的 agent session 建立於**第二個** folder，且出現在該 folder 的 session 清單中

#### Scenario: 由 intake 建立的 session 與手動建立者一同被重建

- **WHEN** 同一個 folder 中有一個由 intake 建立與一個手動建立的 agent session，應用程式重新啟動
- **THEN** 兩者都被重建

#### Scenario: session 的名稱未被系統指定

- **WHEN** 一則 intake 被接受並建立 session，其後 agent 宣告一個終端標題
- **THEN** 該標題最終呈現於該 session 的標籤上

#### Scenario: 啟動參數與手動建立者等價

- **WHEN** 於同一個 folder 各建立一個由 intake 觸發與一個手動觸發的 agent session
- **THEN** 兩者的啟動參數在去除對話識別碼、注入設定位置與固定名字的值之後完全相同
- **AND** 兩者的參數個數相同

#### Scenario: 注入設定的頂層欄位未因本能力而增加

- **WHEN** 一則 intake 被接受並建立 session
- **THEN** 系統注入的 agent 設定，其頂層欄位集合與手動建立時相同

#### Scenario: 到達時即接受者其啟動參數同樣等價

- **WHEN** 一則到達時即被接受的交接建立了 session，同一個 folder 另有一個手動建立的 agent session
- **THEN** 兩者的啟動參數在去除對話識別碼、注入設定位置與固定名字的值之後完全相同

#### Scenario: 單次憑證不改變啟動參數

- **WHEN** 同一個 folder 中，一個 agent session 以交接的單次憑證建立、另一個手動建立
- **THEN** 兩者的啟動參數在去除對話識別碼、注入設定位置與固定名字的值之後完全相同
