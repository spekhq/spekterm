## MODIFIED Requirements

### Requirement: 狀態列呈現 agent 回報的用量，缺席時退回第一手欄位

當 focused session 的 agent 狀態可取得時（見 `claude-status-bridge`），狀態列 SHALL 呈現該 agent
回報的：**模型顯示名稱、推理強度（effort）、是否啟用延伸思考、context window 的使用百分比、
本次工作累計的增刪行數、花費，以及各個用量上限的使用比例與其重置時刻。**

重置時刻 SHALL 以**使用者當地時區**呈現。用量上限的窗口跨日與否決定其精細度：當日內重置者
SHALL 只呈現時間，跨日者 SHALL 一併呈現日期。

**其格式化的 locale SHALL 取自當前的 UI 語言**（見 `ui-localization`），SHALL NOT 沿用執行
環境的預設 locale。**時區與 locale 是兩件不同的事**：時區的正確來源是作業系統（它就是使用者
所在的位置），而格式的正確來源是介面的語言 —— 沿用執行環境的預設時，一個英文介面會在一台
非英文的機器上把重置時刻顯示成當地格式，而那是一個**沒有任何東西會回報的**不一致。

增刪行數在兩者皆為零時 SHALL NOT 呈現 —— 尚未改動任何東西時，一組零只是雜訊。

百分比 SHALL 以 agent 自己回報的 context window 大小為分母計算，SHALL NOT 由 spekterm 自行
維護「模型 → context window 大小」的對照表 —— 那樣的對照表會隨新模型過期，而它失效的樣子是
**一個看起來很正常的錯誤數字**。

agent 狀態缺席、過期或無法解析時（偏好未啟用、session 為 login shell、agent 未回報該欄位），
狀態列 SHALL 僅呈現第一手欄位，SHALL NOT 呈現錯誤訊息，亦 SHALL NOT 留下空白的欄位。
payload 中缺少的**個別欄位** SHALL 各自不呈現，SHALL NOT 使整條狀態列失效。

#### Scenario: agent 狀態可取得時呈現用量

- **WHEN** focused session 是啟用了狀態橋接的 claude session，且其 agent 已回報狀態
- **THEN** 狀態列呈現模型顯示名稱、推理強度與 context window 使用百分比
- **AND** agent 已回報用量上限時，一併呈現其使用比例與重置時刻

#### Scenario: 重置時刻的格式取自 UI 語言而非執行環境

- **WHEN** 執行環境的預設 locale 與當前 UI 語言不同，狀態列呈現一個重置時刻
- **THEN** 該時刻以 UI 語言的 locale 格式化
- **AND** 其所指的時刻仍為使用者當地時區的同一時刻

#### Scenario: 尚未改動任何行數時不呈現該欄位

- **WHEN** agent 回報的增行數與刪行數皆為零
- **THEN** 狀態列不呈現增刪行數

#### Scenario: 未啟用橋接時退回第一手欄位

- **WHEN** 狀態橋接的偏好未啟用
- **THEN** 狀態列呈現 repo、分支、工作目錄等第一手欄位
- **AND** 不呈現任何錯誤訊息或空白欄位

#### Scenario: payload 缺少個別欄位時只略過該欄位

- **WHEN** agent 回報的狀態中不含用量上限資訊
- **THEN** 狀態列不呈現該欄位
- **AND** 其餘欄位照常呈現
