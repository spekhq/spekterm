## Purpose

活動列、workspace rail、主舞台三欄的版面骨架。分界可拖動與鍵盤操作、side panel 可收合、
rail 呈現每個**項目**的身分（含「無 `openspec/`」與「路徑失效」的標示）。

**rail 的項目不等於 workspace 的 folder**（`global-session` 起）：第一列是一個不隸屬任何 folder
的全域項目 —— 它沒有路徑、沒有分支、不可移除、不可拖曳排序，但其餘（session 分頁列、focus 記憶、
側欄座標）與 folder 的列**完全共用同一條路徑**。

UI 版面與行為以 `docs/workspace-mockup.html` 為權威。
## Requirements
### Requirement: 主視窗呈現活動列、workspace rail 與主舞台三個區域

renderer SHALL 呈現 `docs/workspace-mockup.html` 所定義的三塊版面：活動列、workspace rail、主舞台。主舞台 SHALL 內含一個可與其並列的 side panel 區域。

UI 的版面與行為以該雛型為權威。

#### Scenario: 啟動後三個區域同時存在

- **WHEN** 應用程式啟動並完成 renderer 載入
- **THEN** 活動列、workspace rail 與主舞台三個區域同時存在於畫面上，且各自可被程式化識別

### Requirement: 區域之間的分界可拖動且受最小寬度夾制

rail 與主舞台、主舞台內部與 side panel 之間的分界 SHALL 可拖動以調整兩側寬度。每個區域 SHALL 有最小寬度，拖動 SHALL 被夾制於該下限，SHALL NOT 使區域寬度歸零。

分界 SHALL 可由鍵盤操作，並具備可被輔助技術辨識的角色語意。

**活動列與 rail 之間 SHALL NOT 有分界** —— 活動列為固定寬度（見「活動列為固定寬度且不隨視窗尺寸改變」）。一個調不出任何差異的控制項，比沒有這個控制項更糟：它會佔用一次嘗試，然後什麼都不發生。

#### Scenario: 拖動分界改變兩側寬度

- **WHEN** 使用者拖動 rail 與主舞台之間的分界
- **THEN** 兩側區域的寬度隨之改變

#### Scenario: 拖動不得使區域寬度歸零

- **WHEN** 使用者將分界拖過某一側的最小寬度
- **THEN** 該側停留於最小寬度，不會消失

#### Scenario: 分界可由鍵盤操作

- **WHEN** 分界取得鍵盤焦點並收到方向鍵
- **THEN** 兩側區域的寬度隨之改變

#### Scenario: 活動列與 rail 之間不存在分界

- **WHEN** 檢視主視窗的三個區域
- **THEN** 可拖動的分界恰有兩處（rail↔主舞台、主舞台↔side panel），活動列與 rail 之間沒有分界

### Requirement: side panel 可收合並還原原寬度

使用者 SHALL 能收合 side panel，使主舞台的其餘部分佔滿可用寬度。再次展開時 SHALL 還原收合前的寬度。

#### Scenario: 收合 side panel

- **WHEN** 使用者觸發收合
- **THEN** side panel 自畫面消失，主舞台其餘部分佔滿其原本所在的空間

#### Scenario: 展開後還原先前寬度

- **WHEN** 使用者調整 side panel 寬度後將其收合，再重新展開
- **THEN** side panel 以收合前的寬度重新出現

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

### Requirement: 活動列呈現尚未實作的入口為停用狀態

活動列 SHALL 呈現雛型所定義的全部入口，並 SHALL 額外呈現一個開啟對話計量 overlay 的入口
（見 `conversation-insights`）。**尚未實作**的入口 SHALL 呈現為停用狀態，並說明其尚未可用，
SHALL NOT 於點擊後無聲無息。**已實作**的入口 SHALL 為可用狀態。

保留位置而非隱藏，是為了讓版面比例自第一天起就與雛型一致；標示停用而非靜默，是為了讓使用者知道那不是壞掉。

Settings 入口為**已實作**（開啟終端偏好設定介面，見 `terminal-preferences`）；對話計量入口為
**已實作**；尚未實作而維持停用的入口為 Handoffs 與 Search。

