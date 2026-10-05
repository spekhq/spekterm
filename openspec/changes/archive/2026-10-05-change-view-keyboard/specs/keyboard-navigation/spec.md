## MODIFIED Requirements

### Requirement: 以鍵盤在當前 repo 的 session 之間切換

系統 SHALL 提供快捷鍵，於**當前選中的 rail 項目內**將 focused session 切換至下一個或上一個：

- `Ctrl+Tab` —— 下一個 session
- `Ctrl+Shift+Tab` —— 上一個 session

**作用域為 rail 上選中的項目，涵蓋全域項目**（見 `global-session`）—— 全域 session 與各 folder 的
session 分屬不同的分頁列，切換 SHALL NOT 跨越項目。

順序 SHALL 為**分頁列上的位置序**（即使用者拖曳排出來的順序），SHALL NOT 為「最近使用順序」——
位置序是使用者自己決定的，只有它可預測。

到達末端時 SHALL 循環（最後一個的下一個是第一個，反之亦然）。

當前項目沒有 session、只有一個 session、或沒有選中任何 rail 項目時，這兩個快捷鍵 SHALL 為無操作，
且 SHALL NOT 產生錯誤。

**Focus inside the OpenSpec change view is an exception** (see `openspec-panel`, "`Ctrl+Tab`
switches artifacts while focus is in the change view"): there these two shortcuts switch the change's
artifacts and SHALL NOT switch the focused session. The exception is decided by where focus is, the
same model as `Ctrl+P` — with focus in the terminal, the editor, or anywhere else, they switch
sessions as above.

#### Scenario: 切換至下一個 session

- **WHEN** 當前項目有多個 session，使用者按下 `Ctrl+Tab`
- **THEN** focused session 變為分頁列上的下一個 session，終端顯示其內容

#### Scenario: 切換至上一個 session

- **WHEN** 當前項目有多個 session，使用者按下 `Ctrl+Shift+Tab`
- **THEN** focused session 變為分頁列上的上一個 session

#### Scenario: 於全域項目內切換 session

- **WHEN** 選中的是全域項目且它有多個 session，使用者按下 `Ctrl+Tab`
- **THEN** focused session 變為全域項目分頁列上的下一個 session，且不切換至任何 folder 的 session

#### Scenario: 於末端循環

- **WHEN** focused session 為分頁列上的最後一個，使用者按下 `Ctrl+Tab`
- **THEN** focused session 變為分頁列上的第一個

#### Scenario: 順序依分頁位置，不依使用順序

- **WHEN** 使用者先聚焦第三個分頁、再聚焦第一個分頁，然後按下 `Ctrl+Tab`
- **THEN** focused session 變為**第二個**分頁（位置序的下一個），而非第三個（最近使用的那個）

#### Scenario: 只有一個 session 時為無操作

- **WHEN** 當前項目只有一個 session，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，且應用程式不產生錯誤

#### Scenario: Ctrl+Tab in the change view does not switch sessions

- **WHEN** the current item has several sessions, focus is inside the OpenSpec change view, and the
  user presses `Ctrl+Tab`
- **THEN** the focused session does not change

### Requirement: 終端持有焦點時快捷鍵仍生效，且該按鍵不得抵達 pty

終端幾乎永遠持有焦點 —— 那是這個應用程式的常態。**導航與排序**快捷鍵皆 SHALL 在終端持有焦點時仍然生效。

因此攔截 SHALL 早於 xterm 將按鍵寫入 pty。被攔截的按鍵 SHALL NOT 抵達 pty ——
否則跑在裡面的 agent 會收到一串它沒有預期的控制序列。

**`Ctrl+C` SHALL NOT 被本能力挪用**，它必須維持中斷訊號（既有要求）。

**本要求的作用域限於本能力的快捷鍵（導航與排序），SHALL NOT 被讀作對整個應用程式的通則。**
side panel 的檔案快速開啟入口（見 `quick-open`）是**第三組**快捷鍵，其作用域與本條相反 ——
它在終端持有焦點時**讓路給 pty，且該按鍵必須抵達 pty**，因為 `claude` 以它顯示 previous history。

本條原本的措辭（作用域為「導航與排序」）已足以排除第三組，兩者並不互相矛盾；此處明寫，是因為
本能力的規格反覆以「導航 vs 排序」的**兩組對照**解釋各種焦點情形，而那個形式會讓讀者把它讀成一份
窮舉表 —— 進而把「終端裡仍然生效」誤推到第三組身上。**新增任何一組快捷鍵時，都必須回到此處寫明
它落在哪一邊。**

**`Ctrl+Tab` / `Ctrl+Shift+Tab` with focus inside the OpenSpec change view** switch the change's
artifacts instead of sessions (see `openspec-panel`). That exception is decided by focus and does
not touch this requirement: with focus in the terminal they switch sessions and do not reach the pty.

#### Scenario: 終端持有焦點時切換 session

- **WHEN** 使用者的焦點在終端中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

#### Scenario: 終端持有焦點時調整順序

- **WHEN** 使用者的焦點在終端中，按下 `Shift+↓` 或 `Shift+→`
- **THEN** 對應的 repo 或 session 於其清單中往下／往右移動一格

#### Scenario: 被攔截的按鍵不寫入 pty

- **WHEN** 使用者的焦點在終端中，按下 `Ctrl+Tab`、`Ctrl+↑`／`Ctrl+↓`，或 `Shift+↑`／`Shift+↓`／`Shift+←`／`Shift+→`
- **THEN** pty **未**收到任何對應的位元組（終端中沒有出現該按鍵的字元或控制序列）

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

#### Scenario: 編輯器持有焦點時切換 session

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

#### Scenario: 編輯器持有焦點時排序快捷鍵讓路

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Shift+→`
- **THEN** 編輯器選取了一個字元，且未觸發任何排序
