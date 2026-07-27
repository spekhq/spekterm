## Context

側欄的座標有三個維度 —— 來源 repo、工作目錄、錨定的 change —— 三者今日都是 **per-session** 的
欄位，住在 `SessionState` 與 `PersistedSession` 裡。`side-panel-source` 的規格把「沒有 session」
定義為一個**唯讀的 fallback**（「退回 rail 的 focused folder」），於是實作把兩個選擇器 gate 在
`focusedId !== null`（`MainStage.tsx:411` 的 `canSelectSource`，`SidePanel` 把同一個值再交給
`canSelectWorktree`）。本 change 把三個維度改基到 folder 層級，那道 gate 隨之消失。

**「per-session 回答不了沒有 session」這件事，codebase 已經自己承認過一次。** `MainStage.tsx:41`
有一個 per-folder 的 `viewing` map，註解寫著「錨定無處可去，改由 folder 持有」，而 `anchorChange`
是一個二分：有 session 走 `sessions.anchorChange`，沒有走 `setViewing`。三個維度中已經有一個長出
了 per-folder 的影子，只因為原本的模型答不出來。

**規格層的滲透比 proposal 初稿估的更深。** 逐條盤點八份 spec 之後找到三件初稿沒有列入的事：

1. **`terminal-sessions` 有一整條「session 可錨定一個 change」的 requirement**（含 5 個 scenario）
   —— 那是「錨定為 per-session」的**根**，本 change 移除的正是它。
2. **它與 `session-persistence` 互相矛盾，而且是既有的。** `terminal-sessions:446` 寫著「錨定關係
   SHALL NOT 持久化 —— session 本身即不跨 app 重啟存活」，而 `session-persistence` 把錨定列為必須
   持久化的事實、還有一條「錨定的 change 一併回來」的 scenario。`session-restore` 加了持久化卻沒
   回寫這一條。本 change 移除該 requirement 時**順手清掉這個矛盾**。
3. **`artifact-continuation` 與 `status-bar` 各有 requirement 以 session 為錨定的主詞** ——
   「新建的 session SHALL 錨定該 change」、「（focused session）它錨定的 change」。兩者在新模型下
   不是「換個說法仍成立」，而是指涉一個不再存在的關係。

## Goals / Non-Goals

**Goals:**

- 沒有 session 的 folder，側欄的來源選擇器與工作目錄選擇器**完全可用**，且選擇跨重啟存活。
- 三個維度歸屬同一層級、同一筆記錄、同一份落盤 —— 消滅「有無 session」這個分歧，而不是替它加規則。
- 不做出讓 issue #5 加不進來的設計。

**Non-Goals:**

- **不實作 #5 的任何部分**（rail 不列出 worktree、不改 rail 的項目結構）。
- **不遷移既有的 per-session 座標**（見 D5）。
- **不改動 `fs.*` 的任何邊界**：座標只決定側欄讀哪裡，可達的位置集合一點都不變。
- **不改「側欄跟隨我在 rail 上的位置」這條語意** —— 只換跟隨的單位。

## Decisions

### D1：座標的鍵是「rail 項目」，三個維度同屬一筆記錄

```
coordinates[<rail 項目識別碼>] = { sourceFolderId?, worktreeKey?, anchoredChange? }
```

今日 rail 項目恰好就是 folder，於是鍵今日等於 folder id。**「鍵是 rail 項目」是刻意的措辭** ——
#5 要做的正是「讓 rail 的項目包含 worktree」，鍵空間屆時是擴充而非重做。

**考慮過而否決的分層方案（B）**：來源 repo 掛 rail 項目，而工作目錄與 change 掛「它們所屬的那個
repo」。B 很有吸引力 —— slug 與工作目錄識別碼**語意上確實隸屬於某個 repo**，掛在該 repo 上會讓
「切換來源時重置」這兩條 requirement 在結構上變得不必要（沒有東西可以被錯誤地帶過去）。

否決它的兩個理由：

