# keyboard-navigation Specification

## Purpose

以鍵盤在 workspace 之內**導航**與**排序** —— 於當前 repo 的 session 之間切換、於 repo 之間切換、
開啟建立 session 的入口（並使該入口可完全以鍵盤完成選擇），以及調整 repo 與 session 的順序。

這些快捷鍵的成立條件是「**終端幾乎永遠持有焦點**」：攔截必須早於 xterm 將按鍵寫入 pty，且被
攔截的按鍵不得抵達 pty；對話框或選單正在等待使用者裁決時，一律讓位。

**排序快捷鍵有一條導航快捷鍵沒有的例外**：`Shift+arrow` 就是文字選取鍵，因此它在**可編輯文字**
持有焦點時完全讓路（而導航快捷鍵在編輯器裡仍然生效）。兩者的差別必須在各自的 requirement 裡寫明，
否則規格自相矛盾。
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

其實作為「**找到既有的建立入口並觸發它**」（那正是「錨定位置與滑鼠相同」得以成立的原因），
而該入口以其 `aria-label` 定位 —— **該文案 SHALL 取自字典，SHALL NOT 硬編**（見
`ui-localization` 的「以文案定位介面元素的程式碼自字典取得該文案」）。`aria-label` 在此同時是
選擇器：硬編它，一次文案改動就會**靜默地**廢掉這顆快捷鍵 —— 字串比對不會使型別檢查失敗，
也不會有任何紅燈。

#### Scenario: 以 Ctrl+T 開啟 spawn 選單

- **WHEN** 當前有選中的 repo，使用者按下 `Ctrl+T`
- **THEN** spawn 選單開啟，且其位置與以滑鼠觸發建立入口時相同

#### Scenario: 沒有選中的 repo 時為無操作

- **WHEN** 沒有選中任何 repo，使用者按下 `Ctrl+T`
- **THEN** 不開啟任何選單，且應用程式不產生錯誤

#### Scenario: 定位建立入口的文案取自字典

- **WHEN** 檢視 `Ctrl+T` 用以定位建立入口的 `aria-label` 文案
- **THEN** 該文案取自字典，而非硬編於程式碼

### Requirement: spawn 選單可完全以鍵盤操作

以快捷鍵叫出的選單，SHALL 能完全以鍵盤完成選擇 —— **否則按完仍須摸滑鼠，快捷鍵等於沒做**。

選單開啟時，焦點 SHALL 落在第一個選項。`↓` / `↑` SHALL 於選項之間移動並循環，
`Enter` SHALL 觸發當前選項，`Esc` SHALL 關閉選單。

選單的兩個選項於介面上的標籤為 **Run claude** 與 **Login shell**（UI 的文案為英文，
見 `ui-localization`）。

#### Scenario: 選單開啟時焦點落在第一個選項

- **WHEN** 使用者以 `Ctrl+T` 開啟 spawn 選單
- **THEN** 焦點位於選單的第一個選項

#### Scenario: 以方向鍵於選項間移動並循環

- **WHEN** 焦點位於選單的最後一個選項，使用者按下 `↓`
- **THEN** 焦點移至第一個選項

#### Scenario: 以 Enter 觸發當前選項

- **WHEN** 使用者以方向鍵將焦點移至 **Login shell** 並按下 `Enter`
- **THEN** 建立一個 login shell 的 session，且選單關閉

### Requirement: 終端持有焦點時快捷鍵仍生效，且該按鍵不得抵達 pty

終端幾乎永遠持有焦點 —— 那是這個應用程式的常態。**導航與排序**快捷鍵皆 SHALL 在終端持有焦點時仍然生效。

因此攔截 SHALL 早於 xterm 將按鍵寫入 pty。被攔截的按鍵 SHALL NOT 抵達 pty ——
否則跑在裡面的 agent 會收到一串它沒有預期的控制序列。

**`Ctrl+C` SHALL NOT 被本能力挪用**，它必須維持中斷訊號（既有要求）。

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

#### Scenario: 編輯器持有焦點時切換 session

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Ctrl+Tab`
- **THEN** focused session 切換至下一個 session

#### Scenario: 編輯器持有焦點時排序快捷鍵讓路

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Shift+→`
- **THEN** 編輯器選取了一個字元，且未觸發任何排序

### Requirement: 對話框或選單開啟時導航快捷鍵不生效

本能力的快捷鍵（**導航與排序**）SHALL NOT 於任一對話框或選單開啟期間生效。對話框（session 命名、檔案操作的命名與刪除確認、Graph／Timeline 的全視窗 overlay、未存變更的提示）與選單（spawn 選單、右鍵選單）正在等待使用者的裁決 —— 否則使用者會在回答問題的同時把畫面切走或把清單重排，而選單的方向鍵導覽也會被搶走。

