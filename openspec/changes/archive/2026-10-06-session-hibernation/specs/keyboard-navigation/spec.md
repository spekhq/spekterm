## ADDED Requirements

### Requirement: Hibernate the current session from the keyboard

The system SHALL provide the shortcut `Ctrl+Shift+H` to hibernate the focused session of the selected rail
item (see `session-hibernation`). **The scope includes the global item** (see `global-session`).

It SHALL be a no-op, and SHALL NOT produce an error, when no rail item is selected, when the item has no
session, or when the focused session is dormant or exited.

**Why `Ctrl+Shift+H`**: a `Ctrl+Shift+<letter>` chord cannot be encoded in the terminal protocol, so the pty
loses nothing (the same reasoning as `Ctrl+Shift+W`).

It is intercepted at the window's capture phase like the other shortcuts, and the intercepted key SHALL NOT
reach the pty. It SHALL NOT take effect while a dialog or menu is open (the existing `[role="dialog"]` /
`[role="menu"]` rule).

#### Scenario: Ctrl+Shift+H hibernates the current session

- **WHEN** the terminal has focus, the focused session is running, and the user presses `Ctrl+Shift+H`
- **THEN** that session is hibernated, and the key does not reach the pty

#### Scenario: Hibernating a global session

- **WHEN** the global item is selected, its focused session is running, and the user presses `Ctrl+Shift+H`
- **THEN** that global session is hibernated

#### Scenario: No-op without a running session

- **WHEN** no rail item is selected, or the item has no session, or its focused session is dormant or
  exited, and the user presses `Ctrl+Shift+H`
- **THEN** nothing is hibernated and the application produces no error

#### Scenario: Suppressed while a dialog is open

- **WHEN** a dialog is open — the session-rename dialog, a Files dialog, or the Settings dialog — and the user
  presses `Ctrl+Shift+H`
- **THEN** no session is hibernated

## MODIFIED Requirements

### Requirement: 編輯器持有焦點時快捷鍵仍生效

**導航**快捷鍵 SHALL 在 side panel 的編輯器持有焦點時仍然生效。編輯器會吃掉按鍵 —— 既有的存檔快捷鍵正是必須註冊於編輯器內部才攔得到，外層的監聽攔不到它。

**排序快捷鍵不在此列** —— 它們於可編輯文字持有焦點時 SHALL NOT 生效（見「排序快捷鍵於可編輯文字持有焦點時不生效」）。`Shift+arrow` 就是文字選取鍵，攔下它會使編輯器裡的選取整個消失；而 `Ctrl+Tab` 在編輯器裡沒有這種代價。**兩組快捷鍵在這一點上的行為是不同的，此處與該例外必須各自寫明它作用於哪一組**，否則規格自相矛盾。

**side panel 的檔案快速開啟入口（見 `quick-open`）於編輯器持有焦點時亦 SHALL 生效** —— 編輯器
位於 side panel 之內，而該能力的作用域正是「焦點在 side panel 之內」。此處列出的三組快捷鍵
**不是**一份窮舉的對照表可以推論的：導航與 quick open 在編輯器裡都生效但理由不同（前者是本能力
刻意的要求，後者是其作用域的推論），而排序讓路。**新增任何一組快捷鍵時，都必須回到此處寫明它
落在哪一邊。**

**The OpenSpec change view is a fourth case, and the editor is not in it.** With focus inside the
change view, `Ctrl+Tab` / `Ctrl+Shift+Tab` switch the change's artifacts (see `openspec-panel`); the
editor belongs to the Files identity, so with focus in the editor they keep switching sessions as
above.

**`Ctrl+Shift+H` (hibernate the current session) is on the navigation side**: it SHALL take effect with focus
in the editor. It is a session command, like `Ctrl+Shift+W`, not a text-editing key, so it has none of the
reordering shortcuts' cost.

#### Scenario: 編輯器持有焦點時切換 session

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

#### Scenario: 編輯器持有焦點時排序快捷鍵讓路

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Shift+→`
- **THEN** 編輯器選取了一個字元，且未觸發任何排序

#### Scenario: Ctrl+Shift+H takes effect with focus in the editor

- **WHEN** focus is in the side panel's editor, the focused session is running, and the user presses
  `Ctrl+Shift+H`
- **THEN** that session is hibernated