- **無來由的跨項目繼承講不清楚。** 站在 A、把側欄指向 B、錨定了 change X；之後把 rail focus 切到
  B —— B 會顯示 X，而使用者從沒有在「站在 B」時選過它。「每個 rail 項目記得自己的視角」一句話
  講得完，B 不行。
  > **但這條理由必須限定在「無來由」三個字上，否則它會與 D8 打架。** D8 要求的正是一次跨項目
  > 寫入（側欄來源指向 B 時開 session，錨定寫進 B 的座標）—— 那不是繼承，而是**使用者的動作本身
  > 就是關於 B 的**（他剛在 B 開了一個 session 去做那個 change）。被否決的是「B 的座標由 A 的
  > 操作**順帶**決定」，不是「使用者可以明確地改動另一個項目的座標」。
- **對 #5 更不友善，而不是更友善。** #5 的 rail worktree 項目，其 Files 樹根的預設是**它自己**。
  B 把工作目錄維度存在 repo 上，於是同一個 repo 的兩個 rail worktree 項目共用一個覆蓋值、互相
  蓋掉。A 沒有這個問題。

**代價一**：「切換來源時重置工作目錄／重置錨定」兩條 requirement **保留**（只換主詞）。那個代價很
便宜，而且它讓「座標是一個整體」這件事在規格上看得見。

**代價二：一個既有行為的靜默退步 —— `viewing` map 的鍵是來源 repo，不是 rail 項目。**

```ts
setViewing((previous) => new Map(previous).set(panelFolder.id, slug))   // MainStage.tsx:186
const explicitAnchor = focusedId ? … : (viewing.get(panelFolder.id) ?? null)   // :174
```

於是**今天（無 session 時）**：站在 A、來源指向 B、點了 B 的 change X → 之後把 rail 切到 B，
**看得到 X**（那筆記在 B 底下）。**改基之後**：X 記在 A 的座標裡，切到 B 只會看到 B 的衍生預設。

**這一格恰好是方案 B 的語意**，而我們選了 A —— 也就是說 A 在這一格上比現況差。接受它的理由：
現況的這個行為是 `viewing` map 一個**沒有被論證過的**實作選擇（它之所以用 `panelFolder.id`，是
因為那是當時手邊唯一有意義的 folder），把它當成要保住的契約會反過來要求採用方案 B 的整組後果。
**但它必須被寫出來** —— 「已知的既有行為靜默退步」正是不該只活在實作者腦中的東西。

### D2：落盤於獨立的 `panel.json`，不進 `workspace.json`

三個維度離開 `sessions.json`，落到使用者資料目錄下一份新的 `panel.json`（版本欄位 + 原子寫 +
損毀改名保留，比照 `workspace.json` / `sessions.json` / `preferences.json`）。

**不與 folder 清單同居的三個理由：**

- **損毀的爆炸半徑。** `parseWorkspace` 是 all-or-nothing —— 任一 folder entry 不合預期就整份丟棄、
  以**空 workspace** 啟動。而 `workspace-folders` 自己把那個結果稱為「最糟的失敗模式」。座標同居
  其中，等於讓一個偏好性質的欄位有機會清空使用者的 repo 清單。（可以把解析改成分層容忍 —— 但那是
  去動一個已經正確的東西，只為了塞進一份不屬於它的資料。）
- **寫入頻率不同種。** folder 清單只在加入／移除／重排時寫；座標**每點一次 change 就寫**。同居
  等於每次錨定都重寫一次那份使用者精心維護的清單。
- **鍵空間（D1）。** folder 陣列的鍵恆為一個 folder；獨立的 map 鍵是一個不透明字串。

**放棄的好處是免費 GC**（folder 移除 → 座標一併消失）。補法見 D12，成本是幾行。

**單筆容忍**：整份 JSON 壞掉 → 隔離原檔、以空 map 啟動（代價只是座標回到預設，不是失去 repo ——
這正是分家的價值）；**單筆 entry 的欄位壞掉 → 只丟掉那個欄位，不影響同筆的其他維度、更不影響
其他 folder**。這是 `parseSessionEntry` 已經在用的姿態（`worktreeKey` 與 `panelWorktreeKey` 各自
獨立驗證），照抄。

