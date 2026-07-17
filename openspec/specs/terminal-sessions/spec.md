# terminal-sessions Specification

## Purpose

主舞台的多 session 真 pty 終端 —— 這個工作台**駕駛 agent 的地方**（PRD §6.2：terminal 是主場）。

一個**運作中**的 session 就是一個受**擁有者生命週期**約束的 pty：初始 cwd 落在某個 workspace
folder 之內、與 renderer 雙向串流（低延遲且嚴格保序）、隨終端可用尺寸同步 pty 的欄列數，並在關閉
分頁、renderer 重新載入、關閉視窗這三種路徑上都被確實終止 —— **不留孤兒行程**。spawn 目標由使用者
於建立時選擇（`claude` 或 login shell）。

**但「session」不等於「pty」**：由 `session-persistence` 重建出來的 session 是**休眠**的 —— 它有完整
的身分（名字、順序、錨定的 change）與畫面，卻**還沒有 pty**，要到首次被顯示時才啟動一個。本規格的
各項要求，凡涉及 pty 者，皆指運作中的 session。

**cwd 的邊界只約束「初始」工作目錄，它不是沙箱。** session 一旦啟動即為真實 shell，pty 內執行
的命令不受此邊界限制（使用者可以 `cd` 到任何地方 —— 那正是終端的用途）。這與 `filesystem-access`
的「renderer 只能觸及 workspace」是**不同**的語意，不可據此推論。
## Requirements
### Requirement: 於選中的 folder 建立終端 session

renderer SHALL 能在一個已加入且可用的 workspace folder 建立一個終端 session；建立成功時主行程 SHALL 回傳一個 session 識別碼。session 的 pty 初始工作目錄 SHALL 落在該 folder 的**邊界內** —— 新建的 session SHALL 為該 folder 的根目錄；由 `session-persistence` **重建**的 session SHALL 為其最後已知的工作目錄，該目錄無法取得或越出邊界時 SHALL 退回該 folder 的根目錄。

renderer SHALL 僅以 `folderId` 指定 session 的位置，SHALL NOT 傳遞任何絕對或相對路徑 —— 於是 renderer 在語彙上無法把 session 的初始工作目錄指向 workspace folder 之外。此定址方式使邊界由結構保證，而非由字串驗證事後補救。**重建的工作目錄不構成例外**：它由主行程自行取得、驗證與夾制，不經 renderer 之手（見 `session-persistence`）。

此邊界只約束**初始**工作目錄。session 一旦啟動即為真實 shell，pty 內執行的命令 SHALL NOT 被此邊界限制 —— 這與 `filesystem-access` 那種「renderer 只能觸及 workspace」的沙箱語意不同。

#### Scenario: 於可用 folder 建立成功

- **WHEN** renderer 以一個已加入且狀態正常的 `folderId` 建立 session
- **THEN** 主行程回傳一個 session 識別碼，且該 session 的 pty 初始工作目錄為該 folder 的根目錄

#### Scenario: 重建的 session 其初始工作目錄仍落在邊界內

- **WHEN** 一個重建的 session 被啟動，而其最後已知的工作目錄位於該 folder 之外
- **THEN** 該 session 的 pty 初始工作目錄為該 folder 的根目錄

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

### Requirement: 終端的字格渲染獨立於字型的 glyph 幾何

終端呈現 block element 與 box-drawing 字元時，SHALL NOT 倚賴字型自身的 glyph 幾何 —— 這些字元 SHALL 依 cell 的邊界程式化繪製。

**倚賴 glyph 的呈現有兩個各自獨立的缺陷，它們在不同的方向上壞掉：**

- **垂直方向**：glyph 僅約 1em 高，而 cell 的高度是 `字級 × 行高` —— 行高大於 1 時，上下列的框線之間留縫。
- **水平方向**：cell 的寬度是分數像素時，落在整數像素上的框線銳利、落在分數位置的被反鋸齒攤到兩個像素而成為兩道淡線 —— **同一張表格內的框線因而粗細不一**。此缺陷與行高無關，**行高為 1 時依然存在**。

因此：

- 框線的連續性 SHALL NOT 隨行高改變。
- 框線的呈現 SHALL NOT 隨 cell 落在整數或分數像素而改變。
- 程式化繪製不可用時，終端 SHALL 退回倚賴 glyph 的呈現 —— SHALL NOT 崩潰、SHALL NOT 呈現空白、SHALL NOT 遺失既有內容。**該降級路徑是真實可達的**（渲染資源取不到、驅動有缺陷、或使用者自行關閉 GPU 加速），因此凡以「框線是否相接」為據的預設值，SHALL 以降級路徑為準（見 `terminal-preferences`）。

#### Scenario: 框線於任何行高下皆相接

