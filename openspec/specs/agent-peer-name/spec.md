# agent-peer-name Specification

## Purpose
讓每個 claude session 在 agent CLI 的本機訊息機制中有一個**跨重啟不變**的名字，使母、子、兄弟
session（見 `session-lineage`）能以名字互傳訊息。agent CLI 自動產生的名字每次行程啟動都會變，
而 spekterm 的 session 在重開、續接、自癒時都是新的行程 —— 不指定名字，記住的地址下一次重開就失效。

**本能力依賴 agent CLI 的行為**（以啟動參數指定名字、該名字即為訊息的地址且可跨工作目錄送達、
指定名字會固定終端標題、名字相撞時的處置），而不是本應用程式的行為。這些行為 SHALL 以真實的
agent CLI 實測，實測結論與所用的版本 SHALL 被記載；agent CLI 換版之後 SHALL 重測。

## Requirements

### Requirement: 每個 claude session 有一個固定的名字，一律啟用

每個 claude 目標的 session SHALL 有一個名字，組成為「前綴」、一個連字號、與「由 spekterm 的
session 識別碼推導的短碼」：

- 前綴取自該 session 所屬 rail 項目的名稱，**只保留各種文字的字母與數字、`_` 與 `-`**（CJK 保留），
  其餘字元（空白、引號、`$`、控制字元…）以 `-` 取代並收斂連續的 `-`、去除首尾的 `-`；全域 session
  的前綴為固定的 `global`；處理後為空者以固定的 `session` 代之。**名字 SHALL 以字母或數字開頭**
  （否則會被 agent CLI 當成旗標），且總長 SHALL 有上限（超過時截短前綴）。
  > agent CLI 本身接受任意字元（已實測：空白、CJK、引號皆原樣登記）。收斂字元集是為了讓名字在
  > agent 的訊息定址、命令列與人眼中都沒有歧義，不是 CLI 的要求。
- 名字 SHALL 於該 session **建立時**決定（既有而尚無名字的 session 於載入時決定），並持久化
  （見 `session-persistence`）。SHALL NOT 延後到第一次啟動 agent 才決定 —— 休眠的 session 在被
  喚醒之前同樣要能被告知給它的母、子、兄弟。

**本能力一律啟用，不設開關，且不受交接開關影響。** 地址穩定與否不該取決於一個與它無關的偏好。

**名字 SHALL 在同一個 session 的每一次啟動中相同** —— 新建、應用程式重啟後的喚醒、續接、續接失敗
後自癒成新對話，皆同。

**名字 SHALL 於本應用程式持有的所有 session 之間唯一，比較時不分大小寫**（保守起見 —— agent CLI
的比較方式未實測）。兩個 session 的短碼相同時，SHALL 以較長的短碼區分；**已經指定給某個 session
的名字 SHALL NOT 因另一個 session 的出現而改變**。

**agent CLI 允許兩個執行中的行程同名**（已實測：兩者都保留同一個名字）—— 同名的後果是**歧義**：
以那個名字送出的訊息可能抵達任何一個。本能力不防禦與本應用程式之外的行程同名。

shell 目標的 session SHALL NOT 被指定名字。

#### Scenario: 名字的組成

- **WHEN** 使用者於名為 `spekterm` 的 folder 建立一個 claude session
- **THEN** 該 session 的 agent 以「`spekterm-` 加上由該 session 識別碼推導的短碼」為名啟動

#### Scenario: 名稱全為非 ASCII 的 folder

- **WHEN** 使用者於名為 `簡報` 的 folder 建立一個 claude session
- **THEN** 該 session 的名字以 `簡報-` 開頭

#### Scenario: 名稱沒有任何字母或數字的 folder

- **WHEN** 使用者於名為 `---` 的 folder 建立一個 claude session
- **THEN** 該 session 的名字以 `session-` 開頭

#### Scenario: The name is given even when no feature is injected

- **WHEN** no injected feature contributes to a claude session (for example its handoff outbox
  cannot be prepared and the other bridges are off), and the user creates that session
- **THEN** the session's agent still starts with its fixed name

#### Scenario: 重新啟動之後名字不變

- **WHEN** 一個 claude session 以某個名字啟動，其後應用程式重新啟動，該 session 被喚醒並續接
- **THEN** 它以相同的名字啟動

#### Scenario: 休眠的 session 已有名字

- **WHEN** 應用程式重新啟動之後，一個 claude session 尚未被喚醒
- **THEN** 它已有名字，且與上一次執行時相同

#### Scenario: 自癒成新對話時名字不變

