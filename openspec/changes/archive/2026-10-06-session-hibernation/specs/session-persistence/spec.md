## REMOVED Requirements

### Requirement: 重建的 session 為休眠態，於首次被顯示時才啟動 pty

**Reason**: Wake-on-display is replaced by explicit wake. Two of its scenarios ("開啟應用程式至多啟動一個
session", "顯示一個休眠的 session 使其啟動") assert the behavior this change removes, and a MODIFIED block
cannot drop them.
**Migration**: Replaced by "Restored sessions are dormant and start only on an explicit wake" below, which
carries over every clause and scenario that still holds.

## ADDED Requirements

### Requirement: Restored sessions are dormant and start only on an explicit wake

重建出來的 session SHALL 處於**休眠**狀態 —— 具備完整身分（名字、順序）但**沒有 pty**。

**A dormant session SHALL start its pty only when the user explicitly wakes it.** Displaying it — selecting
its rail item, switching to it with the keyboard, clicking its tab — SHALL NOT start it. This holds for every
dormant session, whether it was restored or hibernated (see `session-hibernation`).

The dormant screen SHALL offer a wake action in both the terminal view and the conversation view. When a
dormant session becomes the displayed session and nothing covers it, the wake action SHALL receive focus —
where a running session's input would — so that pressing `Enter` wakes it, in either view. Once it is running,
focus SHALL move to its input, so that typing reaches it.

**Opening the application therefore starts no session at all**, and neither does selecting a rail item.
**選中的 rail 項目不被持久化，且冷啟動時 SHALL NOT 有任何項目被預設選中**（含 `global-session` 的
全域項目）—— that rule predates explicit wake and still holds; it keeps "what is selected" from depending on
the previous run.

**Why explicit wake rather than wake-on-display**: a session kept for occasional use would otherwise be started
by any keyboard pass over it (`Ctrl+Tab`, `Ctrl+↓`), defeating hibernation as a way to save resources.

休眠狀態 SHALL 被明確地呈現，SHALL NOT 呈現為一個空白的畫面 —— **無論當下是哪一種 view**。
終端 view 之下是一個空白的終端，對話 view 之下是一份空白的對話，兩者是同一個錯誤的兩種長相：
**它與「這個 session 真的還沒講話」無法區分**，而兩者的正確處置不同。

未被喚醒的休眠 session SHALL 維持持久化 —— 使用者一路未喚醒它便再次關閉應用程式時，它 SHALL 於
下次開啟時仍然存在。

#### Scenario: Opening the application starts no session

- **WHEN** 使用者關閉應用程式時有多個 session，重新開啟應用程式並選中其中一個 rail 項目
- **THEN** no session has started a pty; every session is dormant

#### Scenario: 冷啟動不因全域項目恆存而喚醒 session

- **WHEN** 使用者關閉應用程式時全域項目有數個 session，重新開啟應用程式但尚未選中任何 rail 項目
- **THEN** 沒有任何 session 啟動 pty，全域項目的 session 皆為休眠

#### Scenario: Displaying a dormant session does not start it

- **WHEN** the user switches to a dormant session, by selecting its rail item or by keyboard
- **THEN** it is displayed as dormant and has no pty

#### Scenario: The wake action starts a dormant session

- **WHEN** the user triggers the wake action of a displayed dormant session
- **THEN** that session starts its pty

#### Scenario: Enter wakes the displayed dormant session

- **WHEN** a dormant session becomes displayed by keyboard and the user presses `Enter`
- **THEN** that session starts its pty

#### Scenario: Typing after a keyboard wake reaches the session

- **WHEN** a dormant session becomes displayed by keyboard, the user presses `Enter`, and then types a command
  and presses `Enter` again
- **THEN** the command runs in that session

#### Scenario: 休眠的 session 不呈現為空白終端

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session
- **THEN** 該 session 明確地呈現其休眠狀態，而非一個沒有內容的終端

#### Scenario: 休眠的 session 於對話 view 不呈現為空白對話

- **WHEN** 使用者檢視一個尚未被喚醒的休眠 session，且其當前 view 為對話
- **THEN** 該 session 明確地呈現其休眠狀態，而非一份沒有內容的對話
- **AND** the wake action is offered there as well

#### Scenario: 未喚醒的休眠 session 於再次重啟後仍存在

- **WHEN** 使用者重新開啟應用程式、未喚醒某個休眠 session、再次關閉並重新開啟應用程式
- **THEN** 該 session 仍然存在且仍為休眠

## MODIFIED Requirements

### Requirement: 喚醒的 session 其 pty 自誕生起即採用終端當下的尺寸

休眠的 session 被喚醒時，其 pty SHALL 自誕生起就採用該終端**當下**的欄列數，SHALL NOT 停留在
spawn 時的預設尺寸直到下一次尺寸變化為止。

**喚醒倒轉了「pty 先誕生、終端後掛載」的順序**：休眠 session 的終端在 pty 存在**之前**就已經量測
過尺寸了，那次同步因此落空（沒有 pty 可以接收）；而依「尺寸有沒有變化」來決定是否同步的機制，
其後不會再送出第二次。若不另行處理，pty 將**永遠**停在 spawn 時的預設尺寸 —— pty 內的程式以錯誤
的寬度排版，畫面看起來縮成一小塊，直到使用者手動改變視窗大小為止。

#### Scenario: 喚醒後 pty 的尺寸與終端一致

- **WHEN** the user wakes a displayed dormant session, so that it starts its pty
- **THEN** 該 pty 的欄列數與終端當下的可用尺寸相符，而非 spawn 時的預設尺寸