### D3：新 IPC namespace `panel`，形狀比照 `terminal.restore` / `terminal.persist`

```
panel.get(): Promise<Record<string, PanelCoordinate>>
panel.persist(coordinates): void        // fire-and-forget，主行程 debounce
```

**不掛在 `folders.*` 之下** —— 那個 namespace 是 workspace 清單的 CRUD，而座標的鍵在 #5 之後就
不再是 folder id 了，掛過去會變成誤導。

**`probe:shell` 的白名單守衛必須一併更新。** 這道守衛在 `panel-drive-and-shell-affordances` 咬過
一次（加了三個 preload 方法卻沒跑 `probe:shell`，白名單帶著兩條紅燈被封存）—— 加 namespace 就是
它存在的理由。

### D4：renderer 側是一個 `PanelCoordinateProvider`，三道閘一個都不能少

兩個消費者（`MainStage`、`StatusBar`）加上 restore／persist 的生命週期，值得一個 provider，形狀
比照 `SessionsProvider`。**而 `SessionsProvider` 踩過的三個坑在這裡原封不動地適用：**

- **落盤 effect 必須有「restore 完成了嗎」的閘。** 首次渲染時座標是空 map —— 少了閘，它會在磁碟
  的資料讀回來**之前**就送出一份空的，把上次的座標全部抹掉。沒有錯誤、沒有訊息。
- **restore 的 setState 必須是合併，不是覆蓋。** restore 是一次非同步 IPC，使用者完全可能在它回來
  之前就動了選擇器 —— 直接覆蓋會讓那次選擇憑空消失。合併規則：**使用者已經動過的鍵保留使用者的**。
- **StrictMode 的 ref 閘**（dev 專屬）—— 少了它 restore 跑兩次。這裡的後果比 sessions 溫和（不會
  變成兩份分頁），但合併規則會被跑兩次，仍應擋掉。

### D5：不做資料遷移，既有座標回到預設一次

`sessions.json` 裡的 `panelFolderId` / `panelWorktreeKey` / `anchoredChange` **不再被讀取**。

**不遷移，因為沒有可信的來源可遷。** 「哪個 session 是 focused」從來不被持久化（`session-persistence`
明文：「**選中的 folder 不被持久化**」），於是「拿哪個 session 的座標當 folder 的座標」沒有正確
答案 —— 而一個猜錯的還原比一個乾淨的預設更難理解（使用者會以為 app 記錯了，而不是「這次重置」）。

實作上把三個欄位自 `PersistedSession` 的 interface 與 `parseSessionEntry` 移除即可：舊檔案裡的那些
鍵在下一次 `replace()` 時自然消失，中間期間也不影響解析（那個 parser 對未知欄位本來就容忍）。

### D6：「回到自身 repo」的「自身」——一個巧合被扶正為定義

`PanelSourceBar` 的 `ownerId` 目前由 `focusedFolder?.id ?? null` 供應（`MainStage.tsx:410`），而
規格說的是「focused session 自身所屬的 folder」。**兩者相等是巧合**：session 一律經
`sessions.forFolder(focusedFolder.id)` 取得，所以 focused session 恆屬於 focused folder。

per-folder 之後，`focusedFolder.id` **就是**座標的鍵，於是它從「碰巧等於」變成「定義本身」——
**prop 的值一行都不用改，改的是它的論證**。

連帶：`ownerId` 不再需要 nullable。`panelFolder` 非 null ⟺ `focusedFolder` 非 null（座標的鍵就是
focused folder，沒選任何 repo 時沒有座標可讀，側欄走既有的空狀態），而 `SidePanel` 只在
`panelFolder` 非 null 時才渲染來源列。

### D7：`terminal-sessions` 的「session 可錨定一個 change」整條移除，其論證遷往 `openspec-panel`

那條 requirement 有兩段內容在新模型下**仍然有價值**，必須有新家而不是隨著移除一起消失：

