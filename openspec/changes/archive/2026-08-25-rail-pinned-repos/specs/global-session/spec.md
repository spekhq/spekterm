## ADDED Requirements

### Requirement: 全域項目恆為置頂，且該狀態不可取消

全域項目 SHALL 恆為 rail **置頂段的第一列**（見 `rail-pinning`）。它是這個應用程式恆常提供的
一格，因此「它會不會被捲出視野」不該取決於使用者記不記得去置頂它。

全域項目 SHALL 呈現一個置頂的指示，且該指示 SHALL 為**停用**狀態，並 SHALL 說明它恆為置頂。
它 SHALL NOT 提供取消置頂的入口。

**一個停用且明確宣告自身停用狀態、並說明原因的控制項，不構成 `workspace-layout` 所禁止的
「不可操作的控制項」**（見該能力的「rail 呈現每個 folder 的名稱與身分」）—— 那條禁令針對的是
「長得像可按、按下去卻什麼都不發生、且不傳達任何狀態」的元素。此處的指示傳達的正是使用者需要
知道的狀態：它是置頂的，而且動不了。

全域項目的置頂狀態 SHALL NOT 被寫入 workspace 的持久化設定 —— 它是恆定的性質，不是一筆可變的
狀態，落盤一個永遠不變的值等於落盤一個可能與程式碼分歧的謊言。

全域項目 SHALL NOT 提供右鍵選單。它既不可移除、其置頂狀態亦不可切換，一個只含停用項目的選單
正是上述禁令所指的那種元素。

#### Scenario: 呈現停用的置頂指示

- **WHEN** 使用者檢視 rail 上的全域項目
- **THEN** 該列呈現一個置頂的指示，該指示為停用狀態並附有說明它恆為置頂的提示

#### Scenario: 不提供取消置頂的入口

- **WHEN** 使用者嘗試觸發全域項目上的置頂指示
- **THEN** 全域項目仍為置頂，rail 的內容不變，且應用程式不產生錯誤

#### Scenario: 置頂狀態不進入持久化設定

- **WHEN** 檢視 workspace 的持久化設定內容
- **THEN** 其中不含任何代表全域項目置頂狀態的欄位

#### Scenario: 不提供右鍵選單

- **WHEN** 使用者於全域項目的標題列按下右鍵
- **THEN** 不呈現任何選單

## MODIFIED Requirements

### Requirement: 全域項目不是 workspace 的成員

全域項目 SHALL NOT 出現在 workspace 的 folder 清單中，因此：

- SHALL NOT 提供移除的入口，亦 SHALL NOT 可被移除；
- SHALL NOT 可被拖曳排序，且 SHALL NOT 成為其他項目拖曳時的落點 —— 它的位置是固定的；
- 其存在與否 SHALL NOT 被寫入 workspace 的持久化設定（見 `workspace-folders`）。

**folder 的拖曳排序其落點索引 SHALL 以 folder 清單為基準計算，SHALL NOT 以 rail 上的列位置計算。**

此處原本寫「rail 比 folder 清單多了**一列**，兩者的索引因此**相差一位**」。置頂能力使該敘述
**不再成立**：rail 的列空間有兩列不是 folder（全域項目與分界），而分界的位置隨置頂數變動 ——
**偏移量因此不是常數**（分界之上為一、之下為二）。把它當成一個固定的差值，正是這條要求本來
就在防的那個 off-by-one，只是形式更隱蔽。

因此：拖曳與鍵盤排序 SHALL 在一個**明確定義的列空間**中進行（見 `rail-pinning` 的「使項目跨越
分界的移動即改變其置頂狀態」），該列空間與 folder 清單之間的換算 SHALL 集中於**單一處**，且
SHALL NOT 以任何形式散落為「加一」或「減一」的常數。全域項目 SHALL NOT 進入該列空間 —— 它既
不可拖曳，也不作為落點。

#### Scenario: 不提供移除入口

- **WHEN** 使用者檢視 rail 上的全域項目
- **THEN** 該列不提供移除的入口

#### Scenario: 不可被拖曳排序

- **WHEN** 使用者嘗試以滑鼠拖曳全域項目
- **THEN** rail 的順序不變，且不呈現任何插入指示線

#### Scenario: 全域項目不使 folder 的拖曳落點偏移

- **WHEN** workspace 有三個以上的 folder 且皆未置頂，使用者將第一個 folder 拖曳至第二個 folder
  的下半部
