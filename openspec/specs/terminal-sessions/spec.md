# terminal-sessions Specification

## Purpose

主舞台的多 session 真 pty 終端 —— 這個工作台**駕駛 agent 的地方**（PRD §6.2：terminal 是主場）。

一個 session 就是一個受**擁有者生命週期**約束的 pty：初始 cwd 落在某個 workspace folder、與
renderer 雙向串流（低延遲且嚴格保序）、隨終端可用尺寸同步 pty 的欄列數，並在關閉分頁、renderer
重新載入、關閉視窗這三種路徑上都被確實終止 —— **不留孤兒行程**。spawn 目標由使用者於建立時選擇
（`claude` 或 login shell）。

**cwd 的邊界只約束「初始」工作目錄，它不是沙箱。** session 一旦啟動即為真實 shell，pty 內執行
的命令不受此邊界限制（使用者可以 `cd` 到任何地方 —— 那正是終端的用途）。這與 `filesystem-access`
的「renderer 只能觸及 workspace」是**不同**的語意，不可據此推論。
## Requirements
### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 為該 folder 的根目錄。

renderer SHALL 僅以 `folderId` 指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑 —— 於是 renderer 在語彙上無法把 session 的初始工作目錄指向 workspace folder 之外。此定址方式使邊界由結構保證，而非由字串驗證事後補救。

此邊界只約束**初始**工作目錄。session 一旦啟動即為真實 shell，pty 內執行的命令 SHALL NOT 被此邊界限制 —— 這與 `filesystem-access` 那種「renderer 只能觸及 workspace」的沙箱語意不同。

#### Scenario: 於可用 folder 建立成功

- **WHEN** renderer 以一個已加入且狀態正常的 `folderId` 建立 session
- **THEN** 主行程回傳一個 session 識別碼，且該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 拒絕未註冊的 folder 識別碼

- **WHEN** 建立 session 的 `folderId` 不對應任何已加入 workspace 的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 拒絕路徑失效的 folder

- **WHEN** 建立 session 的 `folderId` 對應一個路徑已失效的 folder
- **THEN** 建立被拒絕並回報錯誤，不產生任何 pty

#### Scenario: 建立介面不接受任何路徑參數

- **WHEN** 檢視建立 session 的能力介面
- **THEN** 它僅接受 `folderId` 與 spawn 目標，不存在讓 renderer 指定工作目錄路徑的參數

### Requirement: 使用者選擇 session 的 spawn 目標

建立 session 時，使用者 SHALL 能選擇其 spawn 目標為 `claude` 或使用者的 login shell 兩者之一。選擇 login shell 時，session SHALL 提供一個互動 shell。選擇 `claude` 時，session SHALL 嘗試啟動 `claude` agent。

`claude` 無法在使用者環境中被找到或啟動時，終端 SHALL 顯示由底層 shell 產生的失敗訊息，且該 session SHALL 依其行程的結束而標示為已結束 —— SHALL NOT 靜默地毫無回應。

#### Scenario: 選擇 login shell

- **WHEN** 使用者建立 session 並選擇 login shell
- **THEN** 終端出現一個互動 shell 的 prompt，可接受指令

#### Scenario: 選擇 claude

- **WHEN** 使用者建立 session 並選擇 `claude`
- **THEN** session 嘗試啟動 `claude` agent

#### Scenario: claude 無法啟動

- **WHEN** 使用者選擇 `claude`，但環境中找不到 `claude` 命令
- **THEN** 終端顯示失敗訊息，且該 session 標示為已結束，而非靜默無回應

### Requirement: session 與其 pty 雙向串流

focused session 的終端 SHALL 將使用者鍵入的資料送抵其 pty，並 SHALL 將 pty 的輸出顯示於終端。輸出 SHALL 以其產生的順序顯示，SHALL NOT 被重排或合批到失去順序。

#### Scenario: 輸入送達並顯示輸出

- **WHEN** 使用者於 focused session 鍵入一條指令並送出
- **THEN** 該指令送抵 pty，且 pty 的對應輸出顯示於終端

#### Scenario: 輸出保序

- **WHEN** pty 連續產生多段輸出
- **THEN** 這些輸出以產生順序顯示於終端

### Requirement: 切換 session 保留各自的終端內容

非 focused 的 session 其 pty SHALL 持續運作，其於未顯示期間產生的輸出 SHALL NOT 遺失。使用者切回該 session 時，SHALL 能看到期間累積的輸出。