| 內容 | 去處 |
|---|---|
| 「錨定由使用者建立，SHALL NOT 由系統自 pty 的輸出或標題推測」+ 它那段假陽性／假陰性的論證 | 遷往 `openspec-panel`（change 維度的擁有者） |
| 「恰一個 active change 時的衍生預設 / 多個候選之間不猜」 | **已經在** `openspec-panel` 的「側欄跟隨」requirement 裡，不必搬 |

**而「session 建立時自動錨定」那半整個消失** —— 衍生預設涵蓋了它（見 D9）。

順手清掉的既有矛盾：`terminal-sessions:446` 的「錨定關係 SHALL NOT 持久化」與 `session-persistence`
的「錨定的 change 一併回來」對立，移除該 requirement 即解。

### D8：`artifact-continuation` 的「新建的 session SHALL 錨定該 change」改寫為 folder 維度

「於 change 的來源工作目錄開啟 session」這個入口，其 requirement 明文要求新建的 session 錨定該
change，理由是「否則它成為 focused session 之後，側欄會落入尚無錨定的空狀態」。

per-folder 之後：

- **panelFolder ＝ focusedFolder（常見情形）**：該 change 已經是這個 folder 的錨定（否則側欄不會
  正在顯示它）。要求**自動成立**，不需要任何動作。
- **panelFolder ≠ focusedFolder**：新 session 建在 panelFolder。使用者切 rail focus 過去之後讀到的
  是 **panelFolder 的**座標 —— 因此觸發時要把該 change 寫進 **panelFolder 的座標**。

規格的措辭因此由「新建的 session SHALL 錨定該 change」改為「該 change SHALL 成為該 session 所屬
folder 的錨定」。**意圖不變，機制改變。**

### D9：衍生預設由「半黏著」統一為動態 —— 這是本 change 唯一的行為退步

現況其實**兩種都有**，而且分界很任意：

| 情形 | 現況 |
|---|---|
| 建立 session 的那一刻該 folder **恰有一個** active change | **黏著** —— 固化進 session，其後 active 變多也不變 |
| 建立時是 0 個或多於 1 個 | **動態** —— 走 `soleActiveChangeForPanel`，隨 active change 數浮動 |
| 使用者明確點選過某個 change | 黏著（explicit anchor，不受影響） |

per-folder 之後「建立 session」與側欄座標不再有邏輯關聯（那正是本 change 要消滅的耦合），於是
規則統一為**動態**：尚無明確錨定時，側欄來源 repo 恰有一個 active change 就呈現它。

**退步的具體形狀**：使用者從未明確選過 change、側欄正靠衍生預設顯示唯一的那個 active change，
此時 agent 跑 `/opsx:new` 建了第二個 —— active 變成 2，衍生預設失效，**側欄掉回空狀態**。
而「agent 在旁邊建 change」正是這個 app 的主場。

接受它的理由：黏著需要一個「**何時固化**」的額外裁決（建立 session 時？首次呈現時？選中 folder
時？），而那正是本 change 要消滅的那種分歧 —— 一個需要額外裁決的規則，通常表示模型錯了。且空狀態
本來就會引導使用者去瀏覽視圖選一個，而 agent 剛建好的那個 change 往往正是他要看的。

**已由使用者拍板：採動態。** 判準是「規則數」與「需不需要額外裁決」—— 動態是一條規則、零額外裁決；
黏著是兩條（動態預設 + 固化時機）。而退步的窗口在使用者實際的工作流下很窄：`common-openspec-change`
是「archive 完才開下一個」，active 的軌跡通常是 1 → 0 → 1，不是 1 → 2。

