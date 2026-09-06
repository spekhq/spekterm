## Purpose

在主舞台上以結構化內容呈現 agent session 的對話，使 agent 的工作不必受限於終端的字格版面，
同時保留終端作為隨時可切回的逃生口。

## ADDED Requirements

### Requirement: agent session 有兩種可切換的 view，終端為預設

agent 目標的 session SHALL 具備**終端**與**對話**兩種 view，並 SHALL 提供在兩者之間切換的入口。

**終端 view SHALL 為預設**，且 SHALL NOT 可被移除 —— 它是對話 view 無法處理任何情況時的逃生口。

shell 目標的 session SHALL NOT 具備對話 view，亦 SHALL NOT 呈現切換入口 —— 它沒有 agent 紀錄。

#### Scenario: 新建的 agent session 預設為終端 view

- **WHEN** 使用者建立一個 agent 目標的 session
- **THEN** 該 session 呈現終端 view
- **AND** 提供切換到對話 view 的入口

#### Scenario: 切換到對話 view 再切回

- **WHEN** 使用者於一個 agent session 切換到對話 view，再切回終端 view
- **THEN** 終端 view 呈現其原有內容

#### Scenario: shell session 沒有對話 view

- **WHEN** 使用者檢視一個 shell 目標的 session
- **THEN** 不呈現切換到對話 view 的入口

### Requirement: 切換 view 不改變 session 的身分與其 pty

切換 view SHALL NOT 建立或結束 pty、SHALL NOT 改變 session 的身分、順序或名稱。

兩種 view 是同一個 session 的兩種呈現，SHALL NOT 呈現為兩個分頁或兩個 session。

#### Scenario: 切到對話 view 後 pty 仍在執行

- **WHEN** 使用者於一個執行中的 agent session 切換到對話 view
- **THEN** 該 session 的 pty 仍在執行
- **AND** 分頁列中該 session 仍為單一一項

### Requirement: 當前 session 的終端保有版面盒子，即使對話 view 在其上

session 為當前顯示的 session 時，其終端 SHALL 保有版面盒子，與哪一個 view 位於上層無關。

**理由**：`terminal-sessions` 的「終端尺寸變化時 pty 尺寸同步」以「容器是否具有版面盒子」為判準，
並明文禁止在沒有盒子時推導或推送尺寸。若對話 view 在上層時終端失去盒子，該 session 的 pty
將停留在一個從未被量測過的初始值 —— agent 會以錯誤的寬度輸出，**而那些輸出一旦印出就永久留在
終端歷史裡**，使用者切回終端 view 時才會看見，屆時已無法補救。

終端不可見時仍 SHALL 依既有條款釋放其程式化繪製的渲染資源 —— 「有版面盒子」與「看得見」
是兩個不同的判準。

#### Scenario: 對話 view 在上層時 pty 的欄數與可用寬度相符

- **WHEN** 一個重建後尚未於終端 view 顯示過的 agent session，被喚醒並直接以對話 view 呈現
- **THEN** 該 session 的 pty 欄數與該區域當下的可用寬度相符
- **AND** 不為初始的暫定值

#### Scenario: 對話 view 在上層時終端不持有渲染資源

- **WHEN** 一個 agent session 以對話 view 呈現
- **THEN** 其終端不持有程式化繪製的渲染資源

### Requirement: 內容不完整時明示，不呈現為完整

對話 view SHALL 於下列情況**明示**其內容不完整，SHALL NOT 呈現為一份完整的對話：

- 尚未跟上紀錄（初次附掛或正在讀取）
- 較早的內容因量體上限而未載入
- 內容無法取得（見 `agent-transcript-stream`）

**理由**：一個安靜落後的對話 view 比沒有 view 更糟 —— 使用者會據此判斷 agent 沒在動。

#### Scenario: 尚未跟上時呈現跟進中

- **WHEN** 使用者切換到對話 view 而內容尚未讀取完成
- **THEN** 呈現「跟進中」的狀態，而非一份空的或部分的對話

#### Scenario: 內容無法取得時說明原因

- **WHEN** 某個 session 的紀錄無法讀取
- **THEN** 對話 view 說明內容無法取得，並指出可切換到終端 view

### Requirement: 休眠的 session 於對話 view 呈現休眠狀態

休眠的 session 於對話 view 之下 SHALL 明確呈現其休眠狀態，SHALL NOT 呈現為一份空的對話。

**一份空的對話與「這個 session 真的還沒講話」無法區分**，而兩者的正確處置不同。

#### Scenario: 休眠 session 於對話 view 呈現休眠

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session 且其當前 view 為對話
- **THEN** 該 session 明確呈現其休眠狀態，而非一份沒有內容的對話

### Requirement: agent 的忙碌狀態來自事件橋接，且 SHALL NOT 模擬逐字產生

對話 view SHALL 依 `agent-event-bridge` 回報的等待狀態呈現 agent 是否正在工作。

訊息 SHALL 於其完整內容抵達時整則出現。系統 SHALL NOT 以任何方式模擬「內容正在逐字產生」——
包含逐字顯示、與訊息長度相關的顯示延遲、或任何宣稱產生進度的呈現。

**理由**：內容抵達時該訊息早已完整，agent 可能已在進行下一件事。一個模擬的產生過程宣稱了一個
沒有來源的進度，與解析終端畫面是同一種錯誤的兩個方向 —— 前者猜測過去發生了什麼，後者演出
一件沒有發生的事。

訊息出現時的轉場效果 SHALL 被允許，但其時長 SHALL NOT 隨訊息長度改變 —— 一旦隨長度變化，
它就開始宣稱進度。

#### Scenario: 忙碌時呈現忙碌，閒置時不呈現

- **WHEN** 使用者送出訊息後 agent 尚未回報閒置
- **THEN** 對話 view 呈現 agent 正在工作
- **AND** agent 回報閒置後該呈現消失

#### Scenario: 訊息整則出現

- **WHEN** 一則新的 agent 訊息抵達
- **THEN** 其完整內容一次出現
- **AND** 不存在逐字顯示的過程

#### Scenario: 轉場時長不隨訊息長度改變

- **WHEN** 分別抵達一則短訊息與一則長訊息
- **THEN** 兩者出現的轉場時長相同

### Requirement: view 的選擇為 per-session，且跨重啟保留

當前 view 的選擇 SHALL 屬於個別 session，SHALL NOT 為全域設定 —— 使用者完全可能一邊以對話
view 看 agent、一邊以終端 view 用 shell。

該選擇 SHALL 跨應用程式重啟保留。

#### Scenario: 兩個 session 各自的 view 互不影響

- **WHEN** 使用者將一個 agent session 切換到對話 view
- **THEN** 其他 session 的 view 不改變

#### Scenario: 重啟後回到上次的 view

- **WHEN** 使用者將某個 agent session 切換到對話 view，關閉並重新開啟應用程式，再喚醒該 session
- **THEN** 該 session 以對話 view 呈現