- **WHEN** 一個 claude session 續接失敗、以全新的對話重建
- **THEN** 重建後的 agent 以相同的名字啟動

#### Scenario: 短碼相同的兩個 session 名字不同

- **WHEN** 同一個 folder 中兩個 session 的識別碼推導出相同的短碼
- **THEN** 兩者以不同的名字啟動，且先建立的那一個的名字與它在另一個出現之前相同

#### Scenario: 只差大小寫的兩個 folder 名稱

- **WHEN** 兩個 folder 的名稱只差大小寫，其中各有一個識別碼推導出相同短碼的 claude session
- **THEN** 兩者的名字以不分大小寫比較時仍不同

#### Scenario: shell session 沒有名字

- **WHEN** 使用者建立一個 shell 目標的 session
- **THEN** 啟動它時未指定任何名字

### Requirement: 同一個 session 的前一個 agent 行程結束之前，不以同一個名字啟動新的

重新載入或重建使一個 session 的 agent 被重新啟動時，前一個 agent 行程可能尚未結束；那段期間兩個
行程同名，以該名字送出的訊息可能抵達即將被終止的那一個而遺失。系統 SHALL 在同一個 session 的
前一個 pty 結束之後，才以該名字啟動新的 agent。

#### Scenario: renderer 重新載入後喚醒的 session 保有名字

- **WHEN** 一個 claude session 正在執行，renderer 重新載入，該 session 隨即被喚醒
- **THEN** 新的 agent 以原本的名字啟動

### Requirement: 名字不受使用者在 spekterm 中重新命名影響

使用者於 spekterm 中重新命名一個 session（見 `terminal-sessions`「使用者可替 session 命名」）
SHALL 只改變 spekterm 呈現的標籤，SHALL NOT 改變該 session 的名字，SHALL NOT 往它的 pty 寫入
任何內容。

#### Scenario: 重新命名之後名字不變

- **WHEN** 使用者把一個 claude session 重新命名，其後應用程式重新啟動而該 session 被喚醒
- **THEN** 它以原本的名字啟動
- **AND** 分頁上呈現使用者取的名稱

### Requirement: 名字以不經命令字串解析的方式交給 agent CLI，且不被巢狀的執行個體繼承

agent CLI 以一個**字串命令**經 login shell 啟動。名字 SHALL NOT 被拼接進該命令字串，SHALL 經由
不會被 shell 再解析一次的途徑交付；交付 SHALL NOT 依賴任何其他可被關閉的注入功能 —— 那些功能
全部關閉時，名字仍 SHALL 被交付。

pty 的環境由本應用程式自身的環境展開而來，而本應用程式可能是在另一個 spekterm 的 session 之中被
啟動的（開發時的常態）。**本應用程式為 session 設定的所有專屬環境變數 SHALL NOT 由外層繼承進 pty**
—— 否則內層的 agent 可能拿到外層某個仍在執行的 session 的名字，兩者相撞。

#### Scenario: 含有 shell 特殊字元的 folder 名稱

- **WHEN** 一個名為 `a"b $(touch x)` 的 folder 中建立一個 claude session
- **THEN** 該 session 正常啟動，其名字的前綴取自該 folder 名稱
- **AND** 沒有任何命令因該名稱而被執行

#### Scenario: 其他注入功能全部關閉時仍交付名字

- **WHEN** 事件回報、狀態列串接與交接皆為關閉，使用者建立一個 claude session
- **THEN** 該 session 的 agent 以其固定名字啟動

#### Scenario: 外層的專屬環境變數不進入 pty

- **WHEN** 本應用程式自身的環境中已有一個為 session 設定名字的專屬環境變數，使用者建立一個 shell session
- **THEN** 該 pty 的環境中不含那個外層的值

### Requirement: 固定名字會固定 agent 的終端標題，此代價須被記載

**已實測（agent CLI 2.1.282）**：以指定的名字啟動時，agent 宣告的終端標題固定為該名字，
SHALL NOT 預期它再依任務改寫。因此未經使用者命名的 claude session，其分頁標籤將是它的名字。

本條存在的理由是讓下一個讀規格的人不必重新推導「為什麼分頁不再顯示任務名稱」；使用者要看到
任務名稱，途徑是 spekterm 既有的重新命名。`terminal-sessions`「session 的標籤反映 pty 設定的
終端標題」不因此改變 —— 標籤仍反映 pty 宣告的標題，只是那個標題不再變化。

#### Scenario: 未命名的 claude session 其分頁呈現名字

- **WHEN** 使用者建立一個 claude session 且未為它命名
- **THEN** 其分頁的標籤含有該 session 的名字