判定 SHALL 以對話框與選單的無障礙角色（`dialog` / `menu`）之存在為準，**SHALL NOT 逐一列舉特定的對話框** —— 任何遵守該慣例的新對話框皆自動被尊重。此規則的失效模式因此不是判定邏輯出錯，而是**某個對話框漏了該角色標記，於是靜默地不被尊重**；驗收 SHALL 因此以**多種不同的對話框**各驗一次，而非只驗一種。

> 對話框裡的輸入框同時也是可編輯文字元素 —— 排序快捷鍵因此有**兩道**讓路的理由（本條與「排序快捷鍵於可編輯文字持有焦點時不生效」）。這是刻意的冗餘：對話框裡沒有輸入框的情況（刪除確認、全視窗 overlay）只有本條擋得住。

#### Scenario: 命名對話框開啟時按下導航快捷鍵

- **WHEN** session 的命名對話框開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，對話框維持開啟

#### Scenario: 全視窗 overlay 開啟時按下導航快捷鍵

- **WHEN** Graph 或 Timeline 的全視窗 overlay 開啟中，使用者按下切換 repo 的導航快捷鍵
- **THEN** 選中的 folder 不變，overlay 維持開啟

#### Scenario: 選單開啟時按下導航快捷鍵

- **WHEN** spawn 選單開啟中，使用者按下 `Ctrl+Tab`
- **THEN** focused session 不變，選單維持開啟

#### Scenario: 對話框開啟時按下排序快捷鍵

- **WHEN** session 的命名對話框開啟中，使用者按下 `Shift+↓`
- **THEN** rail 的順序不變，對話框維持開啟，且該按鍵照常抵達對話框的輸入框（選取行為不受影響）

### Requirement: 以鍵盤調整 repo 的順序

系統 SHALL 提供快捷鍵，將**當前選中的 repo** 於 rail 上往上或往下移動一格：

- `Shift+↑` —— 往上移動一格
- `Shift+↓` —— 往下移動一格

移動後該 repo SHALL 仍為選中的 repo —— 選中的是那個 repo，不是那個位置。新的順序 SHALL 持久化
（見 `workspace-folders` 的「folder 的順序由使用者決定」）。

**到達端點時 SHALL NOT 循環**，該按鍵 SHALL 為無操作。這與導航快捷鍵的「到達末端時循環」**刻意
不同**：導航是巡覽，越過末端繞回開頭什麼都沒被改變；排序是**改變資料**，越過末端繞回開頭意味著
「把第一名丟到最後一名」—— 那是使用者按過頭時最不想發生的事，且要再按 N-1 次才回得來。

沒有選中的 repo、或 workspace 只有一個 folder 時，這兩個快捷鍵 SHALL 為無操作，且 SHALL NOT
產生錯誤。

**`Shift+arrow` 在 pty 內送得出去**（`CSI 1;2A`–`D`），攔截它即從 pty 內的程式手上沒收該鍵。實測
zsh 與 bash 皆未綁定；**已知的犧牲者是 `claude` 自己的 agents view**。此取捨見 design D1 ——
**該裁決有前提**（claude 的 `Shift+↑↓` 不是常用路徑），前提若不再成立，退路是 `Ctrl+Shift+arrow`。

#### Scenario: 將選中的 repo 往下移動一格

- **WHEN** workspace 有多個 folder，使用者按下 `Shift+↓`
- **THEN** 選中的 repo 於 rail 上與其下方的 repo 交換位置

#### Scenario: 到達端點時不循環

- **WHEN** 選中的是 rail 上的第一個 repo，使用者按下 `Shift+↑`
- **THEN** rail 的順序不變，該 repo 仍在第一個位置（**不**繞至最後一個）

#### Scenario: 移動後仍為選中的 repo

- **WHEN** 使用者以 `Shift+↓` 移動當前選中的 repo
- **THEN** 該 repo 於新位置仍為選中，主舞台呈現的仍是它

#### Scenario: 只有一個 folder 時為無操作

- **WHEN** workspace 只有一個 folder，使用者按下 `Shift+↓`
- **THEN** 順序不變，且應用程式不產生錯誤

### Requirement: 以鍵盤調整 session 的順序

系統 SHALL 提供快捷鍵，將**當前 repo 的 focused session** 於分頁列上往左或往右移動一格：

- `Shift+←` —— 往左移動一格
- `Shift+→` —— 往右移動一格

順序 SHALL 為分頁列上的位置序，且 **rail 的 session 子列 SHALL 隨之呈現相同的新順序** —— 兩個
視圖共用同一個順序（見 `workspace-layout`）。移動後該 session SHALL 仍為 focused。

**到達端點時 SHALL NOT 循環**，該按鍵 SHALL 為無操作（理由同上一條）。

沒有選中的 repo、當前 repo 沒有 session、或只有一個 session 時，SHALL 為無操作，且 SHALL NOT
產生錯誤。

