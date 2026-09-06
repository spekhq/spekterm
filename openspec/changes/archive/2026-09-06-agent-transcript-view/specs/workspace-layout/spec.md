## MODIFIED Requirements

### Requirement: 主舞台為當前 repo 呈現 session 分頁列

主舞台 SHALL 在 repo header 與 terminal／side panel 版面之間，為**當前選中的 repo** 呈現其 session 的分頁列。此分頁列 SHALL 標示當前 focused 的 session、SHALL 提供在 session 之間切換的方式、SHALL 提供建立新 session 的入口（該入口 SHALL 讓使用者選擇 spawn 目標），且每個分頁 SHALL 可關閉。

每個分頁 SHALL 提供右鍵選單，其中 SHALL 至少包含**重新命名**與**關閉**。

建立新 session 的入口 SHALL 緊鄰最後一個分頁之後，SHALL NOT 被推離分頁而置於分頁列的另一端 —— 它是分頁的延伸，使用者剛看完分頁就會伸手去點它。

當前 repo 尚無任何 session 時，該區域 SHALL 呈現空狀態，並提供明顯的建立 session 入口。

分頁列僅呈現當前選中 repo 的 session —— 主舞台只屬於當前選中的 repo。

一個 session **可能有一種以上的呈現方式**（見 `agent-conversation-view`）。分頁列 SHALL 為每個
session 呈現**單一一項**，SHALL NOT 因 view 的種類而分裂為多項 —— view 是同一個 session 的兩種
呈現，不是兩個 session。

#### Scenario: 呈現當前 repo 的多個 session

- **WHEN** 當前選中的 repo 有多個 session
- **THEN** 分頁列為每個 session 呈現一項，且當前 focused 的 session 被標示

#### Scenario: 切換 focused session

- **WHEN** 使用者於分頁列點選另一個 session
- **THEN** focused session 切換為該 session，該 session 的當前 view 顯示其內容

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
