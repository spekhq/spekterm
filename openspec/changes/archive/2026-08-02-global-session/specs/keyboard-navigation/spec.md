## ADDED Requirements

### Requirement: 選取或焦點改變時目標捲入可視範圍

以鍵盤改變選取、焦點或順序時，目標 SHALL 於其所在的**每一個**捲動容器內可見。切過去了卻看不到，
等於這次導航沒有完成 —— 使用者會判定該快捷鍵壞了，而畫面上確實沒有任何事情發生。

**本要求以不變式表述，不以按鍵清單表述。** 涵蓋範圍至少包含：

| 觸發 | 目標 | 需捲動的容器 |
|---|---|---|
| `Ctrl+↑↓` | 選中的 rail 項目 | rail（縱向） |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | focused session | 分頁列（橫向）**與** rail（縱向 —— 該 session 的子列位於 rail 的同一個捲動容器內） |
| `Shift+↑↓` | 被移動的 rail 項目 | rail（縱向） |
| `Shift+←→` | 被移動的 session | 分頁列（橫向）與 rail（縱向） |
| `Ctrl+Shift+W` | 關閉後承接焦點的 session | 分頁列（橫向）與 rail（縱向） |
| `Ctrl+T` 建立的新 session | 該 session | 分頁列（橫向）與 rail（縱向） |

**唯一的例外是使用者直接操作該容器內元素所造成的改變** —— 他點得到的東西本來就在該容器的視野裡，
為它捲動只會讓畫面跳。**此例外僅及於被直接操作的那一個容器**：點選 rail 的 session 子列會使
**分頁列**的 focused 分頁改變，而那個分頁可能在橫向視野之外 —— 該容器 SHALL 捲動。

**目標已完整可見時 SHALL NOT 捲動。** 每次按鍵都把目標拉到容器正中，會讓使用者連按時畫面持續跳動。

捲動 SHALL 於 DOM 反映新狀態**之後**執行。順序改變後元素的位置隨之改變，在同一輪更新中量測會得到
舊位置；而該副作用 SHALL NOT 置於 state 的 updater 之中。

**驗收 SHALL 在項目數確實超出容器可視範圍的情況下進行。** 內容未超出時捲動容器不會捲動，於是
「目標可見」這個斷言**恆為真** —— 一個在此條件下取得的綠燈，證明不了任何事。

#### Scenario: 切換至視野外的 rail 項目時捲入視野

- **WHEN** rail 的項目數超出其可視範圍，使用者以 `Ctrl+↓` 連續切換至一個當下不可見的項目
- **THEN** 該項目被捲入 rail 的可視範圍，且完整可見

#### Scenario: 循環至頂端的項目時捲回頂部

- **WHEN** rail 已向下捲動，使用者以 `Ctrl+↑` 自第一個 folder 切換至全域項目
- **THEN** 全域項目被捲入可視範圍

#### Scenario: 切換至視野外的 session 時分頁列橫向捲動

- **WHEN** 當前項目的 session 數使分頁列超出其寬度，使用者以 `Ctrl+Tab` 切換至一個當下不可見的分頁
- **THEN** 該分頁被捲入分頁列的可視範圍

#### Scenario: 切換 session 時其 rail 子列亦捲入視野

- **WHEN** rail 的內容超出其可視範圍，使用者以 `Ctrl+Tab` 切換至一個其 rail 子列不可見的 session
- **THEN** 該 session 的 rail 子列被捲入 rail 的可視範圍

#### Scenario: 移動 rail 項目後它仍可見

- **WHEN** rail 的項目數超出其可視範圍，使用者以 `Shift+↓` 將選中的項目連續往下移動至視野之外
- **THEN** 該項目被捲入可視範圍

#### Scenario: 移動 session 後它仍可見

- **WHEN** 分頁列超出其寬度，使用者以 `Shift+→` 將 focused session 連續往右移動至視野之外
- **THEN** 該分頁被捲入分頁列的可視範圍