- **WHEN** 終端以程式化繪製呈現含框線的輸出，且行高設為大於 1 的值
- **THEN** 上下列的框線相接，SHALL NOT 因行高而留下縫隙

#### Scenario: 框線的粗細不隨 cell 的像素落點改變

- **WHEN** 終端以程式化繪製呈現含框線的輸出，且 cell 的寬度為分數像素
- **THEN** 同一輸出內的各條框線呈現一致，SHALL NOT 有的銳利、有的被攤為兩道淡線

#### Scenario: 程式化繪製不可用時退回且不遺失內容

- **WHEN** 程式化繪製的渲染路徑無法建立，或於執行期失效
- **THEN** 終端以倚賴 glyph 的方式繼續呈現，既有內容仍在，SHALL NOT 崩潰或呈現空白

### Requirement: 程式化繪製的渲染資源僅供當下顯示的終端

程式化繪製所需的渲染資源 SHALL 僅由使用者當下看得見的那一個終端持有；終端由顯示轉為隱藏時 SHALL 釋放之，由隱藏轉為顯示時 SHALL 取得之。

**理由，以及為什麼這不是一項優化而是正確性要求**：所有 session 的終端**同時掛載**（各自保留 scrollback，見「切換 session 保留各自的終端內容」）。而該渲染資源在瀏覽器中有**並存數上限**，**超出上限時最早取得的會被靜默回收 —— 不觸發任何可觀察的事件**。若每個終端各持有一份：開了足夠多 session 的使用者會看到較舊的終端**無聲地變成空白**，而上一條的「不可用時退回」**救不了他** —— 那條自癒倚賴一個失效通知，而這裡根本沒有通知。

「需要框線正確」的地方恰好就是「使用者看得見」的地方，因此此限制不損及能力。

#### Scenario: 任一時刻只有顯示中的終端持有渲染資源

- **WHEN** 使用者建立多個 session 並在其間切換
- **THEN** 任一時刻僅有顯示中的那一個終端持有程式化繪製的渲染資源，其餘皆已釋放

#### Scenario: 切回的終端重新取得渲染資源且內容完整

- **WHEN** 使用者切離一個 session 後再切回
- **THEN** 該終端重新以程式化繪製呈現，且其先前的內容仍在

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

**spawn 目標為 `claude` 的 session**，其 pty 內執行的程式 SHALL 能決定該 session 的標籤：程式送出設定終端標題的序列（OSC）時，該 session 在 UI 上的每一處呈現（分頁與 rail 子列）SHALL 以該標題為標籤。

session 的身分因此由**跑在裡面的東西**宣告，而不是由本應用程式的流水號決定 —— 這正是終端模擬器讓分頁自動改名的同一個機制。

**spawn 目標為 login shell 的 session SHALL NOT 採用 pty 宣告的標題**，一律使用由 spawn 目標與序號組成的本地標籤（`shell 1`、`shell 2`…）。login shell 宣告的標題是它的預設 prompt 標題（`使用者@主機:/路徑`），對使用者不具識別意義；且它比 session 本身晚抵達，採用它會使分頁的寬度在使用者眼前突變，把緊鄰其後的建立入口推離游標。

pty 從未設定標題（或設定為空）時，標籤 SHALL 退回一個由 spawn 目標與序號組成的本地標籤。

標籤過長時 SHALL 截斷呈現，且**完整標題 SHALL 仍可自該元素的提示取得** —— 截斷是呈現上的取捨，不是資料的遺失。

#### Scenario: claude session 的 pty 設定標題後標籤隨之更新

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 內的程式送出設定終端標題的序列
- **THEN** 該 session 於分頁與 rail 子列的標籤更新為該標題

#### Scenario: login shell 的 session 不採用 pty 宣告的標題

- **WHEN** 一個 spawn 目標為 login shell 的 session，其 pty 送出設定終端標題的序列
- **THEN** 該 session 的標籤**維持**本地標籤（`shell N`），不因該標題而改變

#### Scenario: pty 未設定標題時退回本地標籤

- **WHEN** 一個 session 的 pty 從未設定終端標題
- **THEN** 該 session 的標籤為由其 spawn 目標與序號組成的本地標籤

#### Scenario: 過長的標題被截斷但不遺失

- **WHEN** 一個 spawn 目標為 `claude` 的 session，其 pty 設定了一個超出可呈現長度的標題
- **THEN** 標籤以截斷後的形式呈現，且完整標題可自該元素的提示取得

### Requirement: 終端支援複製與貼上

終端 SHALL 提供複製選取內容與貼上剪貼簿內容的能力，且 SHALL 同時提供**滑鼠**與**鍵盤**兩條路徑 —— 終端若不能複製貼上，等同不能使用。