> **對話計量入口是對 `docs/workspace-mockup.html` 的一次明示偏離。** 雛型枚舉了活動列的入口
> （Sessions／Handoffs／Search／Settings），本 requirement 原本把入口集合整個釘在雛型上 ——
> 因此加第五個入口**不是**雛型沉默之處的延伸（對照 `rail-pinned-repos` 的置頂段，那件事雛型
> 確實沒講過，故不構成偏離），而是**改變了雛型講過的一件事**，必須留下裁決紀錄。
>
> 裁決理由：對話計量的範圍是整個 workspace，不隸屬任何 folder、也不是側欄的座標之下的東西
> —— 活動列正是「不隸屬任何 repo 的全域入口」該在的位置。已排除的替代方案是放進 Settings
> 對話框：**Settings 是放旋鈕的地方，而這是內容**，兩者混在一起會讓 Settings 逐漸變成雜物間。

#### Scenario: 尚未實作的活動列入口

- **WHEN** 使用者檢視活動列中尚未實作的入口（Handoffs 或 Search）
- **THEN** 該入口呈現為停用狀態，並附有說明其尚未可用的提示

#### Scenario: 已實作的活動列入口

- **WHEN** 使用者檢視 Sessions、Settings 或對話計量入口
- **THEN** 該入口為可用狀態

#### Scenario: 對話計量入口開啟 overlay

- **WHEN** 使用者觸發活動列的對話計量入口
- **THEN** 對話計量的全視窗 overlay 開啟

### Requirement: side panel 呈現 OpenSpec 與 Files 兩個同層互斥身分

主舞台的 repo header SHALL 提供切換 side panel 身分的入口。OpenSpec 與 Files 是 side panel 的兩個同層級、互斥的身分：任一時刻 SHALL 只顯示其中一個，且兩者 SHALL 與左側的主舞台其餘部分並存。

身分切換的行為以 `docs/workspace-mockup.html` 的 `#panel-switch` 為權威。

#### Scenario: 切換至 Files 身分

- **WHEN** 使用者於 repo header 觸發 Files 身分的入口
- **THEN** side panel 呈現 Files 身分的內容，OpenSpec 身分的內容不再顯示

#### Scenario: 一次只顯示一個身分

- **WHEN** 檢視 side panel
- **THEN** OpenSpec 與 Files 之中恰有一個身分的內容被呈現

#### Scenario: 當前身分於入口上可辨識

- **WHEN** 使用者檢視身分切換的入口
- **THEN** 當前顯示的身分於該入口上被明確標示

### Requirement: 收合狀態下觸發任一身分皆重新展開 side panel

side panel 處於收合狀態時，觸發任一身分的入口 SHALL 重新展開 side panel 並顯示該身分的內容。

#### Scenario: 收合後觸發身分入口

- **WHEN** side panel 已收合，使用者觸發 Files 身分的入口
- **THEN** side panel 重新展開並呈現 Files 身分的內容

### Requirement: OpenSpec 為條件式身分，Files 恆可用

OpenSpec 身分的入口 SHALL 於**側欄來源已選定、且該來源 repo 不含 `openspec/`** 時為停用狀態，
且該狀態 SHALL 可被輔助技術辨識。Files 身分 SHALL 恆為可用。

**側欄來源尚未選定時**（`global-session` 的全域項目其預設狀態），OpenSpec 身分 SHALL 為**可用** ——
它要呈現的正是「請選一個 repo」的空狀態（見 `openspec-panel`）。**以「有沒有 folder 可讀」作為停用
條件會使該空狀態永遠到不了**：身分被停用並強制退回 Files，而 Files 在同一個狀態下也是空的，於是
側欄整塊沒有任何入口，使用者無從得知「選一個 repo 就有了」。