#### Scenario: 目標已完整可見時不捲動

- **WHEN** 目標項目在按鍵之前即已完整可見
- **THEN** 捲動容器的捲動位置不變

#### Scenario: 以滑鼠選取部分可見的項目時不捲動

- **WHEN** 使用者以滑鼠點選 rail 上一個**部分超出可視範圍**的項目（例如下緣被裁掉一半）
- **THEN** rail 的捲動位置不變 —— 使用者的直接操作不觸發捲動

#### Scenario: 點選 rail 子列時分頁列仍捲動

- **WHEN** 分頁列超出其寬度，使用者以滑鼠點選 rail 上一個其分頁不可見的 session 子列
- **THEN** 該分頁被捲入分頁列的可視範圍 —— 例外僅及於被直接操作的那一個容器

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

### Requirement: 以鍵盤在 repo 之間切換

系統 SHALL 提供快捷鍵，將當前選中的 rail 項目切換至 rail 上的下一個或上一個：

- `Ctrl+↓` —— 下一個項目
- `Ctrl+↑` —— 上一個項目

順序 SHALL 為 **rail 上的呈現順序**，且該順序 SHALL 涵蓋**全域項目**（見 `global-session`：它恆為
rail 的第一個項目）。到達末端時 SHALL 循環 —— 於是自最後一個 folder 按 `Ctrl+↓` 會回到全域項目。

rail 上只有一個項目時（workspace 尚未加入任何 folder，rail 僅有全域項目），這兩個快捷鍵 SHALL 為
無操作，且 SHALL NOT 產生錯誤。

**沒有選中任何項目時**（冷啟動的預設狀態，見 `global-session`），這兩個快捷鍵 SHALL 選中 rail 上的
第一個項目，SHALL NOT 為無操作 —— 否則使用者必須先動一次滑鼠才能開始用鍵盤。

#### Scenario: 切換至下一個項目

- **WHEN** rail 上有多個項目，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的項目變為 rail 上的下一個，主舞台與 side panel 皆隨之呈現該項目

#### Scenario: 切換至上一個項目

- **WHEN** rail 上有多個項目，使用者按下 `Ctrl+↑`
- **THEN** 當前選中的項目變為 rail 上的上一個

#### Scenario: 自第一個 folder 往上切換即抵達全域項目

- **WHEN** 當前選中的是 rail 上的第一個 folder，使用者按下 `Ctrl+↑`
- **THEN** 當前選中的項目變為全域項目

#### Scenario: 於末端循環回到全域項目

- **WHEN** 當前選中的是 rail 上的最後一個 folder，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的項目變為全域項目（rail 上的第一個項目）

#### Scenario: 尚未選中任何項目時選中第一個

- **WHEN** 應用程式剛啟動、尚未選中任何 rail 項目，使用者按下 `Ctrl+↓`
- **THEN** 全域項目（rail 上的第一個項目）成為選中的項目

#### Scenario: rail 只有全域項目時為無操作

- **WHEN** workspace 尚未加入任何 folder 且全域項目已被選中，使用者按下 `Ctrl+↓`
- **THEN** 當前選中的項目不變，且應用程式不產生錯誤

### Requirement: 以鍵盤開啟建立 session 的入口

系統 SHALL 提供快捷鍵 `Ctrl+T`，開啟**當前選中之 rail 項目**的建立 session 入口（spawn 選單），
其行為 SHALL 與以滑鼠觸發該入口相同 —— 包含選單的錨定位置。**作用域涵蓋全域項目**（見
`global-session`）。

當前沒有選中任何 rail 項目時，`Ctrl+T` SHALL 為無操作，且 SHALL NOT 產生錯誤。

**`Ctrl+T` 在 pty 內是 `transpose-chars`**（zsh 與 bash readline 的預設綁定，實測），
攔截它即從 pty 內的程式手上沒收該鍵。此取捨見 design D8。