> **「不得固化」必須寫成一條有主詞的禁令，否則它會否定 D8（獨立稽核抓到的 CRITICAL）。**
> 初版寫的是「SHALL NOT **於任何時刻**被固化為明確的錨定」，而續寫入口寫入的那個 change **可能
> 正是衍生預設**（`MainStage.tsx:177` 的 `explicitAnchor ?? soleActiveChangeForPanel`）—— 於是
> 一條絕對的禁令直接否定了 `artifact-continuation`「該 change SHALL 成為新 session 所屬 folder
> 的錨定」。**被禁的是「系統自行挑一個時刻固化」，不是「衍生預設呈現中的 change 不得成為使用者
> 動作的對象」**；規格已改為後者的措辭並明列三個合法的固化來源（Changes 樹、Graph／Timeline、
> 續寫入口的開 session）。
>
> **一般形式：一條「SHALL NOT 在任何時刻 X」的禁令，要先問「誰做 X」** —— 禁掉系統的自作主張是
> 對的，連帶禁掉使用者的明確動作就是錯的，而兩者在字面上分不開。

### D10：邊界論證的承接 —— 落盤的三個欄位各有不同的姿態

`session-persistence` 的「持久化不得把路徑詞彙交給 renderer」明文寫著它涵蓋「落盤資料中的**每一個**
工作目錄事實，包含 session 開啟的工作目錄與**側欄的工作目錄**」。側欄的工作目錄搬家之後，那條的
涵蓋範圍縮小，**而原則本身不得鬆動** —— 它必須由新的規格承接，並明說自己是 `terminal-sessions`
／`session-persistence` 那條邊界論證的延續。（這正是 `session-in-worktree` 的教訓：改一條邊界
論證時，要把所有宣稱自己是它延續的規格一起找出來。）

| 欄位 | 姿態 |
|---|---|
| `worktreeKey` | **不可逆識別碼**，沿用既有的 `isWorktreeKey`（sha1 前 8 碼）驗證。落盤的內容會在**下次啟動時**被解析 —— 一個落盤的路徑等同一個繞過查表的位置指定 |
| — | **驗證發生在寫入的入口，不只在讀取時**（獨立稽核抓到）。`session-store.replace()` 現況是 `...entry` 原樣展開、只檢查 `isUuid(entry.id)`，驗證全在 `parseSessionEntry`（讀）那一側；照抄那個姿態，「落盤不含路徑」這條 SHALL 就沒有人負責，而**任何「寫一份合法值再讀回來」的測試都會通過**。`panelStore` 因此在 `replace()` 入口就套同一個判定 |
| `sourceFolderId` | folder 識別碼（`randomUUID`），本來就不是路徑，renderer 一直合法持有它。指向的 folder 已不在 workspace 時退回自身（既有的 fallback，不變） |
| `anchoredChange` | slug —— **不受信任的輸入，且會被 core 拿去拼接檔案路徑**。防護維持既有的那道：`openspec-service` 先在快取的掃描結果**查表**，只對確實存在的 identifier 呼叫 core。**不新增字元過濾**（黑名單擋不住編碼形式），也不需要 —— 換一個落盤位置不改變那條路徑上的任何一步 |

### D11：孤兒條目由「folder 被移除」清除，不在載入時主動修剪

`folders.remove` 時一併刪掉該 folder 的座標（權威在主行程，它本來就知道 folder 何時被移除）。

**載入時不主動修剪。** 若某次 `workspace.json` 讀取失敗而以空 workspace 啟動，一次主動修剪就會把
**所有**座標刪光 —— 一個可復原的失敗（把設定檔救回來）會因此變成不可復原的。孤兒條目無害：它的鍵
是一個不在 rail 上的 folder，永遠不會被讀到（folder 移除後重新加入會拿到新的 `randomUUID`，不會
意外復活舊座標 —— 那也是對的，「移除即忘記」）。

**刪除以「屬於該 folder 的全部鍵」表達，不以單一鍵精確比對。** 今日兩者等價（鍵就是 folder id），
但 D1 已宣告鍵是一個**不透明字串**且 #5 會擴充它 —— 屆時 `<folderId>:<worktreeKey>` 形式的鍵在
精確比對下會漏刪。寫成前者，#5 到來時這一處不必動。

### D12：落盤節奏 —— 500ms debounce，且關窗／reload 時 flush

錨定 change 是在樹上點一下就發生的高頻動作，沿用 `terminal.persist` 的 500ms debounce。
**而收尾時必須 flush** —— `files-in-worktree` 的探針剛踩過「reload 太快會把這次選擇丟掉，而那個
失敗與『持久化整個沒做』長得一模一樣」。flush 點比照 `ipc/terminal.ts` 既有的兩處。

