## MODIFIED Requirements

### Requirement: rail 於每個 folder 之下呈現其 session 子列

workspace rail 的每個 folder 列之下 SHALL 呈現該 folder 的 session 子列，反映該 folder 的所有 session（不限於當前選中的 repo）。子列 SHALL 可被點選以聚焦該 session，點選時 SHALL 選中其所屬的 folder 並將該 session 設為 focused。folder 的 session 子列 SHALL 可展開與收合。

rail 的每個 folder 列 SHALL 提供建立 session 的入口，該入口 SHALL 讓使用者選擇 spawn 目標，且 SHALL 選中該 folder 並聚焦新建立的 session —— 使用者在 rail 上看得到 session，就應當能在原地開一個，不必先切換到主舞台。

**同一個 rail 項目之內的交接關係 SHALL 以樹狀呈現**（見 `session-lineage`）：母 session 仍存在且
與子 session 屬於同一個 rail 項目時，子 session 的子列 SHALL 縮排呈現於母 session 之下；連續的交接
逐層往下。縮排深度 SHALL 有上限，超過上限的層級 SHALL 以上限那一層的縮排呈現 —— rail 的寬度有下限，
無上限的縮排會把標籤擠到看不見。母 session 不存在（定義見 `session-lineage`）、或屬於另一個 rail 項目時，子 session SHALL 以
頂層呈現，其來源由 `session-lineage` 的來源標示表達。

session 子列 SHALL 同時呈現該 session 的來源標示與子 session 標示（見 `session-lineage`），
兩者皆不存在時不佔位。

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

#### Scenario: 同一個 folder 中的子 session 縮排於母 session 之下

- **WHEN** folder A 的 session P 交接一則工作至 folder A，建立 session C
- **THEN** rail 上 C 的子列縮排呈現於 P 之下

#### Scenario: 母 session 屬於另一個 folder 時子 session 以頂層呈現

- **WHEN** folder B 的 session C 由 folder A 的 session P 交接而來
- **THEN** rail 上 C 的子列於 folder B 之下以頂層呈現，並帶有來源標示

#### Scenario: 母 session 關閉之後子 session 回到頂層

- **WHEN** 承「同一個 folder 中的子 session」，使用者關閉 P
- **THEN** rail 上 C 的子列以頂層呈現

#### Scenario: 超過深度上限的層級不再加深縮排

- **WHEN** 同一個 folder 中的交接連續發生，層數超過縮排的深度上限
- **THEN** 超過上限的 session 其縮排與上限那一層相同，且其標籤可見

### Requirement: session 的順序可由使用者拖曳調整，且兩個視圖共用同一順序

使用者 SHALL 能以滑鼠拖曳調整同一 repo 之下 session 的順序，於**分頁列**與 **rail 的 session 子列**兩處皆可。

兩處 SHALL 由**同一個順序**導出 —— 它是 session 在該 repo 內的次序，不是某個視圖的裝飾。於一處調整順序後，另一處 SHALL 隨之反映。

**分頁列以扁平的形式呈現該順序；rail 以樹狀呈現它**（見「rail 於每個 folder 之下呈現其 session 子列」）：rail 上同一個母 session 之下的子 session，以及頂層的各個 session，其彼此的相對次序 SHALL 與分頁列中的相對次序相同。於分頁列中把子 session 拖到母 session 之前，SHALL NOT 使它在 rail 上離開母 session。

**於 rail 上拖曳 SHALL 只在同一層的兄弟之間移動**，被拖曳的 session 的子孫 SHALL 隨之一起移動，並在該順序中緊接於它之後。拖曳 SHALL NOT 能改變母子關係 —— 關係由交接建立，不由版面建立（見 `session-lineage`）。

**由交接建立、且與母 session 屬於同一個 rail 項目的 session**，SHALL 被放在該順序中「母 session 與它所有子孫」裡最後一個的位置之後 —— 分頁列的拖曳可能已把子孫移到母 session 之前，以「最後一個子孫」為準時，新的 session 可能落在母 session 之前。

**持久化的來源可能形成環**（見 `session-lineage`「損毀的關係不使 session 從 rail 消失」）；環上的 session SHALL 以頂層呈現。

拖曳 SHALL 僅在同一個 repo 之內進行。session 的工作目錄於其 pty 啟動時即已決定，將它移到另一個 repo 之下在語意上不成立。

拖曳與點擊 SHALL 被區分：未產生實際位移的按下與放開 SHALL 被視為一次點擊（切換 focused session），SHALL NOT 被當作拖曳。

#### Scenario: 拖曳分頁改變順序

- **WHEN** 使用者將分頁列中的一個 session 拖曳至另一個位置
- **THEN** 分頁列以新的順序呈現該 repo 的 session

#### Scenario: 兩個視圖的順序一致

- **WHEN** 一個 repo 的 session 之間沒有任何交接關係，使用者於分頁列調整了 session 的順序
- **THEN** rail 的 session 子列以相同的順序呈現

#### Scenario: 自 rail 拖曳亦改變順序

- **WHEN** 一個 repo 的 session 之間沒有任何交接關係，使用者於 rail 的 session 子列拖曳一個 session 至另一個位置
- **THEN** 該 repo 的 session 順序改變，且分頁列以相同的新順序呈現

#### Scenario: 未位移的按下視為點擊

- **WHEN** 使用者於一個 session 上按下並放開滑鼠，期間未產生實際位移
- **THEN** 該 session 成為 focused，順序不變

#### Scenario: rail 上的兄弟次序與分頁列一致

- **WHEN** session P 有兩個子 session C1 與 C2，使用者於分頁列把 C2 拖到 C1 之前
- **THEN** rail 上 P 之下 C2 呈現於 C1 之前

#### Scenario: 於分頁列拖曳不改變母子關係

- **WHEN** 使用者於分頁列把子 session C 拖到其母 session P 之前
- **THEN** rail 上 C 仍縮排呈現於 P 之下

#### Scenario: 於 rail 拖曳母 session 時子孫一起移動

- **WHEN** 同一個 folder 中有頂層 session X 與 P，P 有子 session C，使用者於 rail 把 P 拖到 X 之前
- **THEN** 分頁列的次序為 P、C、X

#### Scenario: 於 rail 往下拖曳帶有子孫的 session

- **WHEN** 同一個 folder 中依序有頂層 session P、X、Y，P 有子 session C，使用者於 rail 把 P 拖到 Y 之後
- **THEN** 分頁列的次序為 X、Y、P、C

#### Scenario: 子孫被拖到母 session 之前時，新的子 session 仍在母 session 之後

- **WHEN** 同一個 folder 中 P 有子 session C1，使用者於分頁列把 C1 拖到 P 之前（次序為 C1、P、X），其後 P 交接一則工作至同一個 folder，建立 C2
- **THEN** 分頁列的次序為 C1、P、C2、X

#### Scenario: 交接建立的 session 在分頁列中緊鄰母 session

- **WHEN** 同一個 folder 中依序有 session P、X，P 交接一則工作至同一個 folder，建立 session C
- **THEN** 分頁列的次序為 P、C、X