其實作為「**找到既有的建立入口並觸發它**」（那正是「錨定位置與滑鼠相同」得以成立的原因），
而該入口以其 `aria-label` 定位 —— **該文案 SHALL 取自字典，SHALL NOT 硬編**（見
`ui-localization` 的「以文案定位介面元素的程式碼自字典取得該文案」）。`aria-label` 在此同時是
選擇器：硬編它，一次文案改動就會**靜默地**廢掉這顆快捷鍵 —— 字串比對不會使型別檢查失敗，
也不會有任何紅燈。**全域項目的建立入口 SHALL 可被同一條路徑定位**，SHALL NOT 因它不是 folder
而需要第二套選擇器。

#### Scenario: 以 Ctrl+T 開啟 spawn 選單

- **WHEN** 當前有選中的 rail 項目，使用者按下 `Ctrl+T`
- **THEN** spawn 選單開啟，且其位置與以滑鼠觸發建立入口時相同

#### Scenario: 於全域項目開啟 spawn 選單

- **WHEN** 選中的是全域項目，使用者按下 `Ctrl+T`
- **THEN** spawn 選單開啟，選擇一個目標後於全域項目建立 session

#### Scenario: 沒有選中任何項目時為無操作

- **WHEN** 沒有選中任何 rail 項目，使用者按下 `Ctrl+T`
- **THEN** 不開啟任何選單，且應用程式不產生錯誤

#### Scenario: 定位建立入口的文案取自字典

- **WHEN** 檢視 `Ctrl+T` 用以定位建立入口的 `aria-label` 文案
- **THEN** 該文案取自字典，而非硬編於程式碼

### Requirement: 以鍵盤調整 repo 的順序

系統 SHALL 提供快捷鍵，將**當前選中的 repo** 於 rail 上往上或往下移動一格：

- `Shift+↑` —— 往上移動一格
- `Shift+↓` —— 往下移動一格

移動後該 repo SHALL 仍為選中的 repo —— 選中的是那個 repo，不是那個位置。新的順序 SHALL 持久化
（見 `workspace-folders` 的「folder 的順序由使用者決定」）。

**到達端點時 SHALL NOT 循環**，該按鍵 SHALL 為無操作。這與導航快捷鍵的「到達末端時循環」**刻意
不同**：導航是巡覽，越過末端繞回開頭什麼都沒被改變；排序是**改變資料**，越過末端繞回開頭意味著
「把第一名丟到最後一名」—— 那是使用者按過頭時最不想發生的事，且要再按 N-1 次才回得來。

**當前選中的項目為全域項目時，這兩個快捷鍵 SHALL 為無操作**（見 `global-session`：它不是
workspace 的成員，沒有順序可言）。SHALL NOT 將它與第一個 folder 交換位置，亦 SHALL NOT 移動它
而不持久化 —— 兩者都會讓使用者看見一個隨後自行復原的位移。

**順序的位置 SHALL 以 folder 清單為基準計算，SHALL NOT 以 rail 上的列位置計算。** rail 比 folder
清單多了全域項目那一列，兩者的索引相差一位。以列位置計算的具體失效是兩個方向都錯：**`Shift+↑`
會使第二個 folder 算出等於它自身的目標位置而靜默無操作**；**`Shift+↓` 會使第一個 folder 多跳
一格**。兩者在 workspace 只有兩個 folder 時都看不出來 —— 夾制會把越界的目標拉回末端，結果與正確
實作相同。

沒有選中的項目、或 workspace 只有一個 folder 時，這兩個快捷鍵 SHALL 為無操作，且 SHALL NOT
產生錯誤。

**`Shift+arrow` 在 pty 內送得出去**（`CSI 1;2A`–`D`），攔截它即從 pty 內的程式手上沒收該鍵。實測
zsh 與 bash 皆未綁定；**已知的犧牲者是 `claude` 自己的 agents view**。此取捨見 design D1 ——
**該裁決有前提**（claude 的 `Shift+↑↓` 不是常用路徑），前提若不再成立，退路是 `Ctrl+Shift+arrow`。

