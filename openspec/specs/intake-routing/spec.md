# intake-routing Specification

## Purpose
決定一則 intake 該在哪個 workspace folder 被處理：一組使用者可編輯的有序規則，比對 intake 的
通用欄位，得出一個 folder；解析不出來時**拒絕並說明**，而不是靜默開在某個地方。

## Requirements

### Requirement: routing 為使用者可編輯的有序規則，第一個命中者勝出

系統 SHALL 以一組**有序規則**把一則 intake 解析為一個 folder。規則 SHALL 依序比對，
**第一個命中的規則勝出**，其後的規則不再參與。

規則 SHALL 為**資料**：使用者 SHALL 能新增、修改、刪除與調整順序，SHALL NOT 需要修改程式碼或
重新安裝應用程式。

規則的判準 SHALL 限於 intake 的通用欄位，SHALL NOT 能以來源專屬的原始內容為判準。

#### Scenario: 第一個命中的規則勝出

- **WHEN** 三條規則分別指向三個不同的 folder，一則 intake 同時符合第二條與第三條
- **THEN** 解析結果為**第二個** folder

#### Scenario: 把規則往後移改變結果，且結果是絕對的

- **WHEN** 承上，使用者把**第二條規則移到第三條之後**
- **THEN** 同一則 intake 的解析結果為**第三條原本所指向的那個** folder

#### Scenario: 依來源座標識別碼解析

- **WHEN** 一則 intake 的來源座標識別碼符合某條規則，而其標題不符合任何規則
- **THEN** 解析結果為該規則指向的 folder

### Requirement: 以第三方撰寫的欄位為判準的規則須標示其可被操縱

規則的判準若為 intake 中**第三方逐字撰寫**的欄位（標題、本文、發起者、來源座標的標籤），
編輯介面 SHALL 標示該判準**可被投遞者操縱**。以**接收端可驗證**的欄位（來源種類、來源座標的
識別碼）為判準的規則 SHALL NOT 被如此標示。

以第三方撰寫的欄位決定開在哪個 repo，等同讓投遞者選擇他的 intake 會落在哪個工作目錄 ——
而他會選擇許可姿態最寬鬆的那一個。**這件事無法以驗證化解**（那些欄位本來就該是自由文字），
只能讓使用者在建立規則的當下知道他在交出什麼。

#### Scenario: 兩種判準的標示不同

- **WHEN** 使用者建立一條以標題為判準的規則與一條以來源座標識別碼為判準的規則
- **THEN** 前者被標示為可被投遞者操縱
- **AND** 後者未被如此標示

### Requirement: 有一條 fallback，且它是規則而非內建行為

系統 SHALL 支援一條 **fallback**：沒有任何規則命中時採用的 folder。

fallback SHALL 由使用者設定，SHALL NOT 為系統內建的某個 folder（例如清單中的第一個或當下
選中的那一個）—— 內建的選擇會讓使用者在毫不知情的情況下得到一個看似正確的結果。

#### Scenario: 規則存在但都不命中時採用 fallback

- **WHEN** 存在一條**指向 A 且刻意不命中**的規則，fallback 指向 B，且 A ≠ B
- **THEN** 解析結果為 **B**

#### Scenario: 一條規則都沒有時採用 fallback

- **WHEN** 規則清單為空，只設定了 fallback
- **THEN** 解析結果為 fallback 指向的 folder

### Requirement: 解析不出 folder 時拒絕並說明，不靜默退回

沒有任何規則命中且未設定 fallback 時，系統 SHALL 拒絕解析並**說明原因**，
SHALL NOT 退回任何預設的 folder。

**命中的規則所指向的 folder 已不在 workspace 中時，SHALL 同樣拒絕**，SHALL NOT 視為「未命中」
而繼續往下比對或落到 fallback —— 使用者明確指定的目標不可用時，正確的處置是告訴他，而不是
悄悄換一個地方。

**理由與工作目錄識別碼查無對應時的處置同源**：靜默退回會讓一個 session 開在使用者以為的地方
以外，而他不會知道。

#### Scenario: 無規則亦無 fallback 時拒絕

- **WHEN** 一則待處理的 intake 不符合任何規則，且未設定 fallback
- **THEN** 該則 intake 無法被接受，且系統說明無法解析出 folder

#### Scenario: 指向的 folder 已被移出 workspace 時拒絕，即使 fallback 可用

- **WHEN** 命中規則所指向的 folder 已不在 workspace 中，**而 fallback 已設定且指向一個可用的
  folder**
- **THEN** 該則 intake 無法被接受，且系統說明該 folder 不再可用
- **AND** 解析結果不是 fallback 指向的 folder

#### Scenario: 解析失敗時嘗試接受不建立任何 session

- **WHEN** 解析失敗，使用者嘗試接受該則 intake
- **THEN** session 的總數與嘗試之前相同
- **AND** 該則 intake 仍為待處理

### Requirement: 使用者在接受之前看得到將開在哪個 folder

系統 SHALL 於一則待處理的 intake 上呈現它**目前解析到哪個 folder**，且該呈現 SHALL 在使用者
接受它之前即可見。解析不出時，SHALL 呈現原因而非任何 folder。

規則命中錯誤的代價是 session 開在錯的 repo；在按下去之前就看得到結果，使用者才有機會發現。

#### Scenario: 可解析與不可解析的兩則同時呈現

- **WHEN** 收件匣中有一則可解析與一則不可解析的待處理 intake
- **THEN** 前者呈現它將開啟的 folder 名稱
- **AND** 後者呈現無法解析的原因，且不呈現任何 folder 名稱

### Requirement: 規則落於本能力自己的持久化位置，與使用者偏好分離

規則與 fallback SHALL 跨應用程式重啟保留，且 SHALL 落於**本能力自己的持久化位置**，
SHALL NOT 與終端偏好共用同一份檔案或同一個物件。

既有的偏好檔案，其寫入路徑會從空物件重建其內容、且整份檔案於每次儲存時被重新產生 ——
任何寄居其中的欄位都倚賴每一個寫入者記得保留它。規則被那條路徑丟棄時，**fallback 可能仍在**
（或反之），於是其後每一則 intake 都靜默地改道，**而介面上呈現的解析結果是誠實的** ——
它報的就是那個錯誤的結果。使用者調整一次字型，收件匣就改了道。

**規則的編輯入口 SHALL NOT 置於既有的偏好設定對話框之內** —— 該對話框的內容由另一個能力以
列舉的方式規定，往其中加入本能力的區段將構成對該能力的修改。

持久化的內容 SHALL 以白名單判定：形狀不合的單條規則 SHALL 被忽略，SHALL NOT 使其餘規則失效。

#### Scenario: 經編輯介面建立的規則跨重啟保留

- **WHEN** 使用者**經編輯介面**新增一條規則，應用程式其後重新啟動
- **THEN** 該規則仍然生效

#### Scenario: 變更終端偏好不影響規則

- **WHEN** 規則與 fallback 皆已設定，使用者其後變更終端字型設定
- **THEN** 規則與 fallback 皆未改變

#### Scenario: 形狀不合的規則被忽略而非使其餘失效

- **WHEN** 持久化的內容中有一條欄位型別不合的規則與數條合法規則
- **THEN** 合法的規則照常生效