#### Scenario: 背景 session 的輸出於切回後可見

- **WHEN** 一個非 focused 的 session 的 pty 在未顯示期間產生輸出，使用者稍後切回該 session
- **THEN** 期間累積的輸出可見於該 session 的終端

### Requirement: 終端尺寸變化時 pty 尺寸同步

終端可用的顯示尺寸改變時，其 pty 的欄數與列數 SHALL 隨之更新，使 pty 內執行的程式以正確的寬度換行輸出。

#### Scenario: 尺寸改變後 pty 收到新的欄列數

- **WHEN** 終端的可用尺寸改變
- **THEN** 其 pty 的欄數與列數更新為與新尺寸相符的值

### Requirement: session 生命週期釋放，不留孤兒行程

關閉單一 session 時，其 pty 行程 SHALL 被終止。擁有 session 的視窗關閉、或其 renderer 重新載入（導航至應用程式自身來源）時，該 renderer 建立的所有 pty 行程 SHALL 被終止，SHALL NOT 留下任何孤兒行程。

重新載入後的頁面 SHALL NOT 接收先前 pty 的輸出 —— 舊 pty 的串流連同舊 renderer 一併釋放。

#### Scenario: 關閉單一 session 終止其 pty

- **WHEN** 使用者關閉一個運作中的 session
- **THEN** 該 session 的 pty 行程被終止

#### Scenario: 關閉視窗終止其所有 pty

- **WHEN** 擁有若干運作中 session 的視窗被關閉
- **THEN** 該視窗建立的所有 pty 行程皆被終止，不留下任何孤兒行程

#### Scenario: 重新載入釋放先前的 pty

- **WHEN** renderer 重新載入
- **THEN** 先前建立的所有 pty 行程被終止，且重新載入後的頁面不接收任何先前 pty 的輸出

### Requirement: pty 結束在 UI 呈現，不靜默消失

session 的 pty 自行結束（例如使用者於 shell 執行 `exit`、或 `claude` 收工）時，該 session SHALL 在 UI 被標示為已結束，SHALL NOT 自動從清單消失 —— 使用者仍應能看到它最後的輸出。使用者事後 SHALL 能手動關閉一個已結束的 session。

#### Scenario: pty 結束後標示為已結束

- **WHEN** 一個 session 的 pty 自行結束
- **THEN** 該 session 於 UI 標示為已結束，且仍保留在清單中，其最後的輸出仍可見

#### Scenario: 手動關閉已結束的 session

- **WHEN** 使用者關閉一個已結束的 session
- **THEN** 該 session 自清單移除，此時無 pty 需要終止

### Requirement: 啟動失敗以 session 結束與終端訊息呈現，不使應用程式崩潰

所選的 shell 或命令無法執行時（shell 路徑無效、或 `claude` 不存在），該 session SHALL 以其行程的非零結束呈現，且失敗訊息 SHALL 顯示於終端；應用程式 SHALL NOT 因此崩潰。

**建立 session 的呼叫本身 SHALL NOT 因此失敗** —— 實測（node-pty 1.2.0-beta.14）：`spawn` 對 execvp 失敗**不同步拋錯**，它成功回傳一個 pty，該 pty 隨即以非零碼結束，並由輸出串流送出 `execvp(3) failed.` 這類訊息。於是 shell 路徑無效與 `claude` 找不到**殊途同歸**，都走「非零結束 + 終端訊息」這條路徑，而不是回一個錯誤碼。

建立呼叫的錯誤碼只留給**底層 pty 無法配置**這種罕見情形（那才會同步拋錯）。

#### Scenario: shell 或命令無法執行

- **WHEN** 建立 session 後，所選的 shell 或命令無法被執行
- **THEN** 該 session 以非零碼結束，終端顯示失敗訊息，應用程式維持運作

#### Scenario: 建立呼叫不因命令不存在而失敗

- **WHEN** 建立 session 時所指定的 shell 路徑無效
- **THEN** 建立呼叫仍成功回傳 session 識別碼，失敗改以該 session 的非零結束呈現

#### Scenario: 底層 pty 無法配置

- **WHEN** 建立 session 時底層 pty 無法被配置
- **THEN** 建立呼叫以錯誤碼回報失敗，應用程式維持運作

### Requirement: session 的標籤反映 pty 設定的終端標題

