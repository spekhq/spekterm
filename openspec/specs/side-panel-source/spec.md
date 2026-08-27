# side-panel-source Specification

## Purpose

**側欄座標** —— side panel 站在 rail 的某個項目上時，看的是什麼。

座標有三個維度：**來源 repo**（本能力）、**工作目錄**（`side-panel-worktree`）、**錨定的 change**
（`openspec-panel`）。三者同屬一筆記錄、隸屬於 **rail 上的項目**（workspace 的 folder，
以及 `global-session` 那個不隸屬任何 folder 的全域項目），
**不隸屬於任何 session** —— 側欄是一個閱讀工具，要求使用者先開一個 terminal 才能選要讀什麼，是把
兩件無關的事綁在一起。本能力另負責整組座標的持久化。

核心情境是 agent 主場才有的：在一個 session 裡 `claude` 會 `cd` 到另一個 repo 或拿絕對路徑改另一個
repo，而使用者需要在**不切走正在跑的 agent** 的前提下讀那個 repo 的 spec 與檔案。terminal 那半
因此完全不受側欄來源影響。

## Requirements
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

### Requirement: 側欄座標為 per-folder，不以 session 的存在為前提

側欄座標 SHALL 隸屬於 **rail 上的項目**，SHALL NOT 隸屬於任何 session。它由三個維度組成 ——
**來源 repo**、**工作目錄**（見 `side-panel-worktree`）、**錨定的 change**（見 `openspec-panel`）。
使用者切換 rail 上選中的項目時，side panel SHALL 呈現新項目的座標。

**任一維度的可改變性 SHALL NOT 以「該項目是否已有 session」為條件。** 側欄是一個閱讀工具 ——
要求使用者先開一個 terminal 才能選擇要讀什麼，是把兩件無關的事綁在一起。

座標的預設值：來源 repo 為**該項目自身**，工作目錄為 **folder 自身**，change 為**無明確錨定**
（由 `openspec-panel` 的衍生預設接手）。

**「該項目自身」對不隸屬任何 repo 的 rail 項目無定義**，此類項目（今日為 `global-session` 的全域
項目）其來源 repo 的預設值 SHALL 為**未選定**。「未選定」是座標的一個合法狀態，SHALL NOT 以
workspace 中任一 folder 頂替 —— 頂替會讓使用者看見一個他沒有選過的 repo，而他無從得知那是預設
還是他自己先前的選擇。此狀態下的呈現由 `openspec-panel` 與 `file-explorer` 各自定義。

**工作目錄與 change 兩個維度隸屬於「來源 repo」，不是隸屬於 rail 項目自身的 repo** —— 工作目錄
識別碼與 change slug 都是某個 repo 內部的座標。這是「切換側欄來源時重置」那兩條要求的理由，
也是它們**只**重置這兩個維度、不重置來源本身的理由。來源為未選定時，這兩個維度同樣無所依附，
SHALL 一併為未選定。

**「rail 上的項目」今日為 workspace 的 folder 與全域項目**，本要求刻意以項目而非 folder 措辭 ——
rail 的項目集合日後可能再擴充（例如納入 linked worktree），屆時座標的歸屬單位隨之擴充，而非重新
設計。

**全域項目的座標 SHALL 存放於與 folder 座標分離的鍵空間**，SHALL NOT 以某個保留字串作為 folder
座標鍵空間中的一個鍵。**理由是那個不變式必須由結構保證，而不是由格式假設保證**：folder 識別碼
**不受格式約束**（`parseWorkspace` 只檢查它是字串，而探針與手寫的 workspace 一向使用可讀的識別
碼），因此一個識別碼恰為該保留字的 folder 會與全域項目共用同一組座標，且移除該 folder 會連帶
刪掉全域項目的座標。分離鍵空間之後，這個碰撞**表達不出來**，而不是「被一條測試擋住」。

同一個 rail 項目的多個 session SHALL 共用該項目的座標。這是本粒度的**明確取捨**：換來的是
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

