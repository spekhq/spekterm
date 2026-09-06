## MODIFIED Requirements

### Requirement: 重建的 session 為休眠態，於首次被顯示時才啟動 pty

重建出來的 session SHALL 處於**休眠**狀態 —— 具備完整身分（名字、順序）但**沒有 pty**。
休眠的 session SHALL 於**首次被顯示**時才啟動其 pty。

於是開啟應用程式時 SHALL **至多一個** session 被啟動 —— 即被選中之 rail 項目的 focused session；
SHALL NOT 一次啟動所有 session。**選中的 rail 項目不被持久化，且冷啟動時 SHALL NOT 有任何項目
被預設選中**（含 `global-session` 的全域項目 —— 它恆常存在，因此「預設選中它」是極其自然的實作，
而那會使冷啟動立刻喚醒一個 session，本條的保證即失效）。使用者選一個項目之後，該項目的 focused
session 才醒過來。

休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為一個空白的畫面 —— **無論當下是哪一種 view**。
終端 view 之下是一個空白的終端，對話 view 之下是一份空白的對話，兩者是同一個錯誤的兩種長相：
**它與「這個 session 真的還沒講話」無法區分**，而兩者的正確處置不同。

未被喚醒的休眠 session SHALL 維持持久化 —— 使用者一路未喚醒它便再次關閉應用程式時，它 SHALL 於
下次開啟時仍然存在。

#### Scenario: 開啟應用程式至多啟動一個 session

- **WHEN** 使用者關閉應用程式時有多個 session，重新開啟應用程式並選中其中一個 rail 項目
- **THEN** 只有該項目的 focused session 啟動了 pty，其餘 session 皆為休眠且無 pty

#### Scenario: 冷啟動不因全域項目恆存而喚醒 session

- **WHEN** 使用者關閉應用程式時全域項目有數個 session，重新開啟應用程式但尚未選中任何 rail 項目
- **THEN** 沒有任何 session 啟動 pty，全域項目的 session 皆為休眠

#### Scenario: 顯示一個休眠的 session 使其啟動

- **WHEN** 使用者切換到一個休眠 session 所在的 rail 項目並使其成為顯示中的 session
- **THEN** 該 session 啟動其 pty

#### Scenario: 休眠的 session 不呈現為空白終端

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session
- **THEN** 該 session 明確地呈現其休眠狀態，而非一個沒有內容的終端

#### Scenario: 休眠的 session 於對話 view 不呈現為空白對話

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session，且其當前 view 為對話
- **THEN** 該 session 明確地呈現其休眠狀態，而非一份沒有內容的對話

#### Scenario: 未喚醒的休眠 session 於再次重啟後仍存在

- **WHEN** 使用者重新開啟應用程式、未喚醒某個休眠 session、再次關閉並重新開啟應用程式
- **THEN** 該 session 仍然存在且仍為休眠