- **鍵盤**：SHALL 提供複製與貼上的快捷鍵。鍵盤路徑 SHALL NOT 受 pty 是否啟用 mouse reporting 影響。
- **右鍵（gate 在 mouse reporting）**：pty 內的程式**未啟用** mouse reporting 時，右鍵 SHALL 開啟複製／貼上選單（無選取內容時複製 SHALL 為停用）；程式**已啟用** mouse reporting（例如 claude 接管滑鼠）時，右鍵 SHALL 交由該程式處理（由 xterm 轉發），終端 SHALL NOT 開啟自己的選單 —— 否則會與程式自身的右鍵慣例（如右鍵貼上）雙重作用。當下的 mouse reporting 狀態 SHALL 於事件發生時判定（程式會在執行期間動態開關）。原生瀏覽器選單 SHALL 一律不呈現。
- **中鍵（一律由終端擁有）**：中鍵貼上是終端的慣例，SHALL 一律由終端貼上剪貼簿的內容，且**恰好一次**，**與 mouse reporting 是否啟用無關**。終端 SHALL 擋掉瀏覽器原生的中鍵貼上、且 SHALL NOT 把中鍵轉發給 pty 內的程式 —— 否則原生貼上與程式的處理會疊加成多次貼上。

**`Ctrl+C` SHALL 維持送出中斷訊號（SIGINT），SHALL NOT 被挪用為複製** —— 使用者中斷失控程式的能力，不得因畫面上剛好有一段選取而失靈。複製因此採用終端模擬器慣用的 `Ctrl+Shift+C`（macOS 的 `Cmd+C` 不與中斷訊號衝突，故於該平台使用 `Cmd+C`／`Cmd+V`）。

貼上的內容 SHALL 原封不動地送交 pty，SHALL NOT 被過濾或轉換。

#### Scenario: 未啟用 mouse reporting 時自右鍵選單複製與貼上

- **WHEN** pty 內的程式未啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 出現包含複製與貼上的選單，且該選單完整落在可視範圍內

#### Scenario: 無選取內容時複製為停用

- **WHEN** pty 未啟用 mouse reporting、終端中沒有任何選取內容，使用者開啟右鍵選單
- **THEN** 複製項目為停用狀態

#### Scenario: 啟用 mouse reporting 時右鍵讓位給程式

- **WHEN** pty 內的程式已啟用 mouse reporting，使用者於終端按下右鍵
- **THEN** 終端 SHALL NOT 開啟自己的選單，該滑鼠事件交由 pty 內的程式處理

#### Scenario: 中鍵貼上恰好一次

- **WHEN** 剪貼簿中有一段文字，使用者於終端按下中鍵（無論 pty 是否啟用 mouse reporting）
- **THEN** 該段文字**恰好一次**送交 pty，SHALL NOT 因瀏覽器原生中鍵貼上或程式的轉發處理而重複

#### Scenario: 複製選取的內容

- **WHEN** 使用者選取終端中的一段輸出並觸發複製
- **THEN** 該段內容被寫入系統剪貼簿

#### Scenario: 以鍵盤貼上的內容送達 pty

- **WHEN** 剪貼簿中有一段文字，使用者以貼上快捷鍵觸發貼上
- **THEN** 該段文字原封不動地送交 pty

#### Scenario: Ctrl+C 仍為中斷訊號

- **WHEN** 使用者於終端中按下 `Ctrl+C`（無論當下是否有選取內容）
- **THEN** 中斷訊號送交 pty，複製 SHALL NOT 發生

### Requirement: 讀取系統剪貼簿的能力僅在使用者明確要求貼上時使用

renderer 取得的剪貼簿讀取能力 SHALL 僅於使用者明確觸發貼上時使用（右鍵選單、快捷鍵、中鍵），SHALL NOT 主動讀取、SHALL NOT 背景輪詢、SHALL NOT 於啟動時讀取。

系統剪貼簿**沒有 workspace 邊界可言** —— 它可能存放使用者剛複製的任何東西。此能力的可接受性建立在兩道前提之上：renderer 不會被導航至應用程式自身來源之外（見 `workspace-app-shell` 的導航防護），以及讀取只發生於使用者的明確意圖之下。

#### Scenario: 未觸發貼上時不讀取剪貼簿

- **WHEN** 應用程式啟動並開啟 session，使用者未觸發任何貼上操作
- **THEN** 系統剪貼簿的內容未被讀取

### Requirement: 終端內的連結一律經受控接縫開啟

終端內被觸發的連結，無論其為輸出中的純文字 URL 或 OSC 8 escape-sequence 超連結，SHALL 一律交由
主行程驗證協定後以系統的預設瀏覽器開啟。終端呈現的內容是不受信任的 —— pty 的輸出中，使用者 repo
裡的任何東西都可能印出一個 URL。

