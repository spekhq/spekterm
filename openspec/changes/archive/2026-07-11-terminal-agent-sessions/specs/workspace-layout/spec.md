## ADDED Requirements

### Requirement: 主舞台為當前 repo 呈現 session 分頁列

主舞台 SHALL 在 repo header 與 terminal／side panel 版面之間，為**當前選中的 repo** 呈現其 session 的分頁列。此分頁列 SHALL 標示當前 focused 的 session、SHALL 提供在 session 之間切換的方式、SHALL 提供建立新 session 的入口（該入口 SHALL 讓使用者選擇 spawn 目標），且每個分頁 SHALL 可關閉。

當前 repo 尚無任何 session 時，該區域 SHALL 呈現空狀態，並提供明顯的建立 session 入口。

分頁列僅呈現當前選中 repo 的 session —— 主舞台只屬於當前選中的 repo。

#### Scenario: 呈現當前 repo 的多個 session

- **WHEN** 當前選中的 repo 有多個 session
- **THEN** 分頁列為每個 session 呈現一項，且當前 focused 的 session 被標示

#### Scenario: 切換 focused session

- **WHEN** 使用者於分頁列點選另一個 session
- **THEN** focused session 切換為該 session，終端顯示其內容

#### Scenario: 建立新 session 可選 spawn 目標

- **WHEN** 使用者觸發建立新 session 的入口
- **THEN** 使用者可選擇 spawn 目標為 `claude` 或 login shell

#### Scenario: 關閉分頁

- **WHEN** 使用者關閉分頁列中的一個 session
- **THEN** 該 session 自分頁列移除

#### Scenario: 當前 repo 無 session

- **WHEN** 當前選中的 repo 沒有任何 session
- **THEN** 該區域呈現空狀態與建立 session 的入口

### Requirement: rail 於每個 folder 之下呈現其 session 子列

workspace rail 的每個 folder 列之下 SHALL 呈現該 folder 的 session 子列，反映該 folder 的所有 session（不限於當前選中的 repo）。子列 SHALL 可被點選以聚焦該 session，點選時 SHALL 選中其所屬的 folder 並將該 session 設為 focused。folder 的 session 子列 SHALL 可展開與收合。

#### Scenario: folder 之下呈現其 session

- **WHEN** 一個 folder 有一或多個 session
- **THEN** 其列之下呈現對應的 session 子列

#### Scenario: 自 rail 聚焦 session

- **WHEN** 使用者點選一個 folder 的某個 session 子列
- **THEN** 該 folder 被選中，且該 session 成為其 focused session

#### Scenario: 收合與展開 session 子列

- **WHEN** 使用者收合一個 folder，其後再展開
- **THEN** 收合時其 session 子列隱藏，展開時還原呈現