pty 內執行的程式 SHALL 能決定其 session 的標籤：程式送出設定終端標題的序列（OSC）時，該 session 在 UI 上的每一處呈現（分頁與 rail 子列）SHALL 以該標題為標籤。

session 的身分因此由**跑在裡面的東西**宣告，而不是由本應用程式的流水號決定 —— 這正是終端模擬器讓分頁自動改名的同一個機制。

pty 從未設定標題（或設定為空）時，標籤 SHALL 退回一個由 spawn 目標與序號組成的本地標籤。

標籤過長時 SHALL 截斷呈現，且**完整標題 SHALL 仍可自該元素的提示取得** —— 截斷是呈現上的取捨，不是資料的遺失。

#### Scenario: pty 設定標題後標籤隨之更新

- **WHEN** 一個 session 的 pty 內的程式送出設定終端標題的序列
- **THEN** 該 session 於分頁與 rail 子列的標籤更新為該標題

#### Scenario: pty 未設定標題時退回本地標籤

- **WHEN** 一個 session 的 pty 從未設定終端標題
- **THEN** 該 session 的標籤為由其 spawn 目標與序號組成的本地標籤

#### Scenario: 過長的標題被截斷但不遺失

- **WHEN** pty 設定了一個超出可呈現長度的標題
- **THEN** 標籤以截斷後的形式呈現，且完整標題可自該元素的提示取得

### Requirement: 終端支援複製與貼上

終端 SHALL 提供複製選取內容與貼上剪貼簿內容的能力，且 SHALL 同時提供**滑鼠**與**鍵盤**兩條路徑 —— 終端若不能複製貼上，等同不能使用。

- 滑鼠：終端上的**右鍵選單** SHALL 提供複製與貼上；無選取內容時，複製 SHALL 為停用狀態。中鍵 SHALL 貼上剪貼簿的內容。
- 鍵盤：SHALL 提供複製與貼上的快捷鍵。

**`Ctrl+C` SHALL 維持送出中斷訊號（SIGINT），SHALL NOT 被挪用為複製** —— 使用者中斷失控程式的能力，不得因畫面上剛好有一段選取而失靈。複製因此採用終端模擬器慣用的 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不與中斷訊號衝突，故於該平台使用 `Cmd+C`／`Cmd+V`）。

貼上的內容 SHALL 原封不動地送交 pty，SHALL NOT 被過濾或轉換。

#### Scenario: 自右鍵選單複製與貼上

- **WHEN** 使用者於終端按下右鍵
- **THEN** 出現包含複製與貼上的選單，且該選單完整落在可視範圍內

#### Scenario: 無選取內容時複製為停用

- **WHEN** 終端中沒有任何選取內容，使用者開啟右鍵選單
- **THEN** 複製項目為停用狀態

#### Scenario: 貼上的內容送達 pty

- **WHEN** 剪貼簿中有一段文字，使用者於終端觸發貼上
- **THEN** 該段文字原封不動地送交 pty

#### Scenario: 複製選取的內容

- **WHEN** 使用者選取終端中的一段輸出並觸發複製
- **THEN** 該段內容被寫入系統剪貼簿

#### Scenario: Ctrl+C 仍為中斷訊號

- **WHEN** 使用者於終端中按下 `Ctrl+C`（無論當下是否有選取內容）
- **THEN** 中斷訊號送交 pty，複製 SHALL NOT 發生

### Requirement: 讀取系統剪貼簿的能力僅在使用者明確要求貼上時使用

renderer 取得的剪貼簿讀取能力 SHALL 僅於使用者明確觸發貼上時使用（右鍵選單、快捷鍵、中鍵），SHALL NOT 主動讀取、SHALL NOT 背景輪詢、SHALL NOT 於啟動時讀取。

系統剪貼簿**沒有 workspace 邊界可言** —— 它可能存放使用者剛複製的任何東西。此能力的可接受性建立在兩道前提之上：renderer 不會被導航至應用程式自身來源之外（見 `workspace-app-shell` 的導航防護），以及讀取只發生於使用者的明確意圖之下。

#### Scenario: 未觸發貼上時不讀取剪貼簿

- **WHEN** 應用程式啟動並開啟 session，使用者未觸發任何貼上操作
- **THEN** 系統剪貼簿的內容未被讀取

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > pty 宣告的終端標題 > 由 spawn 目標與序號組成的本地標籤**。