#### Scenario: 全域項目的來源預設為未選定

- **WHEN** 使用者選中全域項目，而其側欄座標未曾被改動
- **THEN** 側欄來源為未選定，且 side panel 不呈現 workspace 中任何 folder 的內容

#### Scenario: 全域項目可選取任一 repo 為來源

- **WHEN** 使用者選中全域項目並於來源指示器選擇一個 folder
- **THEN** side panel 呈現該 folder 的內容

#### Scenario: 切換 rail 上選中的項目時座標隨之改變

- **WHEN** 兩個 folder 的側欄來源指向不同的 repo，使用者於 rail 上由其中一個切換至另一個
- **THEN** side panel 呈現新選中項目的側欄來源所指的 repo

#### Scenario: 全域項目的座標與 folder 的座標互不干擾

- **WHEN** 使用者為全域項目選擇 repoA 為來源，切換至某個 folder（其來源為它自身），再切回全域項目
- **THEN** side panel 呈現 repoA，且該 folder 的座標未被改變

#### Scenario: 同一個 rail 項目的不同 session 共用同一組座標

- **WHEN** 某個 rail 項目的側欄來源被設為 repoB，使用者於該項目內切換 focused session
- **THEN** side panel 仍呈現 repoB

#### Scenario: folder 的識別碼恰為保留字時座標仍互不覆蓋

- **WHEN** workspace 中存在一個識別碼恰等於全域項目保留字的 folder，兩者各自設定了不同的側欄來源
- **THEN** 兩者的座標互不覆蓋，且移除該 folder 不影響全域項目的座標

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

### Requirement: 來源指示器可選取任一 folder，並提供回到自身 repo 的捷徑

side panel SHALL 於其頂部呈現一條**來源指示器**，標示當前的側欄來源，並 SHALL 允許使用者將側欄
來源改為 workspace 中的任一 folder。來源指示器的選取 SHALL 可全鍵盤操作（沿用既有選單的紀律），
其文案 SHALL 來自字典（`ui-localization`）。**它 SHALL NOT 因該 folder 尚無 session 而停用。**

當側欄來源指向**非 rail 上選中之 folder** 的 repo 時，來源指示器 SHALL 提供一個一鍵將側欄來源
重置回該選中 folder 的捷徑 —— 這取代了「跟隨/釘住」切換鈕（rail 上選中的 folder 不隨 pty 的 cwd
浮動，故「跟隨」退化為「釘在自身 folder」，一個 toggle 無事可做）。

**選中的 rail 項目不具備自身 repo 時**（今日為 `global-session` 的全域項目），該捷徑 SHALL NOT
呈現 —— 它沒有可回去的目的地，而 `workspace-layout` 明文要求 rail 與其控制項 SHALL NOT 呈現不可
操作的控制項。

**此時來源指示器 SHALL 提供一個「清除來源」的捷徑**，使側欄來源回到**未選定**。少了它，
「未選定」就是一條單向道：使用者一旦選了來源便再也回不去，而未選定正是 `openspec-panel` 與
`file-explorer` 兩條空狀態要求唯一的入口 —— 它們會變成只在使用者從未動過指示器時可見。

**該捷徑 SHALL 與「回到自身 repo」置於同一位置、採同一形式，且 SHALL 使用同一個圖示**
（兩者互斥呈現）。它們是同一個動作的兩種面貌 ——「回到這個 rail 項目的預設座標」，差別只在
預設是「自身」還是「未選定」，而**那個差別屬於 `aria-label` 與 tooltip，不屬於圖示**：
兩個不同的圖示會把一個動作說成兩件事，使用者的心智模型隨之分岔。
**SHALL NOT 只作為下拉選單中的一個項目**：那會讓兩個語意相同的動作一個是按鈕、一個藏在選單裡，
而藏起來的那個使用者找不到（dogfood 回饋）。

#### Scenario: 選取另一個 folder 作為側欄來源

