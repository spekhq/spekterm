## ADDED Requirements

### Requirement: The side panel can be maximized over the main stage

The user SHALL be able to **maximize** the side panel: it then covers the main stage's session tab
strip and terminal area, and shows its current identity (OpenSpec or Files) at that size. The repo
header (with the identity switch), the activity bar, the rail and the status bar SHALL stay visible
and usable — the user can switch repos while the side panel is maximized, and the side panel keeps
following the side-panel source of the selected item (see `side-panel-source`).

The header SHALL offer an entry that maximizes the side panel and, while it is maximized, restores
it; the entry SHALL mark which of the two it will do. `Ctrl+Shift+M` SHALL do the same (see
`keyboard-navigation`).

**Maximizing covers the terminal; it SHALL NOT resize it.** The terminal area keeps its layout box
and its size while covered, so no pty receives a size change because of maximizing or restoring.
While covered, the terminal is hidden in the sense of `terminal-sessions` ("程式化繪製的渲染資源僅供
當下顯示的終端" — another presentation on top of the current session): it SHALL NOT take focus and
SHALL NOT hold a GPU renderer.

> Why cover instead of collapsing the terminal's column: a column narrowed to nothing reports that
> width to the pty, and an agent then writes its output for that width — output that stays in the
> terminal history after the column comes back. Covering leaves the size untouched.

**Maximizing SHALL NOT remount the side panel's content.** What the user was looking at — the open
file with its unsaved edits, undo history and cursor, the selected artifact and its scroll
position, the browse tree's expansion — SHALL be the same after maximizing and after restoring.

Rules:

- Maximizing while the side panel is collapsed SHALL first expand it, so restoring returns to an
  expanded side panel at its previous width.
- Triggering the collapse entry while maximized SHALL restore and collapse.
- Maximizing SHALL move focus into the side panel. Restoring SHALL return focus to the focused
  session's presentation — its terminal, or its conversation view's input when that view is shown,
  or its Wake button when it is dormant. While covered, neither the terminal nor the conversation
  view SHALL take focus.
- **The maximized state SHALL end when the user turns to a session**: selecting a session (a rail
  session row, including the one already focused; a lineage link; `Ctrl+Tab` / `Ctrl+Shift+Tab`
  outside the change view), creating one (the spawn entry, `Ctrl+T`, "open a session here",
  accepting an inbox item), or sending input to one from the side panel (the continuation entry).
  The maximized state SHALL NOT end because a session was created without the user asking at that
  moment (a handoff accepted on arrival), nor because a rail item (a repo row or the global row) was
  selected.
- The maximized state is not persisted; the application always starts restored.

#### Scenario: Maximizing covers the session tabs and the terminal

- **WHEN** the user triggers the maximize entry in the header
- **THEN** the side panel covers the area of the session tab strip and the terminal
- **AND** the header, the rail and the status bar are still visible

#### Scenario: Maximizing does not resize the terminal

- **WHEN** a session is running and the user maximizes, then restores the side panel
- **THEN** the session's pty receives no size change at either step

#### Scenario: The covered terminal does not receive keys

- **WHEN** the side panel is maximized and the user types
- **THEN** nothing typed reaches the focused session's pty

#### Scenario: Restoring returns to the same content

- **WHEN** the user has a file open in Files with an unsaved edit, maximizes, then restores
- **THEN** the same file is shown with the same unsaved edit, and the edit can still be undone

#### Scenario: Maximizing a collapsed side panel

- **WHEN** the side panel is collapsed and the user maximizes it, then restores it
- **THEN** after restoring, the side panel is expanded at the width it had before it was collapsed

#### Scenario: Collapsing while maximized

- **WHEN** the side panel is maximized and the user triggers the collapse entry
- **THEN** the side panel is no longer maximized and is collapsed

#### Scenario: Switching repos keeps the side panel maximized

- **WHEN** the side panel is maximized and the user selects another repo in the rail
- **THEN** the side panel stays maximized and shows that repo's side-panel source

#### Scenario: Selecting a session restores the side panel

- **WHEN** the side panel is maximized and the user selects a session row in the rail
- **THEN** the side panel is restored and that session is shown and focused

#### Scenario: Creating a session restores the side panel

- **WHEN** the side panel is maximized and the user creates a session with `Ctrl+T`
- **THEN** the side panel is restored and the new session is shown

#### Scenario: Selecting the already focused session restores the side panel

- **WHEN** the side panel is maximized and the user selects, in the rail, the session that is
  already the focused session
- **THEN** the side panel is restored and that session's terminal has focus

#### Scenario: A handoff arriving in the selected item does not restore the side panel

- **WHEN** the side panel is maximized and a handoff creates a session in the selected item
- **THEN** the side panel stays maximized

#### Scenario: Continuing from the change view restores the side panel

- **WHEN** the side panel is maximized on the This change view and the user triggers the
  continuation entry
- **THEN** the side panel is restored and the continuation is sent to the focused session

#### Scenario: Maximizing moves focus into the side panel

- **WHEN** focus is in the terminal and the user maximizes the side panel
- **THEN** focus is inside the side panel

#### Scenario: Restoring returns focus to the conversation view

- **WHEN** the focused claude session is shown in the conversation view, the side panel is
  maximized, and the user restores it
- **THEN** focus is in the conversation view's input

#### Scenario: The covered terminal releases its GPU renderer

- **WHEN** the GPU renderer is on, the focused terminal holds one, and the user maximizes the side
  panel
- **THEN** that terminal's renderer context is lost (its share is returned)
- **AND** after restoring, the terminal holds a renderer again

## MODIFIED Requirements

### Requirement: side panel 呈現 OpenSpec 與 Files 兩個同層互斥身分

主舞台的 repo header SHALL 提供切換 side panel 身分的入口。OpenSpec 與 Files 是 side panel 的兩個同層級、互斥的身分：任一時刻 SHALL 只顯示其中一個，且兩者 SHALL 與左側的主舞台其餘部分並存。

身分切換的行為以 `docs/workspace-mockup.html` 的 `#panel-switch` 為權威。

**While the side panel is maximized** (see "The side panel can be maximized over the main stage")
the identity covers the rest of the main stage instead of sitting beside it. The identity switch
stays in the header and works the same way; switching identity SHALL NOT end the maximized state.

#### Scenario: 切換至 Files 身分

- **WHEN** 使用者於 repo header 觸發 Files 身分的入口
- **THEN** side panel 呈現 Files 身分的內容，OpenSpec 身分的內容不再顯示

#### Scenario: 一次只顯示一個身分

- **WHEN** 檢視 side panel
- **THEN** OpenSpec 與 Files 之中恰有一個身分的內容被呈現

#### Scenario: 當前身分於入口上可辨識

- **WHEN** 使用者檢視身分切換的入口
- **THEN** 當前顯示的身分於該入口上被明確標示

#### Scenario: Switching identity while maximized

- **WHEN** the side panel is maximized showing OpenSpec and the user triggers the Files entry
- **THEN** the side panel stays maximized and shows Files
