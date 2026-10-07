## ADDED Requirements

### Requirement: Closing the window while sessions are running asks for confirmation

When the user closes the window (the title bar's close button, `Alt+F4`, or any other close the window
manager delivers) while at least one session of that window **holds a running process**, the main
process SHALL keep the window open and ask the user to confirm, in a native dialog, before anything
is ended. Closing the window ends every running process; nothing a session was running survives it.

- **What counts** is exactly the sessions holding a pty — folder sessions and global sessions alike.
  A dormant session (restored and not woken, or hibernated) and an exited session SHALL NOT count:
  closing loses nothing of theirs.
- The decision to hold the close SHALL be made synchronously in the close event from state the main
  process already holds. It SHALL NOT depend on a round trip to the renderer.
- The dialog SHALL state how many sessions are running and list them by their rail item and label
  (the session's name as the tab derives it, cut to a fixed length), at most 10, then a count of the rest. Sessions known to be **working** —
  an agent that is working or waiting on the user's choice, a shell whose process has a child process
  or has been replaced by another program — SHALL be marked as such and listed first. A session whose
  state is not known SHALL be listed without a mark, not as idle and not as working.
- The dialog SHALL say what closing loses and what it keeps: running commands and an agent's reply in
  progress are lost; claude sessions resume their conversation and shells restart in their last
  directory when woken.
- The dialog SHALL offer exactly two answers, closing and cancelling. **Cancelling SHALL be the
  default and the cancel answer** — pressing `Enter` or `Escape` in the dialog SHALL NOT end any
  session.
- Choosing to close SHALL close the window; its sessions end as they do on any close and are restored
  as dormant on the next launch (`session-persistence`).
- Choosing to cancel SHALL leave the window open and every session running, with the same process.

The dialog's text is user-visible copy and SHALL come from the dictionaries in the current UI
language (`ui-localization`).

**One question at a time.** While the dialog is waiting for an answer, a further close of the window
(a second click on the close button, `Alt+F4`, a termination signal) SHALL NOT show another dialog
and SHALL NOT close the window. The open dialog's answer decides alone. If the window no longer
exists when the answer arrives, the answer SHALL be ignored without an error.

**Acceptance gaps, settled by dogfood** (the automated carrier replaces the native dialog with a
stand-in that records what it was asked and answers from a file, and closes the window from the main
process the way the close button does): that the real close button and `Alt+F4` reach this path, and
that `Enter` / `Escape` in the real native dialog choose its default and cancel answers. It is also
not verified which way each desktop environment ends the application at logout — a termination
signal (which this requirement does not ask about) or a window close (which it would ask about).

#### Scenario: A second close while the dialog is open does not ask twice

- **WHEN** the dialog is open and the window is closed again before it is answered
- **THEN** exactly one dialog has been shown and the window is still open

#### Scenario: Closing with a running session asks first

- **WHEN** a shell session holds a running process and the user closes the window
- **THEN** the window stays open and a dialog asks for confirmation, stating one running session and
  listing it by its rail item and label

#### Scenario: Cancelling keeps every session running

- **WHEN** the user cancels that dialog
- **THEN** the window stays open and the session's process is the same process, still running

#### Scenario: Confirming closes the window and ends the sessions

- **WHEN** the user confirms that dialog
- **THEN** the application exits, no process of its sessions remains, and on the next launch the
  session is present as dormant

#### Scenario: The safe answer is the default

- **WHEN** the dialog is shown
- **THEN** its default answer and its cancel answer are both "cancel"

#### Scenario: Only dormant sessions close without asking

- **WHEN** every session of the window is dormant and nothing is unsaved, and the user closes the
  window
- **THEN** the window closes without any dialog

#### Scenario: A global session counts

- **WHEN** the only running session belongs to the global item and the user closes the window
- **THEN** the dialog is shown and lists that session under the global item's name

#### Scenario: A working session is marked and listed first

- **WHEN** one shell is idle and another shell runs a command (`sleep`), and the user closes the window
- **THEN** the dialog lists the shell running the command first, marked as working, and the idle shell
  without that mark

#### Scenario: A working agent is marked

- **WHEN** a claude session's agent is working and the user closes the window
- **THEN** the dialog lists that session marked as working

### Requirement: A quit that does not start with closing the window does not ask about sessions

When the application is asked to quit by something other than the user closing the window — a
termination signal (`SIGTERM`, as sent by the session manager at logout or shutdown, or by `kill`) —
the confirmation about running sessions SHALL NOT be shown and SHALL NOT hold the quit. Nobody may
be there to answer it, and a held quit ends in a forced kill that skips the application's own
cleanup and its last persistence write.

The confirmation of unsaved changes is unchanged on this path (see "視窗關閉前確認未存的變更").

The one exception is a signal that arrives while the user is already answering the dialog (the close
came first): the open question is not withdrawn behind the user's back, and that signal does not end
the application by itself. Answering close ends it; answering cancel keeps it running and the signal
is dropped. Either way, a later close of the window SHALL ask again as described in "Closing the
window while sessions are running asks for confirmation" — the dropped signal leaves nothing behind
that would skip the question (see "One question at a time").

#### Scenario: A signal during the open dialog does not disable the question

- **WHEN** the dialog is open, the application receives `SIGTERM`, the user cancels, and later closes
  the window again while a session is still running
- **THEN** the application is still running after the cancel, and the second close asks again

#### Scenario: A termination signal quits with sessions running

- **WHEN** a shell session holds a running process, nothing is unsaved, and the application receives
  `SIGTERM`
- **THEN** no dialog is shown, the application exits by itself, and no process of its sessions
  remains

## MODIFIED Requirements

### Requirement: 視窗關閉前確認未存的變更

視窗關閉時，若存在任何未存的變更，主行程 SHALL 阻止關閉並要求使用者明確選擇：儲存全部、不儲存並關閉、或取消。未存的變更 SHALL NOT 因視窗關閉而被靜默捨棄。

此判斷 SHALL 於關閉事件中同步完成，SHALL NOT 依賴一次向 renderer 的往返查詢 —— renderer 若未能回應，等同於靜默捨棄，而那正是本 requirement 要防止的。

確認 SHALL 以作業系統的原生對話框呈現。其內容包含使用者 repo 中的檔案路徑，且此刻 renderer 正處於即將關閉的狀態。

**Unsaved changes and running sessions are confirmed in one dialog.** When the user closes the window
while there are unsaved changes **and** running sessions (see "Closing the window while sessions are
running asks for confirmation"), exactly one dialog SHALL be shown. It SHALL list the unsaved files
and the running sessions with what closing loses, and offer saving all and closing, closing without
saving, and cancelling — with **cancelling as the default**, since either other answer ends the
sessions. Saving all that fails or times out SHALL ask again, as before. When no session is running,
this dialog is unchanged.

#### Scenario: 有未存變更時阻止關閉

- **WHEN** 存在至少一個有未存變更的檔案，使用者關閉視窗
- **THEN** 視窗不關閉，並呈現要求選擇處置方式的原生對話框

#### Scenario: 選擇取消

- **WHEN** 使用者於該對話框中選擇取消
- **THEN** 視窗保持開啟，未存的變更仍在

#### Scenario: 選擇不儲存並關閉

- **WHEN** 使用者於該對話框中選擇不儲存並關閉
- **THEN** 視窗關閉，磁碟上的檔案不被修改

#### Scenario: 沒有未存變更時直接關閉

- **WHEN** 不存在任何未存的變更，且沒有任何 session 持有執行中的行程，使用者關閉視窗
- **THEN** 視窗直接關閉，不呈現任何對話框

#### Scenario: Unsaved changes and running sessions share one dialog

- **WHEN** a file has unsaved changes, a shell session holds a running process, and the user closes
  the window
- **THEN** exactly one dialog is shown; it lists the file and the session, and its default answer is
  cancelling

#### Scenario: Cancelling the shared dialog keeps both

- **WHEN** the user cancels that dialog
- **THEN** the window stays open, the unsaved changes are still there, and the session's process is
  still running