#### Scenario: 將 focused session 往右移動一格

- **WHEN** 當前 repo 有多個 session，使用者按下 `Shift+→`
- **THEN** focused session 於分頁列上與其右方的分頁交換位置

#### Scenario: rail 的 session 子列呈現相同的新順序

- **WHEN** 使用者以 `Shift+→` 移動 focused session
- **THEN** rail 的 session 子列以相同的新順序呈現該 repo 的 session

#### Scenario: 到達端點時不循環

- **WHEN** focused session 為分頁列上的最後一個，使用者按下 `Shift+→`
- **THEN** 分頁列的順序不變（**不**繞至第一個）

#### Scenario: 只有一個 session 時為無操作

- **WHEN** 當前 repo 只有一個 session，使用者按下 `Shift+←`
- **THEN** 順序不變，且應用程式不產生錯誤

### Requirement: 排序快捷鍵於可編輯文字持有焦點時不生效

焦點落在可編輯文字元素（輸入框、文字區、`contenteditable`、side panel 的編輯器）上時，排序快捷鍵 SHALL NOT 生效，且該按鍵 SHALL 照常抵達該元素 —— `Shift+arrow` **就是文字選取鍵**，選取行為必須完全不受影響。

**終端 SHALL NOT 被視為可編輯文字元素**，即使其輸入路徑在實作上是一個隱形的文字區。終端是這個
應用程式的常態焦點，排序快捷鍵在它上面 SHALL 生效（見「終端持有焦點時快捷鍵仍生效」）。

因此判定 SHALL NOT 以「焦點元素是不是一個文字區」為準 —— 編輯器與終端的輸入路徑**都是**文字區，
那樣的判定會使排序快捷鍵在終端上（也就是絕大多數時間）**靜默失效**。

**此例外僅限排序快捷鍵**；導航快捷鍵不受此限（見「編輯器持有焦點時快捷鍵仍生效」）。

此規則有**兩個相反的失效方向**，驗收 SHALL 對兩者各驗一次 —— 只驗一邊等於沒驗：

- 判定過寬（把終端也當成可編輯文字）→ 快捷鍵在終端上失效。
- 判定過窄（漏掉這個例外）→ 編輯器裡的文字選取消失。

#### Scenario: 編輯器持有焦點時的 Shift+arrow 仍是文字選取

- **WHEN** 使用者的焦點在 side panel 的編輯器中，按下 `Shift+→`
- **THEN** 編輯器選取了一個字元，且 repo 與 session 的順序皆不變

#### Scenario: 終端持有焦點時排序快捷鍵仍生效

- **WHEN** 使用者的焦點在終端中，按下 `Shift+↓`
- **THEN** 選中的 repo 於 rail 上往下移動一格

### Requirement: 以鍵盤關閉當前 session

系統 SHALL 提供快捷鍵 `Ctrl+Shift+W`，關閉當前 focused 的 session。當前沒有選中的 repo、或該
repo 沒有任何 session 時，`Ctrl+Shift+W` SHALL 為無操作，且 SHALL NOT 產生錯誤。

**鍵位選 `Ctrl+Shift+W` 而非 `Ctrl+W`**：後者在 zsh 是 `backward-kill-word`、bash 是
`unix-word-rubout`（終端裡的高頻刪字鍵，實測），攔截它即從 pty 內的程式手上沒收該鍵；而它沒有
`Ctrl+T` 的「GNOME Terminal 早已把它拿去開新分頁」豁免。`Ctrl+Shift+<字母>` 在終端協定裡編碼
不出來，pty 內收不到，代價為零（同複製貼上用 `Ctrl+Shift+C/V` 的理由，見 design D1）。

攔截於 window 的 capture 階段（同既有快捷鍵，早於 xterm 與 Monaco），被攔下的 `Ctrl+Shift+W`
SHALL NOT 抵達 pty。對話框或 overlay 開啟時 SHALL 不生效 —— 沿用 `[role="dialog"]` 的存在判定
（未存變更對話框開著時按它，不該把 session 關掉）。

#### Scenario: 以 Ctrl+Shift+W 關閉當前 session

- **WHEN** 當前有 focused 的 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 該 session 被關閉，且該按鍵不抵達 pty

#### Scenario: 終端持有焦點時仍能關閉 session

- **WHEN** 終端持有焦點，使用者按下 `Ctrl+Shift+W`
- **THEN** 當前 session 被關閉，且該按鍵不抵達 pty

#### Scenario: 沒有 session 時為無操作

- **WHEN** 當前沒有選中的 repo，或該 repo 沒有任何 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 不關閉任何東西，且應用程式不產生錯誤

#### Scenario: 對話框開啟時不生效

- **WHEN** 一個對話框（例如未存變更確認）開啟時，使用者按下 `Ctrl+Shift+W`
- **THEN** 不關閉任何 session

