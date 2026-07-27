## ADDED Requirements

### Requirement: 側欄座標為 per-folder，不以 session 的存在為前提

側欄座標 SHALL 隸屬於 **rail 上的項目**，SHALL NOT 隸屬於任何 session。它由三個維度組成 ——
**來源 repo**、**工作目錄**（見 `side-panel-worktree`）、**錨定的 change**（見 `openspec-panel`）。
使用者切換 rail 上選中的項目時，side panel SHALL 呈現新項目的座標。

**任一維度的可改變性 SHALL NOT 以「該項目是否已有 session」為條件。** 側欄是一個閱讀工具 ——
要求使用者先開一個 terminal 才能選擇要讀什麼，是把兩件無關的事綁在一起。

座標的預設值：來源 repo 為**該項目自身**，工作目錄為 **folder 自身**，change 為**無明確錨定**
（由 `openspec-panel` 的衍生預設接手）。

**工作目錄與 change 兩個維度隸屬於「來源 repo」，不是隸屬於 rail 項目自身的 repo** —— 工作目錄
識別碼與 change slug 都是某個 repo 內部的座標。這是「切換側欄來源時重置」那兩條要求的理由，
也是它們**只**重置這兩個維度、不重置來源本身的理由。

**「rail 上的項目」今日恰為 workspace 的 folder**，本要求刻意以項目而非 folder 措辭 —— rail 的
項目集合日後可能擴充（例如納入 linked worktree），屆時座標的歸屬單位隨之擴充，而非重新設計。

同一個 folder 的多個 session SHALL 共用該 folder 的座標。這是本粒度的**明確取捨**：換來的是
「有無 session」不再產生兩套行為，代價是同一個 repo 的不同 session 無法各自看著不同的側欄內容。

#### Scenario: 尚無任何 session 的 folder 仍可改變側欄來源

- **WHEN** 使用者選中一個尚未建立任何 session 的 folder，並於來源指示器選擇另一個 folder
- **THEN** side panel 呈現該另一個 folder 的內容

#### Scenario: 尚無任何 session 的 folder 仍可改變工作目錄

- **WHEN** 使用者選中一個尚未建立任何 session、且有多個工作目錄的 folder，切換至 Files 身分並
  於工作目錄選擇器選擇一個 linked worktree
- **THEN** 檔案樹以該 worktree 為根

#### Scenario: 未曾改動時呈現該項目自身

- **WHEN** 一個 folder 的側欄座標未曾被改動，使用者選中它
- **THEN** side panel 呈現該 folder 自身的內容，且 Files 身分以該 folder 的根目錄為樹根

#### Scenario: 切換 rail 上選中的項目時座標隨之改變

- **WHEN** 兩個 folder 的側欄來源指向不同的 repo，使用者於 rail 上由其中一個切換至另一個
- **THEN** side panel 呈現新選中項目的側欄來源所指的 repo

#### Scenario: 同一個 folder 的不同 session 共用同一組座標

- **WHEN** 某個 folder 的側欄來源被設為 repoB，使用者於該 folder 內切換 focused session
- **THEN** side panel 仍呈現 repoB

### Requirement: 側欄座標跨應用程式重啟存活

側欄座標的三個維度 SHALL 被持久化於使用者資料目錄，並 SHALL 於應用程式重新啟動後還原。

**持久化 SHALL 獨立於 session 的持久化** —— 一個沒有任何 session 的 folder，其座標同樣 SHALL 跨
重啟存活。設定檔 SHALL 帶有版本欄位，寫入 SHALL 為原子操作（先寫暫存檔再更名）。

**側欄的工作目錄與 session 開啟的工作目錄是兩個各自獨立的工作目錄事實** —— 後者決定 pty 開在哪
（`session-persistence`），前者決定側欄的 Files 身分讀哪一份原始碼，兩者 SHALL 可不相同（在主
工作目錄駕駛 agent、同時閱讀某個 worktree 的內容是合法且有用的）。**本段自 `session-persistence`
遷入**：兩者型別相同、名字只差一個前綴，是最容易被看混的一對，而它們現在還住在不同的檔案裡 ——
搬家使這段論證更需要，不是更不需要。

持久化的座標**不保證重開後仍然有效**（見下段的各種降級），這與「folder 路徑失效 → 喚醒錯誤」是
同一種防禦姿態。

**落盤的內容 SHALL NOT 包含任何絕對或相對路徑。** 工作目錄 SHALL 以不可逆的工作目錄識別碼保存，
來源 repo SHALL 以 folder 識別碼保存。**本段是 `terminal-sessions`「renderer 僅以識別碼指定位置」
與 `session-persistence`「持久化不得把路徑詞彙交給 renderer」那條邊界論證的延續，SHALL NOT 因為
座標換了一個落腳處而鬆動** —— 落盤的內容會在**下次啟動時**被解析，一個落盤的路徑等同一個繞過
查表的位置指定，其危害與它當初為了什麼用途而寫入無關。