終端內的連結 SHALL NOT 落入終端模擬器的內建預設連結處理器 —— 該預設會彈出一個其文字由不受信任
輸出所控制的確認對話框，並嘗試自行開啟視窗。僅協定屬於 `http` 或 `https` 的連結 SHALL 被開啟，
其餘協定 SHALL 被拒絕；此協定驗證 SHALL 在主行程執行。

#### Scenario: 終端輸出中的 OSC 8 超連結被觸發

- **WHEN** pty 輸出一個 OSC 8 超連結，且使用者觸發它
- **THEN** 該連結經主行程的協定驗證後交由系統瀏覽器開啟，且不彈出終端模擬器內建的確認對話框

#### Scenario: 終端連結的非安全協定被拒絕

- **WHEN** 終端內一個協定不屬於 `http` 或 `https` 的連結被交付至主行程
- **THEN** 主行程拒絕開啟它

### Requirement: 主行程的剪貼簿寫入對畸形輸入防禦

主行程接收 renderer 剪貼簿寫入請求的進入點 SHALL 對輸入型別防禦：收到非字串的輸入時 SHALL 丟棄
該請求，且 SHALL NOT 因此產生未捕捉的例外。

renderer 端的型別標註屬編譯期，不構成執行期防護 —— 一個被入侵或有 bug 的 renderer 可送出任意
型別的值。此防護 SHALL 在主行程這一側執行。

#### Scenario: renderer 送出非字串的剪貼簿寫入

- **WHEN** renderer 對剪貼簿寫入進入點送出一個非字串的值
- **THEN** 該請求被丟棄，主行程不產生未捕捉的例外並繼續正常運作

#### Scenario: 正常的字串寫入不受影響

- **WHEN** renderer 送出一個字串以寫入系統剪貼簿
- **THEN** 該文字被寫入系統剪貼簿

### Requirement: 使用者可替 session 命名，且優先於 pty 宣告的標題

使用者 SHALL 能替任一 session 指定名稱，**不分 spawn 目標**。session 標籤的取用順序 SHALL 為：**使用者指定的名稱 > pty 宣告的終端標題（僅 `claude` 目標）> 由 spawn 目標與序號組成的本地標籤**。

**指定名稱 SHALL 視為使用者永久接管該 session 的命名權。** 此後 pty 送出設定終端標題的序列時，該標題 SHALL NOT 覆蓋使用者指定的名稱，且系統 SHALL NOT 因此呈現任何確認或提示 —— 該標題被靜默地不予呈現。

此規則**不因 pty 送出的標題與先前是否相同而異**：pty 反覆宣告同一個標題，與宣告一連串不同的標題，處理方式相同 —— 皆不呈現、不打斷。

**pty 宣告的標題 SHALL 於使用者接管期間持續被記錄**（僅不呈現）。

使用者將名稱清空 SHALL 視為放棄命名權：`claude` 目標的 session 標籤**立即**回到 pty **最近一次**宣告的標題（含接管期間所宣告者；pty 從未宣告過時則為本地標籤），login shell 的 session 則回到本地標籤。

#### Scenario: 命名後標籤採用使用者指定的名稱

- **WHEN** 使用者替一個 session 指定名稱
- **THEN** 該 session 於分頁與 rail 子列的標籤皆為該名稱

#### Scenario: 命名後 pty 宣告不同的標題不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 送出一個與該名稱不同的終端標題
- **THEN** 不呈現任何對話框或提示，且該 session 的標籤維持使用者指定的名稱

#### Scenario: 命名後 pty 反覆宣告標題仍不打斷使用者

- **WHEN** 一個已被使用者命名的 `claude` session，其 pty 連續送出多個終端標題（含與先前相同者）
- **THEN** 全程不呈現任何對話框或提示，且該 session 的標籤始終維持使用者指定的名稱

#### Scenario: claude session 清空名稱後立即回到 pty 最近宣告的標題

- **WHEN** 使用者將某個 spawn 目標為 `claude`、且其 pty 曾於接管期間宣告過標題的 session 的名稱清空
- **THEN** 該 session 的標籤**立即**變為 pty 最近一次宣告的標題，不需等待 pty 再次宣告

#### Scenario: claude session 清空名稱後回到跟隨 pty

- **WHEN** 使用者將某個 spawn 目標為 `claude` 的 session 的名稱清空
- **THEN** 該 session 的標籤回到 pty 宣告的標題（pty 未宣告時則為本地標籤）

#### Scenario: login shell 的 session 清空名稱後回到本地標籤

- **WHEN** 使用者將某個 spawn 目標為 login shell 的 session 的名稱清空
- **THEN** 該 session 的標籤回到本地標籤（`shell N`），即使其 pty 曾宣告過標題

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