這是「spek 以 OpenSpec 為核心，但版面不因缺少 OpenSpec 就殘廢」的體現 —— 使用者應在點擊之前就知道
該 repo 只能以 Files 身分使用。**而「還沒選」與「選了但沒有 openspec/」是兩件不同的事**：前者是尚未
作出的選擇（可用，並告訴他怎麼選），後者是該 repo 的性質（停用）。

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** OpenSpec 身分的入口為停用狀態，Files 身分的入口為可用狀態

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder
- **THEN** OpenSpec 與 Files 兩個身分的入口皆為可用狀態

#### Scenario: 側欄來源未選定時 OpenSpec 身分可用

- **WHEN** 使用者選中全域項目，而其側欄來源尚未選定
- **THEN** OpenSpec 身分的入口為可用狀態，且可被切換至

#### Scenario: 停用的身分不可被切換至

- **WHEN** 使用者觸發一個停用的身分入口
- **THEN** side panel 的當前身分不改變

### Requirement: 主舞台為當前 repo 呈現 session 分頁列

主舞台 SHALL 在 repo header 與 terminal／side panel 版面之間，為**當前選中的 repo** 呈現其 session 的分頁列。此分頁列 SHALL 標示當前 focused 的 session、SHALL 提供在 session 之間切換的方式、SHALL 提供建立新 session 的入口（該入口 SHALL 讓使用者選擇 spawn 目標），且每個分頁 SHALL 可關閉。

每個分頁 SHALL 提供右鍵選單，其中 SHALL 至少包含**重新命名**與**關閉**。

建立新 session 的入口 SHALL 緊鄰最後一個分頁之後，SHALL NOT 被推離分頁而置於分頁列的另一端 —— 它是分頁的延伸，使用者剛看完分頁就會伸手去點它。

當前 repo 尚無任何 session 時，該區域 SHALL 呈現空狀態，並提供明顯的建立 session 入口。

分頁列僅呈現當前選中 repo 的 session —— 主舞台只屬於當前選中的 repo。

#### Scenario: 呈現當前 repo 的多個 session

- **WHEN** 當前選中的 repo 有多個 session
- **THEN** 分頁列為每個 session 呈現一項，且當前 focused 的 session 被標示

#### Scenario: 切換 focused session

- **WHEN** 使用者於分頁列點選另一個 session
- **THEN** focused session 切換為該 session，終端顯示其內容

#### Scenario: 建立新 session 可選 spawn 目標

- **WHEN** 使用者觸發建立新 session 的入口
- **THEN** 使用者可選擇 spawn 目標為 `claude` 或 login shell

#### Scenario: 建立入口緊鄰最後一個分頁

- **WHEN** 分頁列中已有一或多個分頁
- **THEN** 建立新 session 的入口緊接於最後一個分頁之後，而非位於分頁列的另一端

#### Scenario: 分頁的右鍵選單

- **WHEN** 使用者於一個分頁按下右鍵
- **THEN** 出現包含重新命名與關閉的選單，且該選單完整落在可視範圍內

#### Scenario: 關閉分頁

- **WHEN** 使用者關閉分頁列中的一個 session
- **THEN** 該 session 自分頁列移除

#### Scenario: 當前 repo 無 session

- **WHEN** 當前選中的 repo 沒有任何 session
- **THEN** 該區域呈現空狀態與建立 session 的入口

### Requirement: rail 於每個 folder 之下呈現其 session 子列

workspace rail 的每個 folder 列之下 SHALL 呈現該 folder 的 session 子列，反映該 folder 的所有 session（不限於當前選中的 repo）。子列 SHALL 可被點選以聚焦該 session，點選時 SHALL 選中其所屬的 folder 並將該 session 設為 focused。folder 的 session 子列 SHALL 可展開與收合。

rail 的每個 folder 列 SHALL 提供建立 session 的入口，該入口 SHALL 讓使用者選擇 spawn 目標，且 SHALL 選中該 folder 並聚焦新建立的 session —— 使用者在 rail 上看得到 session，就應當能在原地開一個，不必先切換到主舞台。

rail 的每個 session 子列 SHALL 提供關閉該 session 的入口，其效果與自分頁列關閉相同，並 SHALL 提供右鍵選單，其中 SHALL 至少包含**重新命名**與**關閉**。

#### Scenario: folder 之下呈現其 session

