## MODIFIED Requirements

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