- **WHEN** 使用者於來源指示器選擇 workspace 中的另一個 folder
- **THEN** side panel 呈現該 folder 的內容，且該選擇成為 rail 上選中之項目的側欄來源

#### Scenario: 一鍵回到自身的 repo

- **WHEN** 側欄來源指向非 rail 上選中之 folder 的 repo，使用者觸發「回到自身 repo」的捷徑
- **THEN** 側欄來源重置為 rail 上選中的那個 folder

#### Scenario: 全域項目不呈現回到自身 repo 的捷徑

- **WHEN** 使用者選中全域項目並為它選定了某個 folder 作為側欄來源，然後觸發來源指示器
- **THEN** 不呈現「回到自身 repo」的捷徑

#### Scenario: 全域項目可將來源清回未選定

- **WHEN** 使用者選中全域項目、已選定某個 folder 作為來源，然後觸發來源列上的「清除來源」捷徑
- **THEN** 側欄來源回到未選定，且 side panel 呈現其空狀態

#### Scenario: 清除來源的捷徑與回到自身採同一形式與同一圖示

- **WHEN** 分別檢視「側欄來源指向別的 repo 的 folder」與「已選定來源的全域項目」兩種情形
- **THEN** 兩者各自於來源列上呈現一個同位置、同形式的捷徑，且**兩者的圖示相同**
- **AND** 皆非僅存在於下拉選單之中

#### Scenario: 尚無 session 時來源指示器仍可操作

- **WHEN** 使用者選中一個尚未建立任何 session 的 folder 並觸發來源指示器
- **THEN** 下拉呈現 workspace 的全部 folder 供選取，且該控制項未呈現為停用

### Requirement: OpenSpec 與 Files 兩個身分共用同一個側欄來源

side panel 的 OpenSpec 與 Files 兩個身分 SHALL 共用同一個側欄來源。切換身分 SHALL NOT 改變側欄
來源所指的 repo。

Files 身分的檔案樹是單一 repo 的階層結構，本就一次只能呈現一個來源 —— 這也是側欄採「選一個
repo」而非「聚合多個 repo」的決定性理由：若 OpenSpec 聚合而 Files 只能選一個，兩個身分的來源
語意就會分裂。

**本要求的作用域為 repo 維度。** 側欄來源另有一個工作目錄維度（見 `side-panel-worktree`），
而該維度**不受本要求約束** —— OpenSpec 身分聚合該 repo 的全部工作目錄，Files 身分則選定其中
一個。上述「分裂」的論證在該維度不適用，因為兩件事的價值恰好相反：

- 聚合多個 **repo** 的 change 沒有意義（那是不同的專案）；聚合同一個 repo **各工作目錄**的
  change 有意義，且那正是 `worktree-aggregation` 的價值主張（一次看見全部進行中的 change）。
- 反過來，聚合同一組檔案的多個版本毫無意義 —— 那是同一棵樹疊在一起。

於是工作目錄維度的分裂是**既存事實而非新引入**：`worktree-aggregation` 之後，現況已是
「OpenSpec 聚合、Files 恆為 folder 自身」，`side-panel-worktree` 只是把 Files 那一側的「選哪
一個」由寫死改為使用者可控，分裂的程度並未改變。

#### Scenario: 切換身分不改變側欄來源

- **WHEN** 側欄來源指向 repoB，使用者於 OpenSpec 與 Files 身分之間切換
- **THEN** 兩個身分皆呈現 repoB 的內容

#### Scenario: 切換身分不改變已選定的工作目錄

- **WHEN** Files 身分選定了某個 worktree，使用者切至 OpenSpec 身分後再切回
- **THEN** Files 身分仍以該 worktree 為樹根

#### Scenario: OpenSpec 身分不因 Files 選定工作目錄而收窄

- **WHEN** Files 身分選定了某個 worktree，使用者切至 OpenSpec 身分
- **THEN** OpenSpec 身分仍聚合呈現該 repo 全部工作目錄的 change，而非僅該 worktree 的

### Requirement: 切換側欄來源時重置錨定的 change

