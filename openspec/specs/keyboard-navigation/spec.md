# keyboard-navigation Specification

## Purpose

以鍵盤在 workspace 之內導航 —— 於當前 repo 的 session 之間切換、於 repo 之間切換、開啟建立
session 的入口，並使該入口可完全以鍵盤完成選擇。

這些快捷鍵的成立條件是「**終端幾乎永遠持有焦點**」：攔截必須早於 xterm 將按鍵寫入 pty，且被
攔截的按鍵不得抵達 pty；對話框或選單正在等待使用者裁決時，導航一律讓位。

## Requirements

### Requirement: 以鍵盤在當前 repo 的 session 之間切換

系統 SHALL 提供快捷鍵，於**當前選中的 repo 內**將 focused session 切換至下一個或上一個：

- `Ctrl+Tab` —— 下一個 session
- `Ctrl+Shift+Tab` —— 上一個 session

順序 SHALL 為**分頁列上的位置序**（即使用者拖曳排出來的順序），SHALL NOT 為「最近使用順序」——
位置序是使用者自己決定的，只有它可預測。

到達末端時 SHALL 循環（最後一個的下一個是第一個，反之亦然）。

當前 repo 沒有 session、或只有一個 session 時，這兩個快捷鍵 SHALL 為無操作，且 SHALL NOT 產生錯誤。

#### Scenario: 切換至下一個 session

- **WHEN** 當前 repo 有多個 session，使用者按下 `Ctrl+Tab`
- **THEN** focused session 變為分頁列上的下一個 session，終端顯示其內容

#### Scenario: 切換至上一個 session

- **WHEN** 當前 repo 有多個 session，使用者按下 `Ctrl+Shift+Tab`
- **THEN** focused session 變為分頁列上的上一個 session

#### Scenario: 於末端循環

- **WHEN** focused session 為分頁列上的最後一個，使用者按下 `Ctrl+Tab`
- **THEN** focused session 變為分頁列上的第一個

#### Scenario: 順序依分頁位置，不依使用順序

- **WHEN** 使用者先聚焦第三個分頁、再聚焦第一個分頁，然後按下 `Ctrl+Tab`
- **THEN** focused session 變為**第二個**分頁（位置序的下一個），而非第三個（最近使用的那個）

#### Scenario: 只有一個 session 時為無操作

- **WHEN** 當前 repo 只有一個 session，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，且應用程式不產生錯誤

### Requirement: 以鍵盤在 repo 之間切換

系統 SHALL 提供快捷鍵，將當前選中的 repo 切換至 rail 上的下一個或上一個：

- `Ctrl+↓` —— 下一個 repo
- `Ctrl+↑` —— 上一個 repo

順序 SHALL 為 **rail 上的呈現順序**。到達末端時 SHALL 循環。

workspace 只有一個 folder 時，這兩個快捷鍵 SHALL 為無操作，且 SHALL NOT 產生錯誤。

#### Scenario: 切換至下一個 repo

- **WHEN** workspace 有多個 folder，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的 repo 變為 rail 上的下一個 folder，主舞台與 side panel 皆隨之呈現該 repo

#### Scenario: 切換至上一個 repo

- **WHEN** workspace 有多個 folder，使用者按下 `Ctrl+↑`
- **THEN** 當前選中的 repo 變為 rail 上的上一個 folder

#### Scenario: 於末端循環

- **WHEN** 當前選中的是 rail 上的最後一個 folder，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的 repo 變為 rail 上的第一個 folder

#### Scenario: 只有一個 folder 時為無操作

- **WHEN** workspace 只有一個 folder，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的 repo 不變，且應用程式不產生錯誤

### Requirement: 以鍵盤開啟建立 session 的入口

系統 SHALL 提供快捷鍵 `Ctrl+T`，開啟當前 repo 的**建立 session 入口**（spawn 選單），
其行為 SHALL 與以滑鼠觸發該入口相同 —— 包含選單的錨定位置。