- **THEN** 該 folder 落在第二個 folder 之後，且不因 rail 上多出的全域項目而落到其他位置

#### Scenario: 分界不使 folder 的拖曳落點偏移

- **WHEN** workspace 有兩個置頂與三個未置頂的 folder，使用者將第一個**未置頂**的 folder 拖曳至
  第二個未置頂 folder 的下半部
- **THEN** 該 folder 落在第二個未置頂 folder 之後 —— 不因 rail 上多出的全域項目與分界而落到
  其他位置

#### Scenario: 不進入 workspace 的持久化設定

- **WHEN** 檢視 workspace 的持久化設定內容
- **THEN** 其中不含代表全域項目的任何條目


### Requirement: rail 恆常呈現一個不隸屬於任何 workspace folder 的全域項目

workspace rail SHALL 恆常呈現一個**全域項目**，它 SHALL NOT 隸屬於任何 workspace folder。它
SHALL 位於所有 folder 之前，且 SHALL 恆為 rail **置頂段**的第一列（見「全域項目恆為置頂，且該
狀態不可取消」）。

**明確的視覺分隔 SHALL 劃在置頂段與其餘 folder 之間** —— 亦即全域項目與置頂的 folder 位於分隔
線的**同一側**。此處原本要求分隔線劃在全域項目與整個 folder 清單之間；置頂能力使分隔線之上不再
只有全域項目，兩者無法並存。

因此「使用者要能一眼看出它與 repo 不是同一類東西」這件事 SHALL 由該列**自身的呈現**承擔，而不
再由分隔線承擔：它使用與 folder 不同的圖示、不呈現 git 分支、不提供移除入口，且其置頂指示為
停用。workspace 尚無任何置頂的 folder 時，分隔線的位置與此前相同。

全域項目 SHALL 在 workspace **尚未加入任何 folder** 時同樣呈現。它是這個應用程式恆常提供的一格，
不是 workspace 內容的函數。

全域項目 SHALL 呈現一個標籤，SHALL NOT 呈現 git 分支 —— 它沒有 repo 可讀（見 `repo-branch`，
該能力的措辭限於 workspace 的 folder）。

**全域項目 SHALL NOT 於冷啟動時被預設選中。** 它恆常存在，因此「預設選中它」是極其自然的實作 ——
而那會使冷啟動立刻喚醒它的 focused session，`session-persistence`「開啟應用程式時至多一個 session
被啟動」所倚賴的前提（沒有任何項目被選中）即失效。代價是使用者要多按一下，換來的是那條論證原封
不動地成立。

**rail 上「選中哪個項目」的表示 SHALL 使「未選中」與「選中全域項目」互斥可辨。** 兩者若共用同一個
缺席值，每一處以「有沒有選中」為條件的行為（快捷鍵的無操作條件、狀態列的空狀態）都會把使用者
明確選中的全域項目誤判為「他還沒選」。

#### Scenario: 全域項目位於所有 folder 之前

- **WHEN** workspace 已加入一或多個 folder
- **THEN** rail 的第一個項目為全域項目，其後才是各個 folder

#### Scenario: 分隔線劃在置頂段與其餘 folder 之間

- **WHEN** workspace 有一或多個置頂的 folder
- **THEN** 全域項目與那些置頂的 folder 位於分隔線的同一側，未置頂的 folder 位於另一側

#### Scenario: 尚無置頂的 folder 時分隔線緊接於全域項目之後

- **WHEN** workspace 有一或多個 folder，但沒有任何一個被置頂
- **THEN** 分隔線緊接於全域項目之後，其後才是各個 folder

#### Scenario: 尚無任何 folder 時仍呈現

- **WHEN** workspace 尚未加入任何 folder
- **THEN** rail 仍呈現全域項目

#### Scenario: 不呈現 git 分支

- **WHEN** 使用者檢視 rail 上的全域項目
- **THEN** 該列不呈現任何 git 分支資訊
- **AND** workspace 的持久化設定中不存在任何路徑為家目錄的 folder 條目 —— 全域項目不是被合成
  出來的一筆 folder

#### Scenario: 冷啟動不預設選中全域項目

- **WHEN** 應用程式啟動完成，使用者尚未點選任何 rail 項目
- **THEN** 沒有任何 rail 項目被選中，主舞台呈現尚未選擇項目的空狀態