使用者切換側欄來源時，**該 folder 座標中**錨定的 change SHALL 被重置。change 的 slug 隸屬於某個
repo（`openspec/changes/<slug>`）—— 沿用舊 repo 的 slug，本 change 視圖會對著一個在新 repo 不
存在的 change，看起來像壞掉。重置後由既有的衍生預設接手（新來源 repo 恰有一個 active change 時
呈現它，**否則本 change 視圖與其入口不呈現**，使用者於瀏覽視圖自行挑選）。

#### Scenario: 切換側欄來源後本 change 重置

- **WHEN** 某個 folder 的座標錨定了 repoA 的某個 change，使用者將其側欄來源切至 repoB
- **THEN** 該 folder 不再錨定 repoA 的 change；本 change 視圖依 repoB 的狀態重新解析

### Requirement: 落盤內容降級的驗收，其鑑別力由同一份內容中的合法條目提供

凡「落盤的座標不再有效時退回預設」這一類條款，其驗收 SHALL 以**構造的落盤內容**進行，且該內容
SHALL 在不合法的條目之外**另含一筆合法且非預設的條目**，並一併斷言後者確實被還原。

**理由是這一類條款的被觀察值恰好就是預設值**：「退回自身」與「整份落盤內容根本沒有被讀取」在
畫面上完全相同。少了合法那一筆，一個從不讀取該檔案的實作會通過每一條這樣的斷言 —— 而它的失效
是靜默的（使用者的側欄座標全部無聲回到預設，看起來只像「我上次沒設過」）。

兩條並列才構成判準：

- **合法那筆被還原** ⇒ 該檔案確實被讀取了
- **不合法那筆退回預設** ⇒ 是**那一筆**被丟棄，而不是整份被忽略

**此要求與既有的「還原前的值必須是非預設的」不是同一條。** 後者涵蓋的是**經 UI 設值再重新載入**
的情境（被觀察值本身即非預設，因此自帶鑑別力）；本要求涵蓋的是**構造落盤內容**的情境，其結構
相反 —— 被觀察值本身就是預設值，鑑別力必須另外買。

**驗收 SHALL 一併斷言應用程式正常啟動**，該條款的後半句本就如此要求；不合法的落盤內容使啟動
失敗時，其餘斷言會以「等不到掛載」的形式失敗，與判定錯誤在輸出上不易區分。

#### Scenario: 構造的落盤內容另含一筆合法條目

- **WHEN** 驗證「來源指向的 folder 已被移除」
- **THEN** 該次驗收所構造的落盤內容中，除指向不存在 folder 的那一筆外，另含一筆指向真實存在
  之 folder 的來源
- **AND** 驗收一併斷言後者確實被還原

#### Scenario: 該驗收一併斷言應用程式正常啟動

- **WHEN** 承上
- **THEN** 驗收明確斷言應用程式完成掛載，而非僅由其後的斷言隱含

### Requirement: 來源指示器的候選依 folder 名稱排序

來源指示器的下拉 SHALL 依 folder 名稱以不分大小寫的字母序（a–z）呈現候選，SHALL NOT 沿用 rail 上的順序。

兩份順序服務兩件不同的事：rail 的順序由使用者拖曳而來，表達的是「哪些常用、放在上面」；下拉是一份**查找**用的清單，使用者心裡已經有一個名字。以 rail 的順序呈現，等於要求他在二十幾個 repo 中線性掃描一份只有他自己知道規則的排列。

排序 SHALL NOT 改變 rail 的順序，兩者互不影響。

#### Scenario: 下拉的候選為字母序

- **WHEN** workspace 中的 folder 於 rail 上並非按名稱排列，使用者觸發來源指示器
- **THEN** 下拉的候選依 folder 名稱由 a 至 z 呈現，與 rail 上的順序無關

#### Scenario: 下拉的排序不影響 rail

- **WHEN** 使用者開啟並關閉來源指示器的下拉
- **THEN** rail 上的 folder 順序不變