當前沒有選中的 repo 時，`Ctrl+T` SHALL 為無操作，且 SHALL NOT 產生錯誤。

**`Ctrl+T` 在 pty 內是 `transpose-chars`**（zsh 與 bash readline 的預設綁定，實測），
攔截它即從 pty 內的程式手上沒收該鍵。此取捨見 design D8。

#### Scenario: 以 Ctrl+T 開啟 spawn 選單

- **WHEN** 當前有選中的 repo，使用者按下 `Ctrl+T`
- **THEN** spawn 選單開啟，且其位置與以滑鼠觸發建立入口時相同

#### Scenario: 沒有選中的 repo 時為無操作

- **WHEN** 沒有選中任何 repo，使用者按下 `Ctrl+T`
- **THEN** 不開啟任何選單，且應用程式不產生錯誤

### Requirement: spawn 選單可完全以鍵盤操作

以快捷鍵叫出的選單，SHALL 能完全以鍵盤完成選擇 —— **否則按完仍須摸滑鼠，快捷鍵等於沒做**。

選單開啟時，焦點 SHALL 落在第一個選項。`↓` / `↑` SHALL 於選項之間移動並循環，
`Enter` SHALL 觸發當前選項，`Esc` SHALL 關閉選單。

#### Scenario: 選單開啟時焦點落在第一個選項

- **WHEN** 使用者以 `Ctrl+T` 開啟 spawn 選單
- **THEN** 焦點位於選單的第一個選項

#### Scenario: 以方向鍵於選項間移動並循環

- **WHEN** 焦點位於選單的最後一個選項，使用者按下 `↓`
- **THEN** 焦點移至第一個選項

#### Scenario: 以 Enter 觸發當前選項

- **WHEN** 使用者以方向鍵將焦點移至「進 login shell」並按下 `Enter`
- **THEN** 建立一個 login shell 的 session，且選單關閉

### Requirement: 終端持有焦點時快捷鍵仍生效，且該按鍵不得抵達 pty

終端幾乎永遠持有焦點 —— 那是這個應用程式的常態。導航快捷鍵 SHALL 在終端持有焦點時仍然生效。

因此攔截 SHALL 早於 xterm 將按鍵寫入 pty。被攔截的按鍵 SHALL NOT 抵達 pty ——
否則跑在裡面的 agent 會收到一串它沒有預期的控制序列。

**`Ctrl+C` SHALL NOT 被本能力挪用**，它必須維持中斷訊號（既有要求）。

#### Scenario: 終端持有焦點時切換 session

- **WHEN** 使用者的焦點在終端中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

#### Scenario: 被攔截的按鍵不寫入 pty

- **WHEN** 使用者的焦點在終端中，按下 `Ctrl+Tab` 或 `Ctrl+↑`／`Ctrl+↓`
- **THEN** pty **未**收到任何對應的位元組（終端中沒有出現該按鍵的字元或控制序列）

### Requirement: 編輯器持有焦點時快捷鍵仍生效

導航快捷鍵 SHALL 在 side panel 的編輯器持有焦點時仍然生效。編輯器會吃掉按鍵 —— 既有的存檔快捷鍵正是必須註冊於編輯器內部才攔得到，外層的監聽攔不到它。

#### Scenario: 編輯器持有焦點時切換 session

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

### Requirement: 對話框或選單開啟時導航快捷鍵不生效

導航快捷鍵 SHALL NOT 於任一對話框或選單開啟期間生效。對話框（session 命名、pty 標題衝突的確認、未存變更的提示）與選單（spawn 選單、右鍵選單）正在等待使用者的裁決 —— 否則使用者會在回答問題的同時把畫面切走，而選單的方向鍵導覽也會被導航快捷鍵搶走。

#### Scenario: 命名對話框開啟時按下導航快捷鍵

- **WHEN** session 的命名對話框開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，對話框維持開啟

#### Scenario: 選單開啟時按下導航快捷鍵

- **WHEN** spawn 選單開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，選單維持開啟