- **WHEN** 一個 folder 有一或多個 session
- **THEN** 其列之下呈現對應的 session 子列

#### Scenario: 自 rail 聚焦 session

- **WHEN** 使用者點選一個 folder 的某個 session 子列
- **THEN** 該 folder 被選中，且該 session 成為其 focused session

#### Scenario: 自 rail 建立 session

- **WHEN** 使用者於 rail 的某個 folder 列觸發建立 session 的入口並選擇 spawn 目標
- **THEN** 該 folder 之下新增一個 session，該 folder 被選中，且新 session 成為 focused

#### Scenario: 自 rail 關閉 session

- **WHEN** 使用者於 rail 的某個 session 子列觸發關閉入口
- **THEN** 該 session 被關閉並自 rail 與分頁列一併移除

#### Scenario: rail 子列的右鍵選單

- **WHEN** 使用者於 rail 的一個 session 子列按下右鍵
- **THEN** 出現包含重新命名與關閉的選單，且該選單完整落在可視範圍內

#### Scenario: 收合與展開 session 子列

- **WHEN** 使用者收合一個 folder，其後再展開
- **THEN** 收合時其 session 子列隱藏，展開時還原呈現

### Requirement: session 的順序可由使用者拖曳調整，且兩個視圖共用同一順序

使用者 SHALL 能以滑鼠拖曳調整同一 repo 之下 session 的順序，於**分頁列**與 **rail 的 session 子列**兩處皆可。

兩處 SHALL 反映**同一個順序** —— 它是 session 在該 repo 內的次序，不是某個視圖的裝飾。於一處調整順序後，另一處 SHALL 隨之呈現相同的次序。

拖曳 SHALL 僅在同一個 repo 之內進行。session 的工作目錄於其 pty 啟動時即已決定，將它移到另一個 repo 之下在語意上不成立。

拖曳與點擊 SHALL 被區分：未產生實際位移的按下與放開 SHALL 被視為一次點擊（切換 focused session），SHALL NOT 被當作拖曳。

#### Scenario: 拖曳分頁改變順序

- **WHEN** 使用者將分頁列中的一個 session 拖曳至另一個位置
- **THEN** 分頁列以新的順序呈現該 repo 的 session

#### Scenario: 兩個視圖的順序一致

- **WHEN** 使用者於分頁列調整了 session 的順序
- **THEN** rail 的 session 子列以相同的順序呈現

#### Scenario: 自 rail 拖曳亦改變順序

- **WHEN** 使用者於 rail 的 session 子列拖曳一個 session 至另一個位置
- **THEN** 該 repo 的 session 順序改變，且分頁列以相同的新順序呈現

#### Scenario: 未位移的按下視為點擊

- **WHEN** 使用者於一個 session 上按下並放開滑鼠，期間未產生實際位移
- **THEN** 該 session 成為 focused，順序不變

### Requirement: side panel 的預設身分為 OpenSpec

選中的 rail 項目其 OpenSpec 身分為可用狀態時，side panel 的預設身分 SHALL 為 **OpenSpec**。
OpenSpec 身分為停用狀態時（側欄來源已選定且該 repo 不含 `openspec/`），預設身分 SHALL 為 Files。

**側欄來源尚未選定時預設身分 SHALL 為 OpenSpec** —— 依上一條它是可用的，而它的空狀態正是引導
使用者選一個來源的地方。

這是 `docs/workspace-mockup.html` 的預設（`#content-openspec` 為初始顯示的內容）。此前實作暫以 Files 為
預設，理由是 OpenSpec 身分尚無內容可顯示 —— 該理由已不復存在。

**OpenSpec 是這個工作台的主張**：使用者加入一個有 `openspec/` 的 repo，預期看到的是它的 spec 與 change，
而不是一棵他在 IDE 裡已經看膩的檔案樹。

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder，且尚未手動切換過身分
- **THEN** side panel 呈現 OpenSpec 身分的內容

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** side panel 呈現 Files 身分的內容

#### Scenario: 選中來源未選定的全域項目

