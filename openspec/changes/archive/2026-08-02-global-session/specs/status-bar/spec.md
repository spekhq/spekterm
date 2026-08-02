## MODIFIED Requirements

### Requirement: 狀態列呈現 focused session 的脈絡

狀態列 SHALL 呈現當前 focused session 的脈絡資訊，至少包含：其所屬 repo 的名稱、該 repo 的
git 當前分支、該 session 的標籤，以及**當前側欄座標所錨定的 change**（若有）與該 change 的任務
進度（若有）。

**focused session 為全域 session 時**（見 `global-session`），它沒有所屬 repo。狀態列 SHALL 改以
一個明確的**全域身分**標示取代 repo 名稱，SHALL NOT 留下空白、SHALL NOT 呈現任何 folder 的名稱
—— 呈現一個它不屬於的 repo 比不呈現更糟。其餘欄位（session 標籤、執行狀態、工作目錄、錨定的
change 與進度）SHALL 照常呈現。

**git 分支不隨 repo 名稱一併消失**：分支與工作區狀態衍生自該 session 的**工作目錄**而非其所屬
folder（見下一條「呈現該 session 的工作目錄與 git 工作區狀態」）—— 使用者在全域 session 裡
`cd` 進任一 repo 之後，分支與 dirty 標示 SHALL 照常呈現，那正是他當下最需要的欄位。
工作目錄不在任何 git 工作區內時（含**家目錄本身**，見 `global-session` 的偵測豁免），
SHALL NOT 呈現分支欄位。

**錨定的 change 隸屬於 rail 上選中的項目，而非該 session**（見 `side-panel-source`）—— 於是同一個
項目的多個 session 於狀態列上呈現同一個 change。這不構成歧義：狀態列的其餘欄位（標籤、執行
狀態、工作目錄）本就逐 session 而異，而 change 是「這個 repo 我正在看哪一個」的答案。

**沒有 focused session 時，本條所述的整條脈絡 SHALL 呈現為空狀態，SHALL NOT 因為側欄座標在無
session 時依然存在而單獨呈現其中的 change。** 這一條在改基之前是隱含的（座標不存在，無從呈現），
改基之後必須明寫 —— 否則照字面實作會得到一條只剩半截的狀態列。

側欄來源**不等於 rail 上選中的項目**時，狀態列 SHALL 一併標示側欄來源；
**相等時 SHALL NOT 標示** —— 那是常態，標示它等於在每一列都重複同一個值。
**此判定 SHALL 先確認選中的項目是否具備自身 repo**，SHALL NOT 由兩個缺席值的相等比較得出：全域
項目沒有自身 repo，其來源尚未選定時兩端同為缺席，樸素的比較會判定「來源即自身」—— 而那句話對
全域項目沒有意義。來源未選定時 SHALL NOT 標示任何來源。

#### Scenario: 呈現 focused session 的 repo 與分支

- **WHEN** 存在 focused session
- **THEN** 狀態列呈現該 session 所屬 repo 的名稱與其 git 當前分支

#### Scenario: 全域 session 以全域身分取代 repo 名稱

- **WHEN** focused session 為一個全域 session，其工作目錄為家目錄
- **THEN** 狀態列以全域身分標示取代 repo 名稱，不呈現任何 folder 的名稱，且不呈現分支欄位

#### Scenario: 全域 session cd 進 repo 後呈現該處的分支

- **WHEN** 使用者於一個全域 session 內切換到某個 git 工作區之下
- **THEN** 狀態列呈現該工作區的分支與 dirty 標示，且仍以全域身分標示取代 repo 名稱

#### Scenario: 全域 session 的其餘欄位照常呈現

- **WHEN** focused session 為一個全域 session，且其側欄座標錨定了一個含 tasks 的 change
- **THEN** 狀態列呈現該 session 的標籤、執行狀態，以及該 change 的識別碼與任務完成進度

#### Scenario: 呈現錨定的 change 與進度

- **WHEN** 存在 focused session，且當前的側欄座標錨定了一個含 tasks 的 change
- **THEN** 狀態列呈現該 change 的識別碼與其任務完成進度

#### Scenario: 沒有 focused session 時不單獨呈現 change

- **WHEN** 使用者選中一個尚無任何 session、而其側欄座標錨定了某個 change 的 folder
- **THEN** 狀態列呈現無 session 的空狀態，而非該 change

#### Scenario: 側欄來源指向別的 repo 時標示

- **WHEN** 側欄來源被指向 workspace 中另一個 folder
- **THEN** 狀態列標示側欄來源

#### Scenario: 側欄來源即自身時不標示

- **WHEN** 側欄來源等於 rail 上選中的 folder
- **THEN** 狀態列不標示側欄來源

#### Scenario: 全域項目的來源未選定時不標示來源

- **WHEN** focused session 為全域 session，而該全域項目的側欄來源尚未選定
- **THEN** 狀態列不標示任何側欄來源

#### Scenario: 全域項目已選定來源時標示它