## Risks / Trade-offs

- **[既有 probe 段落會因為座標跨 session 共用而互相污染]** → per-folder 之後，某段測試把側欄指向
  另一個 repo，**其後每一段站在同一個 folder 上的測試都會看到那個來源**（此前它隨 session 而異，
  換個 session 就回到預設）。`files-in-worktree` 剛踩過一模一樣的坑（要靠 `resetWorktreeToSelf()`
  救回，一次紅 15 條，而其中兩條「不提供入口」反而變成假綠）。**受影響的段落要自己還原，且新段落
  不得假設前面每一段都還原了** —— 新段落自建前置條件。
- **[而衍生預設的驗收會污染的是磁碟，走 UI 的還原助手救不回來]**（獨立稽核抓到）→ 驗「active 由
  1 變 2」必須在磁碟上真的多出一個 change，而 `repo-single` 的 `solo-change` 是**其後與其前數十條
  斷言的前提**（`ANCHORED_SLUG === 'solo-change'`、tasks 進度…）。必須用**專屬的 fixture repo**，
  或於段落結束時把該目錄刪掉 —— 這是與上一條**不同種**的污染，`resetPanelSourceToSelf()` 這類
  助手對它完全無效。
- **[八份 delta 全是 MODIFIED，漏抄的 scenario 會在 archive 時永久遺失]** → 逐條以原文比對；archive
  前跑 `git diff --numstat --no-color -- openspec/specs/` 檢查刪除量（**加 `--no-color`**：這台機器
  的 `color.diff = always` 比 `color.ui` 更具體，`-c color.ui=false` 贏不了它，而顏色碼會讓
  `grep '^-'` 靜默地匹配到 0 個）。
- **[核心驗收「沒有 session 時選擇器可用」極易假綠]** → 那是一條**先前恆為停用**的路徑，「按了沒
  反應」與「按了有反應」在畫面上很接近。**必須有對照組**（把 gate 加回去，斷言變紅），且斷言要驗
  「側欄真的換成另一個 repo 的內容」，不能只驗「選單開起來了」。互動用真事件
  （`Input.dispatchMouseEvent`），並斷言選單的 rect 完整落在 viewport 內。
- **[衍生預設動態化的退步（D9）]** → 已裁決採動態（見 D9）。**驗收時要有一條正面的斷言看著它**
  ——「active 由 1 變 2 之後本 change 視圖呈現空狀態」是規格，不是缺陷，寫下來才不會在下一次
  dogfood 時被當成 bug 修掉。
- **[三個欄位的移除不會有任何編譯錯誤指向遺漏的讀取點]** → `sessions.panelSourceOf` 等三個讀取器
  一併移除，於是漏改的地方會編譯失敗 —— **這是刻意的**：不要保留一個「相容用」的舊介面。
  （比照「新增一個狀態值，TypeScript 一條都攔不下來」的反面：這次要讓型別系統站在我們這邊。）
- **[但 `create` 的第三個參數是個例外 —— 型別系統在那裡幫不上忙]**（獨立稽核抓到）→ 現況是
  `create(folderId, spawnTarget, anchoredChange?: string, worktreeKey?: string)`，移除**中間**那個
  參數之後，`MainStage.tsx:234` 的 `create(panelFolder.id, 'claude', anchoredChange, worktreeKey)`
  若漏改，**slug 會靜默地被當成 worktreeKey 傳下去**（兩者都是 `string | undefined`）。而失效方向
  很惡劣：主行程對查無的工作目錄識別碼是**拒絕建立**，於是「於該工作目錄開啟 session」變成一顆
  沒反應的按鈕。**改為 options 物件**（`create(folderId, spawnTarget, { worktreeKey })`）—— 位置
  參數的同型相鄰是這個 bug 的成因，把它消掉比記得改兩個呼叫點可靠。同型的教訓見 CLAUDE.md 的
  「stub 的旗標比對不可用位置」。