- **WHEN** 使用者選中全域項目，其側欄來源尚未選定，且尚未手動切換過身分
- **THEN** side panel 呈現 OpenSpec 身分的空狀態

### Requirement: 切換當前 repo 時，focused session 落在該 repo 最後聚焦過的 session

系統 SHALL 為每個 folder 記住它**最後聚焦過**的 session。切換當前選中的 repo 時，focused session SHALL 落在該 repo 最後聚焦過的那一個。

此行為 SHALL NOT 取決於切換的手段 —— 以滑鼠點選 rail 上的 folder，與以鍵盤切換 repo，兩者的落點 SHALL 相同。否則同一個動作會有兩種行為。

該 repo 最後聚焦的 session **已被關閉**時，focused session SHALL 落在該 repo 分頁列上的第一個 session；該 repo 沒有任何 session 時，SHALL 呈現空狀態。

此記憶為 session 的執行期狀態，SHALL NOT 持久化 —— session 本身即不跨重啟存活。

> **「該 repo 從未聚焦過任何 session」不列為 scenario** —— 它在 UI 上構造不出來：**建立 session 的同時就會聚焦它**。實作中的那條退路（找不到記錄就取第一個）是防禦性的，不是可觀察的行為。為一個不可達的狀態寫一條永遠不會失敗的驗收，是假覆蓋。

#### Scenario: 切走再切回，回到離開時的 session

- **WHEN** 使用者於 repo A 聚焦其第二個 session，切換至 repo B，再切回 repo A
- **THEN** repo A 的 focused session 為其第二個 session（而非第一個）

#### Scenario: 滑鼠與鍵盤的落點相同

- **WHEN** 使用者於 repo A 聚焦其第二個 session，切至 repo B，再分別以點選 rail 與以鍵盤切回 repo A
- **THEN** 兩種手段皆使 repo A 的 focused session 為其第二個 session

#### Scenario: 最後聚焦的 session 已被關閉

- **WHEN** 使用者切換至一個 repo，而它最後聚焦過的 session 已被關閉
- **THEN** focused session 為該 repo 分頁列上的第一個 session

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

### Requirement: 主視窗於三欄版面之下呈現一列狀態列

renderer SHALL 於活動列、rail 與主舞台三個區域**之下**呈現一列狀態列，橫跨主視窗的整個寬度，
高度固定。

狀態列 SHALL NOT 受 side panel 的收合、任一分界的拖動或當前身分的切換影響而消失或改變高度 ——
它是版面的一部分，不隸屬於任何一欄。其呈現的內容由 `status-bar` 能力定義。

`docs/workspace-mockup.html` 已定義此列（`.statusbar`）的位置與形式，UI 以該雛型為權威。

#### Scenario: 啟動後狀態列與三個區域並存

- **WHEN** 應用程式啟動並完成 renderer 載入
- **THEN** 狀態列存在於活動列、rail 與主舞台之下，且橫跨整個視窗寬度

#### Scenario: 收合 side panel 後狀態列不受影響

- **WHEN** 使用者收合 side panel
- **THEN** 狀態列仍然存在，且高度不變

### Requirement: 選單以滑鼠選取項目後即關閉

選單（`ContextMenu` 及其所有使用處）在使用者**以滑鼠觸發其中一個項目**之後 SHALL 關閉。

關閉 SHALL 由選單自身在項目被觸發時完成，SHALL NOT 倚賴「該次點擊冒泡至 window 後由關閉外部
點擊的監聽器順帶關掉」這條路徑 —— 該路徑在「項目的動作使上層元件於**同一次事件中**重新
render」時會失效（React 對受信任的離散事件同步 flush effect，重新註冊的監聽器排到下一個
tick，該次點擊冒泡至 window 時已無人監聽）。側欄的來源下拉即屬此種情形。

選單 SHALL 同時維持既有的關閉方式：點選單以外之處、按 `Esc`。

#### Scenario: 選取項目後選單關閉（動作觸發上層重新 render）

- **WHEN** 使用者於側欄的來源下拉中選取一個 folder
- **THEN** 側欄來源改為該 folder
- **AND** 該下拉選單關閉