#### Scenario: 將選中的 repo 往下移動一格

- **WHEN** workspace 有三個以上的 folder，使用者按下 `Shift+↓`
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

#### Scenario: 選中全域項目時為無操作

- **WHEN** 使用者選中全域項目並按下 `Shift+↓`
- **THEN** rail 的順序不變，全域項目仍在第一個位置，且應用程式不產生錯誤

#### Scenario: 第一個 folder 仍可往下移動一格

- **WHEN** workspace 有三個以上的 folder，使用者選中第一個 folder 並按下 `Shift+↓`
- **THEN** 該 folder 與第二個 folder 交換位置 —— 恰好一格，不因全域項目佔據 rail 首位而多跳

#### Scenario: 第二個 folder 仍可往上移動一格

- **WHEN** workspace 有三個以上的 folder，使用者選中第二個 folder 並按下 `Shift+↑`
- **THEN** 該 folder 與第一個 folder 交換位置 —— 不因索引偏移而靜默無操作

### Requirement: 以鍵盤調整 session 的順序

系統 SHALL 提供快捷鍵，將**當前選中之 rail 項目的 focused session** 於分頁列上往左或往右移動一格：

- `Shift+←` —— 往左移動一格
- `Shift+→` —— 往右移動一格

**作用域涵蓋全域項目**（見 `global-session`）。順序 SHALL 為分頁列上的位置序，且 **rail 的 session
子列 SHALL 隨之呈現相同的新順序** —— 兩個視圖共用同一個順序（見 `workspace-layout`）。移動後該
session SHALL 仍為 focused。

**到達端點時 SHALL NOT 循環**，該按鍵 SHALL 為無操作（理由同上一條）。

沒有選中任何 rail 項目、當前項目沒有 session、或只有一個 session 時，SHALL 為無操作，且 SHALL NOT
產生錯誤。

#### Scenario: 將 focused session 往右移動一格

- **WHEN** 當前項目有多個 session，使用者按下 `Shift+→`
- **THEN** focused session 於分頁列上與其右方的分頁交換位置

#### Scenario: 於全域項目調整 session 順序

- **WHEN** 選中的是全域項目且它有多個 session，使用者按下 `Shift+→`
- **THEN** 該 session 於全域項目的分頁列上與其右方的分頁交換位置

#### Scenario: rail 的 session 子列呈現相同的新順序

- **WHEN** 使用者以 `Shift+→` 移動 focused session
- **THEN** rail 的 session 子列以相同的新順序呈現該項目的 session

#### Scenario: 到達端點時不循環

- **WHEN** focused session 為分頁列上的最後一個，使用者按下 `Shift+→`
- **THEN** 分頁列的順序不變（**不**繞至第一個）

#### Scenario: 只有一個 session 時為無操作

- **WHEN** 當前項目只有一個 session，使用者按下 `Shift+←`
- **THEN** 順序不變，且應用程式不產生錯誤

### Requirement: 以鍵盤關閉當前 session

系統 SHALL 提供快捷鍵 `Ctrl+Shift+W`，關閉當前 focused 的 session。當前沒有選中任何 rail 項目、
或該項目沒有任何 session 時，`Ctrl+Shift+W` SHALL 為無操作，且 SHALL NOT 產生錯誤。
**作用域涵蓋全域項目**（見 `global-session`）。

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

#### Scenario: 於全域項目關閉 session

- **WHEN** 選中的是全域項目且它有 focused 的 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 該全域 session 被關閉

#### Scenario: 終端持有焦點時仍能關閉 session

- **WHEN** 終端持有焦點，使用者按下 `Ctrl+Shift+W`
- **THEN** 當前 session 被關閉，且該按鍵不抵達 pty

#### Scenario: 沒有 session 時為無操作

- **WHEN** 當前沒有選中任何 rail 項目，或該項目沒有任何 session，使用者按下 `Ctrl+Shift+W`
- **THEN** 不關閉任何東西，且應用程式不產生錯誤
