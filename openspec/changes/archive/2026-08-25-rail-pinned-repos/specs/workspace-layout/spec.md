## MODIFIED Requirements

### Requirement: repo 的順序可由使用者拖曳調整

使用者 SHALL 能以滑鼠拖曳調整 rail 上 repo 的順序。該順序 SHALL 為 workspace 的持久狀態（見
`workspace-folders` 的「folder 的順序由使用者決定」），SHALL NOT 只是 rail 的一次性呈現。

**拖曳同時決定該 repo 的置頂狀態**：命中的落點集合除了各個 repo 區塊，還包含**兩段之間的分界**
（見 `rail-pinning` 的「使項目跨越分界的移動即改變其置頂狀態」）。落在分界之上者為置頂，之下者
為未置頂。

**插入點 SHALL 以整個 repo 區塊判定** —— 包含它展開時底下的 session 子列。那是使用者眼中「這個
repo 佔的地盤」：拖到某個 repo 的 session 子列上方，意味著插在該 repo 之前。**分界是這條規則
唯一的例外**：它不是一個 repo 區塊，而是一條細線，其可命中的範圍相應地窄 —— 兩側的落點因此
SHALL 各自可辨（見 `rail-pinning`）。

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

#### Scenario: 拖曳同時決定置頂狀態

- **WHEN** 使用者將一個未置頂的 repo 拖曳至分界之上並放開
- **THEN** 它落在置頂段中指示線所示之處，且成為置頂

### Requirement: rail 呈現每個 folder 的名稱與身分

workspace rail SHALL 為每個已加入的 folder 呈現一列，顯示其**名稱**與其 **git 分支**。

名稱 SHALL 是該列視覺權重最高的元素 —— 它是使用者用來辨識 repo 的東西，SHALL NOT 被同列的
其他文字在視覺上壓過或平分。

rail SHALL 只在 folder 處於**異常狀態**、或處於**使用者自行設定且可撤銷的狀態**時發聲。前者
目前為：不含 `openspec/`、或路徑失效；後者目前為：**置頂**（見 `rail-pinning`）。**含有
`openspec/` 是常態，rail SHALL NOT 為它呈現任何持續性的標示** —— 每一列都喊一次的訊息不傳達
任何資訊，只是噪音。

**置頂之所以是例外，理由與「含有 `openspec/`」恰好相反**：它不是常態（多數 folder 未置頂，
標示因此帶有資訊），而且它是使用者自己設定的狀態 —— 撤銷它的入口就是那個指示本身，不呈現它
等於把撤銷的入口藏起來。

OpenSpec 身分入口的可用性由 `Requirement: OpenSpec 為條件式身分，Files 恆可用` 承擔（該入口
位於主舞台的 side panel 身分切換）。rail SHALL NOT 重複呈現一個入口。

rail SHALL NOT 呈現不可操作的控制項 —— 一個長得像按鈕、按下去卻什麼都不發生的元素，會反覆
消耗使用者的注意力去確認它是不是壞了。指示性的資訊 SHALL 以非互動的形式呈現。

**一個明確處於停用狀態、且說明其停用原因的控制項不在此禁令之內。** 該禁令針對的是「與可按的
控制項外觀相同、按下去卻什麼都不發生、且不傳達任何狀態」的元素；一個停用的控制項既不可聚焦
也不可點擊，它傳達的是一個狀態（此處不可用，原因如提示所述），那正是「以非互動的形式呈現指示性
資訊」。rail 上目前有兩處：路徑失效時該列的建立 session 入口，以及全域項目的置頂指示（見
`global-session`）。

rail 底部 SHALL 提供加入 folder 的入口。

#### Scenario: 含 openspec 的 folder

- **WHEN** rail 呈現一個含有 `openspec/` 的 folder
- **THEN** 該列**不因此**呈現任何標示（常態不發聲）

#### Scenario: 不含 openspec 的 folder

- **WHEN** rail 呈現一個不含 `openspec/` 的 folder
- **THEN** 該列以弱化的樣式標示此事 —— 使用者應在點擊之前就知道該 repo 只能以 Files 身分使用

#### Scenario: 路徑失效的 folder

- **WHEN** rail 呈現一個路徑已失效的 folder
- **THEN** 該列明確標示此事

#### Scenario: folder 的分支

- **WHEN** rail 呈現一個位於某 git 分支上的 folder
- **THEN** 該列呈現其分支名稱，且其視覺權重低於 folder 名稱

#### Scenario: rail 不呈現不可操作的控制項

- **WHEN** 檢視 rail 上的每一個可聚焦／可點擊的元素
- **THEN** 每一個都有實際作用 —— 不存在按下去無任何效果的控制項

#### Scenario: 停用的控制項宣告自身的停用狀態

- **WHEN** 檢視 rail 上每一個處於停用狀態的控制項
- **THEN** 每一個都既不可聚焦也不可點擊，且附有說明其何以停用的提示

#### Scenario: 自 rail 加入 folder

- **WHEN** 使用者觸發 rail 底部的加入入口
- **THEN** 開啟原生目錄選擇對話框