#### Scenario: 選取項目後選單關閉（動作不觸發上層重新 render）

- **WHEN** 使用者於任一選單中觸發一個項目
- **THEN** 該選單關閉

#### Scenario: 點選單以外之處仍關閉選單

- **WHEN** 選單開啟中，使用者點擊選單以外的區域
- **THEN** 該選單關閉

### Requirement: 主舞台為選中的全域項目呈現其 session 分頁列

選中的 rail 項目為**全域項目**時，主舞台 SHALL 為它呈現 session 的分頁列，其行為 SHALL 與
「主舞台為當前 repo 呈現 session 分頁列」所定義者相同：標示 focused session、提供切換、提供可選
spawn 目標的建立入口（緊鄰最後一個分頁之後）、每個分頁可關閉、每個分頁提供含重新命名與關閉的
右鍵選單，尚無 session 時呈現空狀態與明顯的建立入口。

分頁列 SHALL 僅呈現當前選中之 rail 項目的 session —— 全域 session 與各 folder 的 session
SHALL NOT 混列於同一個分頁列。

rail 的全域項目之下 SHALL 呈現其 session 子列，並提供建立與關閉 session 的入口，其行為與 folder
的 session 子列相同。

#### Scenario: 選中全域項目時呈現其分頁列

- **WHEN** 使用者選中全域項目，而它已有數個 session
- **THEN** 分頁列為每個全域 session 呈現一項，且不含任何 folder 的 session

#### Scenario: 全域項目尚無 session 時呈現屬於它的空狀態

- **WHEN** 使用者選中尚無任何 session 的全域項目
- **THEN** 該區域呈現空狀態與明顯的建立 session 入口
- **AND** SHALL NOT 呈現「尚未選擇 repo」之類要求使用者先選一個 rail 項目的訊息 —— 他已經選了

#### Scenario: 自 rail 的全域項目建立 session

- **WHEN** 使用者於 rail 的全域項目觸發建立 session 的入口並選擇一個 spawn 目標
- **THEN** 全域項目被選中，新 session 建立並成為 focused

#### Scenario: 切換至 folder 後分頁列不再含全域 session

- **WHEN** 使用者由全域項目切換至某個 folder
- **THEN** 分頁列僅呈現該 folder 的 session

#### Scenario: 全域項目的 header 與 repo 的 header 可區分

- **WHEN** 使用者選中全域項目
- **THEN** 主舞台的 header 呈現全域項目的身分，而非任何 folder 的名稱或路徑

### Requirement: 切換至全域項目時 focused session 落在它最後聚焦過的 session

「切換當前 repo 時，focused session 落在該 repo 最後聚焦過的 session」所定義的記憶 SHALL 同等
適用於全域項目：系統 SHALL 為全域項目記住它最後聚焦過的 session，切換至它時 focused session
SHALL 落在那一個。

此行為 SHALL NOT 取決於切換的手段（點選 rail 或以鍵盤切換），且該記憶 SHALL NOT 持久化。

#### Scenario: 切走再切回全域項目

- **WHEN** 使用者於全域項目聚焦其第二個 session，切換至某個 folder，再切回全域項目
- **THEN** 全域項目的 focused session 為其第二個 session

### Requirement: 活動列為固定寬度且不隨視窗尺寸改變

活動列 SHALL 為固定寬度，SHALL NOT 可由使用者調整，且其寬度 SHALL NOT 隨主視窗尺寸的改變而改變。

它是一列固定尺寸的圖示按鈕 —— 加寬不會多顯示任何東西。而以可調整區域實作時，其寬度會被換算為容器的比例並於視窗放大時等比長大，於是每次啟動再最大化視窗，它都佔掉比上一次更多的空間（dogfood 回饋）。

#### Scenario: 視窗尺寸改變後活動列寬度不變

- **WHEN** 主視窗的寬度改變（例如最大化）
- **THEN** 活動列的寬度與改變前相同

#### Scenario: 活動列的寬度不可由使用者調整

- **WHEN** 使用者於活動列與 rail 的交界處嘗試拖動
- **THEN** 活動列的寬度不改變
