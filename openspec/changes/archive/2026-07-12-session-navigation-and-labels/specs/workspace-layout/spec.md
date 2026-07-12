# workspace-layout Specification（delta）

## ADDED Requirements

### Requirement: 切換當前 repo 時，focused session 落在該 repo 最後聚焦過的 session

系統 SHALL 為每個 folder 記住它**最後聚焦過**的 session。切換當前選中的 repo 時，focused session SHALL 落在該 repo 最後聚焦過的那一個。

此行為 SHALL NOT 取決於切換的手段 —— 以滑鼠點選 rail 上的 folder，與以鍵盤切換 repo，兩者的落點 SHALL 相同。否則同一個動作會有兩種行為。

該 repo 最後聚焦的 session **已被關閉**時，focused session SHALL 落在該 repo 分頁列上的第一個 session；該 repo 沒有任何 session 時，SHALL 呈現空狀態。

此記憶為 session 的執行期狀態，SHALL NOT 持久化 —— session 本身即不跨重啟存活。

> **「該 repo 從未聚焦過任何 session」不列為 scenario** —— 它在 UI 上構造不出來：**建立 session 的同時就會聚焦它**。實作中的那條退路（找不到記錄就取第一個）是防禦性的，不是可觀察的行為。為一個不可達的狀態寫一條永遠不會失敗的驗收，是假覆蓋。

#### Scenario: 切走再切回，回到離開時的 session

- **WHEN** 使用者於 repo A 聚焦其第二個 session，切換至 repo B，再切回 repo A
- **THEN** repo A 的 focused session 為其第二個 session（而非第一個）

#### Scenario: 滑鼠與鍵盤的落點相同

- **WHEN** 使用者於 repo A 聚焦其第二個 session，切至 repo B，再分別以點選 rail 與以鍵盤切回 repo A
- **THEN** 兩種手段皆使 repo A 的 focused session 為其第二個 session

#### Scenario: 最後聚焦的 session 已被關閉

- **WHEN** 使用者切換至一個 repo，而它最後聚焦過的 session 已被關閉
- **THEN** focused session 為該 repo 分頁列上的第一個 session