- **WHEN** focused session 為全域 session，而該全域項目的側欄來源已被指向某個 folder
- **THEN** 狀態列標示該側欄來源 —— 全域項目沒有「來源即自身」的常態可言，選定了就一律標示

#### Scenario: 切換 focused session 時內容隨之改變

- **WHEN** 使用者把焦點切換到另一個 session
- **THEN** 狀態列呈現的脈絡改為該 session 的

### Requirement: 寬度不足時由右往左省略，優先保留 repo 與分支

狀態列的內容超出可用寬度時 SHALL **由右往左**省略，且 SHALL 優先保留 repo 名稱與 git 分支。
focused session 為**全域 session** 時，取代它們的**全域身分標示** SHALL 享有同等的保留優先序 ——
那是使用者辨識「我現在打的字會送到哪裡」的第一個依據，而全域 session 沒有 repo 名稱可依。
狀態列 SHALL NOT 因內容過長而換行，亦 SHALL NOT 產生橫向捲動 —— 它的高度是版面契約的一部分。

此要求是本能力存在的理由本身：使用者的 agent 自行繪製的狀態行之所以會被截斷，正是因為它與
終端內容**共用同一個寬度**；狀態列若以同樣的方式失控，就沒有解決任何問題。

#### Scenario: 視窗變窄時仍看得到 repo 與分支

- **WHEN** 主視窗寬度縮減至狀態列內容無法完整呈現
- **THEN** repo 名稱與 git 分支仍然可見
- **AND** 狀態列維持單行，且不出現橫向捲動

#### Scenario: 視窗變窄時全域身分標示仍然可見

- **WHEN** focused session 為全域 session，主視窗寬度縮減至狀態列內容無法完整呈現
- **THEN** 全域身分標示仍然可見
- **AND** 狀態列維持單行，且不出現橫向捲動

### Requirement: 狀態列呈現只有 spekterm 知道的工作區事實

狀態列 SHALL 呈現下列 spekterm 獨有的事實：**當前 rail 項目**的 session 數與 workspace 的 session
總數、focused session 的執行狀態、**side panel 中未存檔的緩衝區數**，以及側欄來源 repo 的 spec 數
與進行中的 change 數。

**「當前 rail 項目的 session 數」涵蓋全域項目**（見 `global-session`）—— 以 folder 為條件計算會
使全域項目的計數恆為零，而它明明有 N 個 session。workspace 的 session 總數 SHALL 一併計入全域
session。

**側欄來源尚未選定時**（全域項目的預設狀態），spec 數與進行中的 change 數 SHALL NOT 呈現 ——
沒有來源就沒有這兩個數字，呈現 0 會讓使用者以為那個 repo 是空的。

未存檔的緩衝區數為零時 SHALL NOT 呈現該欄位 —— 它是一個警示，恆常呈現會讓它失去警示的作用。

#### Scenario: 呈現 session 計數

- **WHEN** 當前 rail 項目有數個 session，而 workspace 中另有其他項目的 session
- **THEN** 狀態列同時呈現當前項目的 session 數與 workspace 的總數

#### Scenario: 全域項目的 session 計入

- **WHEN** 選中全域項目，它有數個 session
- **THEN** 狀態列呈現該全域項目的 session 數（非零），且 workspace 總數包含這些 session

#### Scenario: 來源未選定時不呈現 spec 與 change 數

- **WHEN** 選中全域項目而其側欄來源尚未選定
- **THEN** 狀態列不呈現 spec 數與進行中的 change 數

#### Scenario: 有未存檔的變更時呈現，沒有時不呈現

- **WHEN** side panel 中有未存檔的緩衝區
- **THEN** 狀態列呈現其數量
- **WHEN** 沒有任何未存檔的緩衝區
- **THEN** 狀態列不呈現該欄位

### Requirement: 無可呈現的脈絡時狀態列仍存在並呈現空狀態

狀態列 SHALL 在沒有可呈現的脈絡時仍然存在，並 SHALL 呈現一個說明當下狀態的空狀態，SHALL NOT
呈現為一列空白。

**空狀態的條件為「沒有 focused session」**，SHALL NOT 為「workspace 沒有任何 folder」——
自 `global-session` 起這兩者不再等價：workspace 一個 folder 都沒有時，使用者仍可於全域項目擁有
數個 session，而那時狀態列 SHALL 呈現該 session 的脈絡而非空狀態。

#### Scenario: workspace 為空且無任何 session 時

- **WHEN** workspace 中沒有任何 folder，且尚未建立任何 session
- **THEN** 狀態列存在，且呈現空狀態文字

#### Scenario: workspace 為空但有全域 session 時不呈現空狀態

- **WHEN** workspace 中沒有任何 folder，但使用者於全域項目建立了一個 session 並聚焦它
- **THEN** 狀態列呈現該 session 的脈絡，而非空狀態文字

#### Scenario: 當前項目沒有 session 時

- **WHEN** 當前選中的 rail 項目沒有任何 session
- **THEN** 狀態列存在，且呈現空狀態文字
