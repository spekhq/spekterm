## ADDED Requirements

### Requirement: The change view's artifact content can be scrolled from the keyboard

The content area showing the active artifact in the **this change** view SHALL be able to hold
focus, and while it holds focus the standard scrolling keys (arrow keys, `PageUp` / `PageDown`,
`Home` / `End`, `Space`) SHALL scroll it.

Clicking inside the content SHALL give it focus. **Choosing an artifact** — clicking its tab, or
switching with the keyboard (see "`Ctrl+Tab` switches artifacts while focus is in the change view")
— SHALL move focus to the content area, so the next scrolling key scrolls the artifact just chosen.
Choosing a different artifact SHALL show it from its top, not at the previous artifact's scroll
offset; choosing the artifact already shown SHALL NOT change its scroll position.

While the same change's data is refreshed (for example its files are updated while an agent works),
the view SHALL NOT move focus and SHALL NOT change the scroll position.

#### Scenario: Clicking the content lets the keyboard scroll it

- **WHEN** the active artifact is taller than the content area, the user clicks inside the content
  and presses `PageDown`
- **THEN** the content scrolls down
- **AND** pressing `End` scrolls it to the bottom

#### Scenario: Choosing an artifact lets the keyboard scroll it right away

- **WHEN** the user clicks the tab of an artifact taller than the content area and then presses
  `ArrowDown`
- **THEN** that artifact's content scrolls down

#### Scenario: A newly chosen artifact starts at the top

- **WHEN** the user has scrolled one artifact down and then chooses another artifact
- **THEN** the other artifact is shown from its top

#### Scenario: An update to the change does not move the reader

- **WHEN** the user has scrolled an artifact down and the change's tasks file is modified on disk
- **THEN** after the view shows the new task progress, the scroll position and the focus are unchanged

### Requirement: `Ctrl+Tab` switches artifacts while focus is in the change view

While focus is anywhere inside the **this change** view, `Ctrl+Tab` SHALL select the next
artifact tab and `Ctrl+Shift+Tab` the previous one, in tab-strip order, wrapping at both ends.
Selecting this way is choosing an artifact (focus and scroll as in "The change view's artifact
content can be scrolled from the keyboard"), and the selected tab SHALL be scrolled into view in the
tab strip.

These keys SHALL NOT also switch the focused session (see `keyboard-navigation`). While a dialog or
a menu is open they SHALL do nothing, as for every other shortcut.

#### Scenario: Ctrl+Tab selects the next artifact

- **WHEN** focus is in the change view on the proposal's content and the user presses `Ctrl+Tab`
- **THEN** the artifact after proposal in the tab strip is selected
- **AND** focus is on that artifact's content

#### Scenario: Ctrl+Shift+Tab wraps to the last artifact

- **WHEN** the first artifact is selected, focus is in the change view, the tab strip is too narrow
  to show every tab, and the user presses `Ctrl+Shift+Tab`
- **THEN** the last artifact in the tab strip is selected
- **AND** its tab is visible in the tab strip

#### Scenario: An open overlay blocks artifact switching

- **WHEN** focus is in the change view, the Graph overlay is open, and the user presses `Ctrl+Tab`
- **THEN** the selected artifact does not change