**這條 SHALL 約束的是磁碟上的內容，因此驗證 SHALL 發生在寫入的入口，SHALL NOT 只發生在讀取時。**
只在讀取時丟棄不合法的值，磁碟上仍然留著它 —— 那條 SHALL 就成了一句沒有人負責的宣稱，而任何
「寫一份合法座標再讀回來」的測試都會通過，不論實作對錯。

錨定的 change 以 slug 保存。**slug 被用於組成檔案路徑時的防護不在本能力**，而是
`openspec-data-access` 既有的白名單查表（只對確實存在於掃描結果中的識別碼呼叫 core）——
換一個落盤位置不改變那條路徑上的任何一步。

**損毀 SHALL NOT 阻止應用程式啟動，且 SHALL NOT 波及 folder 清單。** 整份無法解析或版本不符時
SHALL 隔離該檔案（改名保留，不刪除）並以「所有 folder 皆為預設座標」啟動；**單一維度的值不合法
時 SHALL 只丟棄該維度**，同一筆的其他維度與其他 folder 的座標 SHALL 照常還原。

還原時指向的 folder 已不在 workspace、或工作目錄已不存在時，該維度 SHALL 退回其預設值，
SHALL NOT 使啟動失敗。folder 自 workspace 被移除時，其座標 SHALL 一併被移除。

#### Scenario: 側欄來源跨重啟還原

- **WHEN** 使用者把某個 folder 的側欄來源設為 repoB，關閉並重新開啟應用程式，再選中該 folder
- **THEN** side panel 呈現 repoB

#### Scenario: 錨定的 change 跨重啟還原

- **WHEN** 使用者為某個 folder 明確選擇了一個 change，關閉並重新開啟應用程式，再選中該 folder
- **THEN** 本 change 視圖呈現同一個 change

#### Scenario: 沒有任何 session 的 folder 其座標同樣還原

- **WHEN** 使用者於一個尚無任何 session 的 folder 改變側欄座標，關閉並重新開啟應用程式
- **THEN** 該 folder 的側欄座標與關閉前一致

#### Scenario: 側欄的工作目錄與 session 開啟的工作目錄各自保存

- **WHEN** 某個 folder 的 session 開在 folder 根、而該 folder 的側欄工作目錄為某個 worktree，
  經歷應用程式關閉並重新開啟後該 session 被喚醒
- **THEN** 新的 pty 的工作目錄為 folder 根，而 Files 身分以該 worktree 為樹根

#### Scenario: 落盤的座標不含任何路徑

- **WHEN** renderer 送出一筆工作目錄為路徑形狀（而非不可逆識別碼）的座標，而後檢視落盤的資料
- **THEN** 該值未被寫入磁碟；其餘維度照常保存

#### Scenario: 座標檔損毀不影響 folder 清單

- **WHEN** 側欄座標的持久化檔案內容無法解析，而後啟動應用程式
- **THEN** 應用程式正常啟動、workspace 的 folder 清單完整，所有 folder 的側欄座標為預設值，
  且原座標檔被改名保留

#### Scenario: 單一維度不合法時其餘照常還原

- **WHEN** 某個 folder 的落盤座標中，工作目錄識別碼不合法而來源 repo 合法
- **THEN** 該 folder 的側欄來源照常還原，工作目錄退回 folder 自身

#### Scenario: 來源指向的 folder 已被移除

- **WHEN** 某個 folder 的側欄來源指向 repoB，而 repoB 於應用程式未開啟期間被移出 workspace
- **THEN** 該 folder 的側欄來源退回其自身，且應用程式正常啟動

#### Scenario: 側欄的工作目錄已消失

- **WHEN** 某個 folder 選定了一個 linked worktree 作為側欄的工作目錄，而該 worktree 於應用程式
  未開啟期間被移除
- **THEN** 該 folder 的 Files 身分以 folder 自身為樹根，且應用程式正常啟動

#### Scenario: folder 移除後其座標不再留存

- **WHEN** 使用者將一個曾改動過側欄座標的 folder 自 workspace 移除
- **THEN** 該 folder 的座標自持久化資料中消失

## MODIFIED Requirements

### Requirement: 側欄的來源獨立於 rail 的 focused folder

side panel（OpenSpec 與 Files 兩個身分）所呈現的 repo SHALL 由一個**側欄來源**決定，該來源
SHALL 可與 rail 的 focused folder 不同。terminal（session 分頁、focused session、pty 的顯示）
SHALL NOT 受側欄來源影響 —— 側欄指向另一個 repo 時，terminal 仍呈現 focused folder 的 session。