使用者將名稱清空 SHALL 視為放棄命名權，標籤回到跟隨 pty 宣告的標題。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

### Requirement: 手動命名後，pty 的改名須經使用者確認

使用者已替某 session 指定名稱之後，pty 再送出設定終端標題的序列時，該標題 SHALL NOT 靜默覆蓋使用者指定的名稱。系統 SHALL 呈現確認，讓使用者於兩者之間裁決：

- **採用 pty 的名稱**：使用者指定的名稱 SHALL 被清除，標籤改用該標題，且此後 pty 的改名 SHALL NOT 再需要確認（命名權已交還）。
- **保留使用者的名稱**：該次標題 SHALL 被忽略，標籤維持使用者指定的名稱；pty 其後若再送出不同的標題，SHALL 再次請求確認。

**同一時間 SHALL 至多只有一個待確認的標題。** pty 在確認尚未被裁決時又送出新標題，SHALL 取代原本待確認的那個，SHALL NOT 產生第二個確認 —— 否則頻繁改名的 agent 會把使用者的畫面淹沒。

#### Scenario: pty 於手動命名後改名時請求確認

- **WHEN** 一個已被使用者命名的 session，其 pty 送出一個不同的終端標題
- **THEN** 呈現確認，且該 session 的標籤仍為使用者指定的名稱（尚未被覆蓋）

#### Scenario: 採用 pty 的名稱後不再詢問

- **WHEN** 使用者於確認中選擇採用 pty 的名稱，其後 pty 再送出另一個標題
- **THEN** 標籤直接更新為新的標題，不再呈現確認

#### Scenario: 保留使用者的名稱

- **WHEN** 使用者於確認中選擇保留自己的名稱
- **THEN** 標籤維持使用者指定的名稱，該次 pty 的標題被忽略

#### Scenario: 待確認的標題至多一個

- **WHEN** 確認尚未被裁決時，pty 又送出另一個不同的標題
- **THEN** 待確認的標題被取代為最新的那一個，且確認仍只有一個

### Requirement: session 可錨定一個 change

每個 session SHALL 可錨定其所屬 folder 的**一個** change，供 side panel 的 OpenSpec 身分跟隨。
錨定關係為 per-session —— 不同的 session 可錨定不同的 change。

**錨定關係由使用者建立，SHALL NOT 由系統自 pty 的輸出或標題推測。** pty 中執行的 agent 不會宣告它正在
處理哪個 change，任何由輸出內容進行的推測都會在「標題碰巧提到某個 slug」時假陽性、在「agent 用別的說法
描述同一件事」時假陰性 —— 一個大部分時候對、偶爾莫名其妙跳到別的 change 的側欄，比沒有側欄更糟，
因為使用者會開始不信任它。

這與「session 的標籤反映 pty 設定的終端標題」不矛盾：那條之所以成立，是因為 pty **真的以 OSC 序列宣告了
標題**（一個明確的協定）。change 的錨定沒有這樣的協定。

session 建立時，若其所屬 folder **恰有一個 active change**，該 session SHALL 錨定該 change。
folder 的 active change 為零或多於一個時，新建的 session SHALL 無錨定 —— 系統不在多個候選之間猜測。

session 的錨定 SHALL 可被使用者改變（入口見 `openspec-panel` 的瀏覽視圖）。

錨定關係 SHALL NOT 持久化 —— session 本身即不跨 app 重啟存活。

#### Scenario: folder 恰有一個 active change 時自動錨定

- **WHEN** 使用者於一個恰有一個 active change 的 folder 建立 session
- **THEN** 該 session 錨定該 change

#### Scenario: folder 有多個 active change 時不猜測

- **WHEN** 使用者於一個有多個 active change 的 folder 建立 session
- **THEN** 該 session 無錨定的 change

#### Scenario: folder 沒有 active change

- **WHEN** 使用者於一個沒有 active change 的 folder 建立 session
- **THEN** 該 session 無錨定的 change

#### Scenario: 錨定不隨 pty 的輸出改變

- **WHEN** 一個已錨定 change 的 session，其 pty 輸出了含有另一個 change slug 的內容或終端標題
- **THEN** 該 session 的錨定不改變

#### Scenario: 不同 session 錨定不同 change

- **WHEN** 同一個 folder 的兩個 session 分別錨定了不同的 change
- **THEN** 兩個 session 各自保有其錨定，互不影響

