## MODIFIED Requirements

### Requirement: session 跨應用程式重啟與 renderer 重新載入存活

重建一個 session 所需的**事實** SHALL 被持久化，並於下次開啟應用程式時重建：所屬 folder、
spawn 目標、使用者取的名字、分頁順序、錨定的 change、**側欄來源**（見 `side-panel-source`），
以及 **pty 最近一次宣告的終端標題**。renderer 重新載入時 SHALL 同樣重建。

持久化的內容 SHALL 限於重建所必需的事實，SHALL NOT 包含**可由當下環境廉價重算**的衍生狀態
（例如 folder 是否含 `openspec/`、git 分支 —— 那些每次載入都重算，存下來只是持久化謊言）。

pty 宣告的標題屬於「必需」而非「衍生」：**休眠的 session 沒有 pty 可以再宣告一次**，不存它，重開後
那些分頁就全部退回流水號標籤，而它們正是被 agent 依任務命名的那些 —— 使用者認不出哪個是哪個。
它一經喚醒即被 pty 的下一次宣告覆蓋。

**側欄來源**指向的 folder 於重建時可能已不在 workspace（使用者重開前移除了它）—— 此時該 session
的側欄來源 SHALL 退回其所屬 folder，SHALL NOT 使 session 重建失敗。持久化的座標不保證重開後仍然
有效，這與「folder 路徑失效 → 喚醒錯誤」是同一種防禦姿態。

重建 SHALL NOT 使既有的 pty 生命週期鬆動 —— 重建產生的是**新的** pty；`terminal-sessions` 的
「關閉分頁／重新載入／關閉視窗三路徑皆不留孤兒行程」不受影響。

#### Scenario: 關閉並重新開啟應用程式後 session 回來

- **WHEN** 使用者建立若干 session、為其中之一命名、調整順序，然後關閉並重新開啟應用程式
- **THEN** 這些 session 以相同的名字與順序重新出現於其所屬的 folder

#### Scenario: 錨定的 change 一併回來

- **WHEN** 一個錨定了某個 change 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後仍錨定同一個 change

#### Scenario: 側欄來源一併回來

- **WHEN** 一個側欄來源指向另一個 repo 的 session，經歷應用程式關閉並重新開啟
- **THEN** 該 session 重建後其側欄仍指向同一個 repo

#### Scenario: 側欄來源指向的 folder 已被移除

- **WHEN** 一個側欄來源指向 repoB 的 session，於重開前 repoB 已從 workspace 移除
- **THEN** 該 session 重建成功，其側欄來源退回自己所屬的 folder

#### Scenario: renderer 重新載入後 session 回來

- **WHEN** renderer 重新載入
- **THEN** 先前的 session 以相同的名字與順序重建，且先前的 pty 皆已終止
