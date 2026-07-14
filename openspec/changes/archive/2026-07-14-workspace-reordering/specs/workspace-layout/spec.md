## ADDED Requirements

### Requirement: repo 的順序可由使用者拖曳調整

使用者 SHALL 能以滑鼠拖曳調整 rail 上 repo 的順序。該順序 SHALL 為 workspace 的持久狀態（見
`workspace-folders` 的「folder 的順序由使用者決定」），SHALL NOT 只是 rail 的一次性呈現。

**插入點 SHALL 以整個 repo 區塊判定** —— 包含它展開時底下的 session 子列。那是使用者眼中「這個
repo 佔的地盤」：拖到某個 repo 的 session 子列上方，意味著插在該 repo 之前。

**拖曳的起點 SHALL 只限於 repo 的標題列。** 於其 session 子列上按下 SHALL NOT 啟動 repo 的拖曳
—— 兩種拖曳在 DOM 上是巢狀的，起點若不互斥，一次拖曳會**同時移動 session 與 repo**。

拖曳與點擊 SHALL 被區分：未產生實際位移的按下與放開 SHALL 被視為一次點擊（選中該 repo），
SHALL NOT 被當作拖曳。

被移動的 repo SHALL 維持其選中狀態 —— 選中的是那個 repo，不是那個位置。

#### Scenario: 拖曳 repo 改變 rail 的順序

- **WHEN** 使用者將 rail 上的一個 repo 拖曳至另一個位置
- **THEN** rail 以新的順序呈現這些 repo

#### Scenario: 展開中的 repo 連同其 session 子列一起移動

- **WHEN** 使用者拖曳一個正展開著 session 子列的 repo 至另一個位置
- **THEN** 該 repo 與其 session 子列一併出現於新的位置，session 的順序不變

#### Scenario: 於 session 子列上拖曳只移動 session

- **WHEN** 使用者於某個 repo 的 session 子列上按下並拖曳一個 session
- **THEN** 只有該 session 的順序改變，repo 於 rail 上的順序不變

#### Scenario: 未位移的按下視為點擊

- **WHEN** 使用者於一個 repo 上按下並放開滑鼠，期間未產生實際位移
- **THEN** 該 repo 成為選中的 repo，rail 的順序不變

#### Scenario: 被移動的 repo 維持選中

- **WHEN** 使用者拖曳當前選中的 repo 至另一個位置
- **THEN** 該 repo 於新位置仍為選中的 repo，主舞台呈現的仍是它

### Requirement: 拖曳的落點與插入指示線一致

放開時，被拖曳的項目 SHALL 落在**插入指示線所示之處**，SHALL NOT 多跳一格。此要求約束**每一種**可拖曳的項目：rail 的 repo 列、rail 的 session 子列、分頁列的分頁。

指示線的語意 SHALL 為「插在這個項目**之前**」。因此：拖到某個項目的**中線之後**（下半／右半）SHALL 使被拖曳的項目落在它**之後**；拖到清單的**末端之後** SHALL 使它落到**最後一格**（末端必須拖得到）；而拖到**自己原本位置**所對應的插入點 SHALL 為無操作，且此時 SHALL NOT 呈現指示線（畫一條「放開會移動」的線，然後什麼都不動，是在騙人）。

> **這條之所以要明文寫下來**：命中判定回傳的是**插入點**（「插在第 i 個之前」），而提交是「先移除、再插入」—— 移除會使被拖曳項目**之後**的每一個元素前移一格，於是往下／往右拖時，實際落點比指示線**多一格**。這個 off-by-one 在**只有兩個項目**時看不出來（兩種語意結果相同），因此驗收 SHALL 以**至少三個項目**進行。

#### Scenario: 拖到下一個項目的中線之後

- **WHEN** 清單有三個以上的項目，使用者將第一個項目拖到第二個項目的中線之後並放開
- **THEN** 它落在第二與第三個項目**之間**（不是被丟到清單末端）

#### Scenario: 拖到清單末端

- **WHEN** 使用者將一個項目拖到清單最後一個項目的中線之後並放開
- **THEN** 它落在清單的最後一格

#### Scenario: 拖到自己原本的位置

- **WHEN** 使用者將一個項目拖到「插在它自己之前」所對應的位置並放開
- **THEN** 順序不變，且拖曳期間該處未呈現插入指示線

### Requirement: 可拖曳項目的游標宣告其主要可供性

可點擊也可拖曳的項目（rail 的 repo 列、rail 的 session 子列、分頁列的分頁）其靜止時的游標 SHALL 為 `pointer`，SHALL NOT 為 `grab`。**唯有拖曳真的在進行中**時，游標 SHALL 為 `grabbing`。

理由：`grab` 宣告的是「這個東西只能被拖」，但這些項目**點一下是有作用的**（選中 repo／切換 focused
session），而那是使用者在它們身上最常做的事 —— 拖曳是偶爾為之。游標該宣告主要的可供性。

#### Scenario: 靜止於可拖曳項目上的游標

- **WHEN** 使用者將滑鼠移至 rail 的一個 repo 列、rail 的一個 session 子列，或分頁列的一個分頁上
- **THEN** 游標為 `pointer`

#### Scenario: 拖曳進行中的游標

- **WHEN** 使用者按住一個分頁並拖曳它
- **THEN** 拖曳期間游標為 `grabbing`
