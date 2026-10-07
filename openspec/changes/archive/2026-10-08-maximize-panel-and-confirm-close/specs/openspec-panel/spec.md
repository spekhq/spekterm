## ADDED Requirements

### Requirement: Graph and Timeline are views of the maximized side panel

The OpenSpec identity SHALL offer **Graph** (the structure of specs and changes) and **Timeline**
(the lifecycle of changes on a time axis) as views next to **This change** and **Browse**. They
SHALL only be shown while the side panel is maximized (see `workspace-layout`, "The side panel can
be maximized over the main stage"):

- Choosing Graph or Timeline while the side panel is not maximized SHALL maximize it and show that
  view. They SHALL be available whether or not the repo has a resolvable anchored change.
- Restoring the side panel while Graph or Timeline is shown SHALL return the OpenSpec identity to
  the This change or Browse view that was shown before Graph or Timeline was first chosen, **as it
  was** — the same artifact and scroll position, the same browse tree or spec. Switching between
  Graph and Timeline does not change which view that is.
- Choosing This change or Browse while Graph or Timeline is shown SHALL show that view; the side
  panel stays maximized.
- Triggering a change in Graph or Timeline SHALL show that change in the **This change** view,
  anchored as in "於瀏覽視圖選擇 change 即錨定至當前的側欄座標", and the side panel SHALL stay
  maximized. Triggering a spec in Graph SHALL show that spec in the Browse view, likewise still
  maximized.
- **Graph or Timeline stays shown when the side-panel source changes** (another repo selected while
  maximized) — it then shows the new source's data — **and when the user switches to Files and back
  to OpenSpec** while maximized. **Cross navigation is the exception**: when the user asks to see a
  particular change or spec in OpenSpec (see "OpenSpec 與 Files 兩個身分之間可交叉導覽"), that target
  SHALL be shown, not Graph or Timeline.
- Whenever the side panel stops being maximized, by whatever path, Graph and Timeline SHALL NOT be
  shown again by the next maximize unless chosen again.

**Why not in the narrow side panel**: Timeline's minimum usable width (label column plus chart
area) is above 900px, far beyond the side panel's normal width. Maximized, the side panel spans the
main stage; on a window too narrow for that, the view scrolls horizontally.

Graph and Timeline are **two different visualizations**: Graph shows spec ↔ change relations (no
time), Timeline shows the change lifecycle (on a time axis). Neither SHALL stand in for the other.

They are not dialogs: while they are shown, shortcuts work as they do in the rest of the side
panel (see `keyboard-navigation`).

#### Scenario: Choosing Graph maximizes the side panel

- **WHEN** the side panel is not maximized and the user chooses the Graph view
- **THEN** the side panel is maximized and shows Graph with the nodes and edges of specs and changes

#### Scenario: Choosing Timeline

- **WHEN** the user chooses the Timeline view
- **THEN** the side panel is maximized and shows the changes' lifecycles as bars on a time axis

#### Scenario: A change chosen in Graph opens in the maximized side panel

- **WHEN** Graph is shown and the user triggers a change node
- **THEN** the This change view shows that change and the side panel is still maximized

#### Scenario: Restoring leaves Graph

- **WHEN** the Browse view was shown, the user chose Graph, and then restores the side panel
- **THEN** the side panel is restored and shows the Browse view

#### Scenario: Navigation shortcuts work while Graph is shown

- **WHEN** Graph is shown and the user presses `Ctrl+↓`
- **THEN** the next rail item is selected
- **AND** Graph is still shown, now for that item's side-panel source

#### Scenario: View in OpenSpec while Graph was shown

- **WHEN** Graph is shown, the user switches to Files and triggers View in OpenSpec for a change's
  artifact
- **THEN** the This change view shows that change, not Graph

#### Scenario: Graph without a resolvable anchored change

- **WHEN** the side-panel source has several active changes and none is anchored, and the user
  chooses Graph
- **THEN** Graph is shown with its nodes and edges

