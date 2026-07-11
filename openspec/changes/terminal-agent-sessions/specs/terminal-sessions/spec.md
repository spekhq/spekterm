## ADDED Requirements

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

### Requirement: spawn 失敗被回報且不使應用程式崩潰

底層 shell 本身無法啟動時，建立 session 的呼叫 SHALL 以錯誤回報，應用程式 SHALL NOT 崩潰。

#### Scenario: 底層 shell 無法啟動

- **WHEN** 建立 session 時底層 shell 行程無法被啟動
- **THEN** 該呼叫以錯誤碼回報失敗，應用程式維持運作