這解一個 agent 主場才有的情境：在一個 session 裡，`claude` 會 `cd` 到另一個 repo 或拿絕對路徑改
另一個 repo。使用者需要在**不切走正在跑的 agent** 的前提下，讀那個 repo 的 spec 與檔案。

**本要求於該 folder 有無 session 時皆 SHALL 成立** —— 沒有 session 時 terminal 那半本就是空的，
而側欄仍然可以指向任何一個 repo。

#### Scenario: 側欄指向另一個 repo，terminal 不受影響

- **WHEN** rail 上選中的 folder 為 repoA 且其中有正在執行的 session，其側欄來源被設為 repoB
- **THEN** side panel 呈現 repoB 的內容，而 terminal 仍呈現 repoA 的 focused session 與分頁列

### Requirement: 來源指示器可選取任一 folder，並提供回到自身 repo 的捷徑

side panel SHALL 於其頂部呈現一條**來源指示器**，標示當前的側欄來源，並 SHALL 允許使用者將側欄
來源改為 workspace 中的任一 folder。來源指示器的選取 SHALL 可全鍵盤操作（沿用既有選單的紀律），
其文案 SHALL 來自字典（`ui-localization`）。**它 SHALL NOT 因該 folder 尚無 session 而停用。**

當側欄來源指向**非 rail 上選中之 folder** 的 repo 時，來源指示器 SHALL 提供一個一鍵將側欄來源
重置回該選中 folder 的捷徑 —— 這取代了「跟隨/釘住」切換鈕（rail 上選中的 folder 不隨 pty 的 cwd
浮動，故「跟隨」退化為「釘在自身 folder」，一個 toggle 無事可做）。

#### Scenario: 選取另一個 folder 作為側欄來源

- **WHEN** 使用者於來源指示器選擇 workspace 中的另一個 folder
- **THEN** side panel 呈現該 folder 的內容，且該選擇成為 rail 上選中之 folder 的側欄來源

#### Scenario: 一鍵回到自身的 repo

- **WHEN** 側欄來源指向非 rail 上選中之 folder 的 repo，使用者觸發「回到自身 repo」的捷徑
- **THEN** 側欄來源重置為 rail 上選中的那個 folder

#### Scenario: 尚無 session 時來源指示器仍可操作

- **WHEN** 使用者選中一個尚未建立任何 session 的 folder 並觸發來源指示器
- **THEN** 下拉呈現 workspace 的全部 folder 供選取，且該控制項未呈現為停用

### Requirement: 切換側欄來源時重置錨定的 change

使用者切換側欄來源時，**該 folder 座標中**錨定的 change SHALL 被重置。change 的 slug 隸屬於某個
repo（`openspec/changes/<slug>`）—— 沿用舊 repo 的 slug，本 change 視圖會對著一個在新 repo 不
存在的 change 呈現空狀態，看起來像壞掉。重置後由既有的衍生預設接手（新來源 repo 恰有一個 active
change 時呈現它，否則呈現空狀態讓使用者自行挑選）。

#### Scenario: 切換側欄來源後本 change 重置

- **WHEN** 某個 folder 的座標錨定了 repoA 的某個 change，使用者將其側欄來源切至 repoB
- **THEN** 該 folder 不再錨定 repoA 的 change；本 change 視圖依 repoB 的狀態重新解析

## REMOVED Requirements

### Requirement: 側欄來源為 per-session，預設為 session 所屬的 folder

**Reason**: 本 change 的目的正是推翻這條 requirement 的粒度。它把「沒有任何 session 時，側欄來源
SHALL **退回** rail 的 focused folder」定義為一個**唯讀的 fallback** —— 於是側欄的來源指示器與
工作目錄選擇器在尚無 session 的 folder 上皆無法使用，而側欄是一個閱讀工具，不該需要先開一個
terminal 才能用。

per-session 這個粒度當初是由「比照 `anchoredChange` 的自然擴展」推導出來的，而那個類比不成立：
`anchoredChange` per-session 有道理（每個 session 在做不同的 change），側欄**來源**沒有同樣的
道理 —— 它回答的是「我現在要讀哪個 repo」，那是一個與 terminal 無關的問題。

**Migration**: 由 `## ADDED Requirements` 的「側欄座標為 per-folder，不以 session 的存在
為前提」承接，並把工作目錄與錨定的 change 一併納入同一組座標。既有的「切換 focused session 時
side panel 隨之改變」語意由「切換 rail 上選中的項目時座標隨之改變」取代 —— **跟隨的語意保留，
只換跟隨的單位**。持久化由新增的「側欄座標跨應用程式重啟存活」承接（不再隨 session 落盤）。