- **[`side-panel-source` 的 Purpose 是一句 `TBD - created by archiving change …` 的 stub]** →
  本 change 把它升格為座標的 umbrella，順手寫成真的（列入 tasks —— delta spec 不承載 Purpose）。

## 實作階段的實測補充

以下三條是實作與驗收期間才浮現的，寫在 design 裡是因為它們會影響下一個人的判斷。

### `session-store.replace()` 是 `...entry` 原樣展開 —— 「座標不隨 session 落盤」光靠移除型別不成立

D10 說「驗證發生在寫入的入口」，我為 `panel-store` 照做了，卻沒想到**既有的 `session-store` 也在
同一條線上**：它只檢查 `isUuid(entry.id)`，其餘欄位原樣展開。於是一個過期的 renderer（或一次沒清
乾淨的重構）送來那三個已移除的欄位，它們**照樣會被寫進 `sessions.json`** —— 而
`session-persistence` 明文要求它們 SHALL NOT 由 session 持久化。

是新增的**負向守衛**紅了才發現的。已改為逐欄位白名單。**教訓：移除一個欄位不等於它不會再出現；
「不接受」要由結構保證，不是由「沒有人再送它」保證。**

### `watcher.on('error', () => {})` 使 watcher 建立失敗與「檔案沒變」無法區分

`openspec-service.ts` 對 watcher 的錯誤是靜默吞掉的。而 `inotify` 的 `max_user_instances` 是
**per-user 的 128**（本機實測已用掉 97），app 每監看一個 folder／工作目錄／檔案樹就吃一個。

**本 change 沒有踩到它**（追查到最後根因是探針自己的變數遮蔽，見下），也不在本 change 的範圍內修
—— 但它是一個真實的靜默失敗模式：workspace 加夠多 repo 之後，側欄可能安靜地停止更新而毫無跡象。
**建議開獨立 issue**（要不要降級為 polling、要不要呈現給使用者，各自需要論證）。

### 追查方向的教訓：先驗最上游的前置條件，再懷疑下游

D9 的驗收紅了四輪。我連續提出三個假設（chokidar 初次掃描的窗口、新目錄看不見、inotify 耗盡），
每一個都言之成理且有旁證，**而真正的根因是探針裡一個變數遮蔽**：`runMode` 的 try 區塊內另有一個
`const derived`（值是輪詢回來的 slug），它遮蔽了 fixture 路徑，於是 `join(derived, …)` 變成相對
路徑，檔案被寫到 repo 的工作目錄去了。

**三輪探針（約 30 分鐘）全花在懷疑產品，而答案在探針行程裡一行 `existsSync` 就有。** CLAUDE.md 的
「把懷疑的中間狀態變成獨立的斷言」我只用在了下游（拆成「資料更新了嗎／視圖重解析了嗎」），沒有
回頭套用到最上游的前置條件（「檔案到底寫出去了嗎」）。那條前置斷言已補進探針。

## Migration Plan

**無資料遷移。** 部署即生效：舊 `sessions.json` 的三個欄位靜默停止被讀取，`panel.json` 不存在時
以空 map 啟動（＝所有 folder 的座標為預設）。

**回退**：本 change 不改變任何檔案格式的既有部分 —— `sessions.json` 的舊欄位仍在（直到下次改寫），
`panel.json` 是新增的。回退到前一版即恢復舊行為，代價是 `panel.json` 被忽略。

## Open Questions

1. ~~衍生預設要動態還是黏著？~~ **已裁決：動態**（見 D9）。
2. **#5 的鍵擴充形狀**：rail 上的 worktree 項目取得自己的一筆座標（鍵為 `<folderId>:<worktreeKey>`
   之類）之後，它與該 repo 的 folder 項目之間要不要有繼承關係？本 change 不決定，只保證鍵是一個
   不透明字串、擴充不必改資料格式。**判準留給 #5 的 dogfood**：使用者若覺得「站到 worktree 上
   側欄該從頭來過」就是獨立，覺得「應該延續我在這個 repo 的視角」就是繼承。