#### Scenario: Restoring returns to the change as it was

- **WHEN** the This change view shows the design artifact scrolled down, the user chooses Graph,
  then Timeline, then restores the side panel
- **THEN** the This change view shows the design artifact at the same scroll position

## MODIFIED Requirements

### Requirement: OpenSpec 身分呈現「本 change」與「瀏覽」兩個視圖

side panel 的 OpenSpec 身分 SHALL 於其內部提供**瀏覽**視圖，並 SHALL 在存在可解析的錨定 change
時額外提供**本 change** 視圖。呈現中的視圖 SHALL 恰有一個，且當前視圖 SHALL 於切換入口上被明確
標示。

**沒有可解析的錨定 change 時，本 change 視圖與其切換入口 SHALL 一併不呈現**，OpenSpec 身分 SHALL
停在瀏覽視圖。一個永遠只能顯示「你還沒有選 change」的視圖，佔著一個入口卻沒有內容 —— 選 change
的地方本來就在瀏覽視圖裡（見「於瀏覽視圖選擇 change 即錨定至當前的側欄座標」）。

**可解析的錨定 change 於本規格中的定義**見「本 change 視圖呈現當前側欄座標所錨定的 change」：
明確的錨定或衍生預設，且該 change 存在於側欄來源 repo 的掃描結果之中。

兩個視圖於介面上的標籤為 **This change** 與 **Browse**（UI 的文案為英文，見 `ui-localization`）。
本規格以中文稱呼它們是概念上的指涉；scenario 中以英文標籤指名，指的是使用者實際看到的那個入口。

此切換為 OpenSpec 身分**內部**的第二層導航，與 side panel 的身分切換（`[◈ OpenSpec │ ▤ Files]`）
是不同層級。

視圖採**換頁而非並列**，理由與 Files 身分相同：side panel 的寬度不足以並列多個視圖。

The same view switch also offers **Graph** and **Timeline**, which are only shown while the side
panel is maximized (see "Graph and Timeline are views of the maximized side panel"). "Exactly one
view is shown" counts them too.

#### Scenario: 切換至瀏覽視圖

- **WHEN** 使用者於 OpenSpec 身分中觸發 **Browse** 視圖的入口
- **THEN** side panel 呈現瀏覽視圖，本 change 視圖的內容不再顯示，且 **Browse** 於入口上被標示為當前視圖

#### Scenario: 一次只顯示一個視圖

- **WHEN** 檢視 OpenSpec 身分的內容
- **THEN** 呈現中的視圖恰有一個

#### Scenario: 沒有可解析的 change 時不呈現本 change 的入口

- **WHEN** 側欄來源 repo 沒有可解析的錨定 change（無明確錨定且衍生預設不成立）
- **THEN** **This change** 的切換入口不呈現，OpenSpec 身分呈現瀏覽視圖

#### Scenario: 錨定之後本 change 的入口出現

- **WHEN** 於前述狀態下，使用者在瀏覽視圖的 Changes 樹選取一個 change
- **THEN** **This change** 的切換入口出現，且該視圖成為當前視圖並呈現該 change

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

- **WHEN** focus is in the change view, the inbox's full-window overlay is open, and the user presses
  `Ctrl+Tab`
- **THEN** the selected artifact does not change

## REMOVED Requirements

### Requirement: Graph 與 Timeline 於全視窗 overlay 中呈現

**Reason**: Graph and Timeline move into the maximized side panel ("Graph and Timeline are views of
the maximized side panel"). The overlay's reason for existing — Timeline does not fit the side
panel — is answered by maximizing, and keeping both would give the same content two presentations.
Choosing a change in the overlay closed it and dropped the user back into the narrow side panel;
in the maximized side panel the change opens at full size.

**Migration**: The Graph and Timeline entries become views in the OpenSpec view switch; choosing one
maximizes the side panel. `Esc` no longer leaves them — the restore entry or `Ctrl+Shift+M` does,
because the maximized side panel may hold an editor where `Esc` has its own meaning.
