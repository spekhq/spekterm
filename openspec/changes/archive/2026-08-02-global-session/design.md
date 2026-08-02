# Design — 全域 session

## Context

今日 session 的歸屬是**必然的**：`SessionState.folderId: string`、`PersistedSession.folderId` 驗證
「必為非空字串」、`terminal.create(folderId, …)` 查表拒絕未註冊的 folder、rail 是 folder 的清單而
session 是它的子列。本 change 讓「不隸屬任何 folder」成為一個合法狀態。

好消息是側欄那半早已預留：`side-panel-source` 明文「『rail 上的項目』今日恰為 workspace 的
folder，本要求刻意以項目而非 folder 措辭 —— rail 的項目集合日後可能擴充，屆時座標的歸屬單位隨之
擴充，而非重新設計」。全域項目是那個擴充的第一個實例。

壞消息是「歸屬」這件事滲透在資料模型、落盤格式、rail 版面、快捷鍵序與四個消費側欄座標的能力裡，
而**它的缺席在多數地方不會編譯失敗**。本 design 的重心就是把那些靜默失效的路徑一一釘住。

## Goals / Non-Goals

**Goals:**

- 讓「不隸屬任何 folder 的 session」成為資料模型中的一等狀態，且它的缺席**在編譯期被攔截**，
  而不是靠每個消費點記得處理。
- 邊界論證延伸而不鬆動：renderer 可達的初始工作目錄集合恰好擴大**一個由主行程決定的常數**。
- 側欄座標沿用既有模型 —— 只擴充鍵空間，不新增第二套機制。

**Non-Goals:**

- 讓 `fs.*` 或 Files 檔案樹觸及家目錄（那正是本 change 拒絕的那條路，見 proposal）。
- 多個全域群組、可設定的全域工作目錄。
- rail 把 linked worktree 列為一級項目（issue #5）—— 本 change 只擴充鍵空間，使 #5 到來時是
  再擴充一次，而非重做。

## Decisions

### D1: 執行期用 `folderId: string | null`，落盤用**明確標記**，`panel.json` 用**獨立欄位**

| 層次 | 表示 | 為什麼 |
|---|---|---|
| 執行期型別 | `folderId: string \| null` | 傳參與 Map 鍵會被編譯器攔下（**但比較不會 —— 見下**） |
| `sessions.json` | **明確的標記**（`folderId: null` 顯式寫出） | **不可**用「欄位缺席」，見下 |
| `panel.json` | 與 `coordinates` **並列的獨立欄位** | 鍵空間物理隔離，碰撞在結構上不可能 |

**仍然明確否決 sentinel 字串（例如 `'__global__'` 當 `folderId`）**：那樣型別仍是 `string`，
`folders.find((f) => f.id === folderId)` 靜默回 `undefined`、`forFolder(id)` 靜默回空陣列。

#### D1a: **編譯器只涵蓋一半，另一半必須人工列舉**（獨立稽核抓到，已實測）

初稿宣稱「選 `null` 讓 `dormant` 那次的教訓由編譯器代勞」。**那句話是錯的**，實測（repo 自己的
tsc，`--strict`）：

```ts
declare const a: string | null
declare const b: string | undefined
const x = a === b                     // exit 0 —— 不報錯
const y = arr.find((f) => f.id === a) // exit 0 —— 不報錯
f(a)                                  // TS2345 ✓  只有傳參會紅
map.get(a)                            // TS2345 ✓
```

`string | null` 與 `string | undefined` 有交集（`string`），`===` 因此合法。**而歸屬的消費點絕大
多數是比較，不是傳參**，其中兩處的失效是靜默且嚴重的：

| 位置 | 程式碼 | 全域 session 的後果 |
|---|---|---|
| `MainStage.tsx:382` | `session.folderId === focusedFolder?.id` | `null === undefined` ⇒ false ⇒ **終端永遠不是 active** ⇒ 依「休眠的 session 於首次被顯示時才啟動 pty」，**休眠的全域 session 永遠不會被喚醒**，畫面只是一片空白 |
| `MainStage.tsx:191` | `panelFolder?.id !== displayed.folderId` | D2 那個坑本人 |

**於是 `dormant` 那條教訓原封不動地適用，一個字都不能打折**：加列舉值時要把 `===` 全部 grep 一遍。
tasks 因此有一條**具名的清查**，而不是倚賴「處理每一個編譯錯誤」。

#### D1b: 落盤不可用「欄位缺席」表示全域

初稿說「比照既有慣例『省略工作目錄識別碼 ＝ folder 根』」。**那個類比不成立**：省略 worktree key
的降級目標是同一個 folder 的根（安全、可見）；省略 `folderId` 改變的是 session 的**歸屬**與 cwd
所在的 repo。而 `SessionStore.replace()` 對 `folderId` 不做形狀驗證 —— 一次過期的 renderer 或沒清
乾淨的重構漏掉該欄位，就會讓一個**隸屬於 repo 的 session 靜默變成全域 session**：下次開 app 它出現
在全域項目底下、claude 自家目錄 `--resume` ⇒ 依 D4 第 2 列查無此對話 ⇒ 靜默自癒為全新對話 ⇒
**歷史消失且沒有任何訊號**。

因此全域以**明確標記**表示，「缺席」保持為不合法（丟棄該項，即 `parseSessionEntry` 的既有行為），
且 `replace()` 要對 `folderId` 加形狀驗證。

#### D1c: `panel.json` 的鍵空間用結構隔離，不用格式假設

初稿的前提是「folder id 由 `randomUUID()` 產生，恆為 UUID 形狀」。**該前提實測為假**，而
codebase 早就寫著相反的事 —— `panel-store.ts:55` 的註解：

> `sourceFolderId` —— folder 識別碼，**不對格式設限**（它由 `workspace-store` 產生 `randomUUID`，
> 但**探針與手動設定的 workspace 會用可讀的識別碼**；驗成 UUID 會把那些一律丟掉）

`workspace-store.ts:84` 的 `parseWorkspace()` 也只檢查 `typeof id !== 'string'`。於是一個 id 恰為
保留字的 folder 會與全域項目**共用同一組側欄座標**，且 `PanelStore.remove()` 的 `key === folderId`
會在移除該 folder 時**順手刪掉全域項目的座標**。

初稿提議的單元測試（「保留鍵不得為合法 UUID 形狀」）**測的是錯的東西** —— 它只證明 `global` 不像
`randomUUID()` 的產物，擋不住任何一個叫 `global` 的 folder。

**正解是物理隔離**：全域座標存在與 `coordinates` **並列**的獨立欄位，不進那個鍵空間。碰撞於是不是
「被測試擋住」，而是**表達不出來**。

> **一般形式：一個「由測試釘住的格式假設」不如一個「使不變式無法被違反的結構」。** 前者的失效方式
> 是「測試恆綠而假設早已改變」—— 這次連 codebase 的註解都已經寫著假設是假的，而我沒去讀它。

### D2: `null === null` —— 續寫入口會**錯誤地啟用**，而這是本 change 最危險的一個坑

`artifact-continuation` 的條件 1 是「側欄來源等於 focused session 自身所屬的 folder」。樸素的實作：

```ts
panelSource === session.folderId          // 全域 session: null === null ⇒ true  ❌
```

全域 session 的 `folderId` 是 `null`，而全域項目的側欄來源**預設也是未選定（null）** ⇒ 兩者相等
⇒ **入口亮起來** ⇒ `/opsx:continue <slug>` 被送進一個站在家目錄的 agent ⇒ 它在**家目錄**建出一個
空的 change。

**判準必須先問這個 session 是不是全域的**，而不是讓兩個缺席值互相比較 —— 全域 session 沒有
「自身所屬的 folder」，條件 1 對它**恆不成立**，不是「碰巧成立」。

> **修正一則過度自信的斷言**（獨立稽核指出）：初稿把「誤**啟用**」寫成確定的失效方向，並據此
> 宣稱它比 `session-in-worktree` 那次的誤停用「嚴重得多」。**實際方向取決於兩端各自的正規化**——
> 現行程式碼是 `panelFolder?.id !== displayed.folderId`，左邊為 `undefined`、右邊將為 `null`，
> 於是**現行形狀下反而是誤停用並回報錯誤的原因**。結論（先問是不是全域）不變，但這個坑的正確
> 描述是：**它的方向不確定，而不確定本身就是不可接受的** —— 一個取決於「今天恰好用 `?.` 還是
> `??`」的安全判定，會在下一次無關的重構中翻面，而兩個方向各有各的壞。

同一個形狀要在每個「比較兩個可能缺席的識別碼」的地方檢查一次。**不可只列舉已知的幾處，必須
grep 全部**（見 D1a —— 這正是編譯器涵蓋不到的那一半）。已知的至少有：`status-bar` 的
「側欄來源 ≠ rail 選中的 folder 時才標示」、`MainStage.tsx:382` 的 active／wake 判準。

### D3: 工作目錄依 spawn 目標分工，且**兩道夾制都要處理**

沿用 `session-persistence` 既有的分工，不發明新規則：

| spawn 目標 | 工作目錄來源 | 全域 session 的結果 |
|---|---|---|
| shell | 最後已知的（觀測 `/proc/<pid>/cwd`） | 記錄並重生於該處，**不做路徑夾制**，僅存在性檢查 |
| claude | **建立時所選定的**（查表，不觀測） | 恆為家目錄 |

**不夾制的理由**（proposal 已裁決，此處只補正當性的來源）：既有夾制的正當性來自 session **宣稱
自己屬於某個 folder**；全域 session 沒有這個宣稱，家目錄是它的**起點**而非**邊界**。夾制在這裡
唯一的效果是「`cd /var/log` 之後重開 app 莫名跳回家目錄」。

**而「兩道夾制只放寬一道等於沒放寬」是 `session-in-worktree` 已經踩過的**：`#initialCwd`（重建側）
與 `cwdOf()`（**記錄側**）是獨立的兩道，共用同一個判定。只改重建側的話，全域 shell session 的
cwd **從一開始就不會被寫進 `sessions.json`** —— 重建側收到 `undefined`，一切看起來正常，而失效
方向是靜默的。本 change 兩道都要改，且改的是同一個判定函式。

### D4: `claude --resume` 的位置相依性 —— 三條實測

`session-in-worktree` 已知「resume 的查找是 git repo 關聯的」。本 change 讓對話開在**家目錄**
（非 git repo），因此重驗一次：

| # | 情境 | 結果 |
|---|---|---|
| 1 | 對話開在 `$HOME`（非 git repo），自 `$HOME` 續接 | ✅ 答出暗號 |
| 2 | 同一個對話，自 `~/git/spekterm`（git repo）續接 | ❌ `No conversation found with session ID: …` |
| 3 | 同上失敗情境的 exit code | **1**（非零） |

- **第 1 條使本設計成立**：家目錄本身不是 git repo 並不妨礙續接 —— 同一個目錄就找得到。
- **第 2 條證明 D3 的分工是承重的，不是美學**：若 claude 目標也「回到最後觀測到的 cwd」，使用者在
  全域 agent 裡 `cd` 進任一 git repo 再重開 app，就會從那個 repo 去續接一個開在家目錄的對話 ——
  查無此對話。既有分工天然避開它。
- **第 3 條確認降級方向安全**：非零碼 ⇒ 產品既有的「3 秒內非零碼即判定續接失敗」會觸發 ⇒ 自癒為
  全新對話，而不是留下一個死掉的 session。

> 實測方法的一則附記：第一次量 exit code 時我把輸出 pipe 給 `tail`，讀到的是 `tail` 的 exit code
> （0），差點記成「失敗時回 0，自癒不會觸發」。**這正是 CLAUDE.md 記過的坑**，重量一次才拿到 1。

### D5: 為什麼不是獨立的 IPC `createGlobal(target)`

`create` 只是**一個**接縫。session 的其餘部分 —— focus 的 per-item 記憶、分頁順序、rail 子列、
持久化、狀態列脈絡、側欄座標的鍵 —— 全都需要表達「這個 session 屬於誰」。歸屬因此必須進資料模型；
只在 create 那裡分岔，等於把同一個概念表達兩次，而兩者會在某一次改動時失去同步。

### D6: 邊界論證的延伸形狀

`terminal-sessions` 的保證是「renderer 可達的初始工作目錄集合，由結構保證而非字串驗證」。本 change
之後：

```
可達集合 = ∪(每個 folder 所屬 repo 的工作目錄列舉)  ∪  { os.homedir() }
                                                        ↑
                                    主行程的常數，renderer 沒有任何參數能影響它
```

renderer 至多送出「這是一個全域 session」這件事（一個布林意義的區分，不是一個值）。**沒有新的路徑
詞彙、沒有新的識別碼空間、沒有新的查表。** 這與工作目錄識別碼那次不同：那次 renderer 獲得了一個
可選的識別碼，因此需要「不可逆 + 查表 + 查無即拒絕」三道；這次 renderer 什麼都選不了。

**推論：全域 session 的建立 SHALL 拒絕工作目錄識別碼。** 它沒有 repo 可查表，一個送進來的識別碼
只能是錯的 —— 比照既有的「查無對應即拒絕，不靜默退回」。

### D7: rail 的項目序與拖曳的落點

- 全域項目恆為 rail 的**第一項**，與 folder 清單之間有視覺分隔。
- `Ctrl+↑↓` 的循環序為 `[全域, folder₁, …, folderₙ]`，回到頂端時循環到最後一個 folder。
- `Shift+↑↓` 選中全域項目時**無操作**（它不是 workspace 的成員，沒有順序可言）。**不是**「移動它
  但不持久化」，也**不是**把它與第一個 folder 交換。
- **拖曳排序的索引必須繼續以 folder 清單為基準**，不可以 rail 的 DOM 列位置為基準 —— 多出來的那
  一列會讓每個索引 off-by-one。CLAUDE.md 記著一個**既有的** off-by-one（拖曳往下放時落在指示線
  的下一格）之所以躲過每一輪驗收，正是因為「兩個項目時兩種語意結果相同」。這裡的風險同型：
  workspace 只有一個 folder 時，off-by-one 看不出來。

`folders.reorder` 以識別碼定位（非位置），全域項目不在 folder 清單裡，因此 IPC 那側天然不受影響 ——
風險全在 renderer 的落點計算。

### D8: rail「選中哪個項目」的表示 —— `null` 已經被「沒有選中」佔用

`useWorkspaceFolders.ts` 的 `selectedId` 是 `string | null`，而 **`null` ＝ 沒有選中任何項目**
（`KeyboardNavigation` 的 `if (!selectedId) return`、`StatusBar` 的 `!folder ⇒ noRepo` 空狀態、
`Ctrl+T` 的 no-op 條件全都靠它）。若比照 session 用 `null` 表示全域，同一個值就有兩義。

**裁決：rail 的選中狀態改為 discriminated union**（`{ kind: 'global' } | { kind: 'folder'; id: string }`，
外層仍可為 `null` ＝ 未選中）。這是**唯一**一處刻意不沿用「`null` ＝ 全域」的地方，理由是那個位置
的 `null` 早有別的意思 —— 而 sentinel 字串在這裡同樣不可接受（它會靜默流進每一個 `folders.find`）。

**它比 `SessionState.folderId` 更早被讀到**（rail、快捷鍵、狀態列、側欄座標都先問「選中的是誰」），
因此排在實作順序的最前面。

### D9: 全域 session 的工作目錄**會**被送往 renderer —— 修正一句過強的規格

初稿在 `global-session` 寫「該工作目錄 SHALL NOT 送往 renderer」，並在 proposal 宣稱「renderer
全程沒有看到它」。**那句話對持久化成立，對狀態列不成立**（獨立稽核抓到）：`terminal.ts` 的
`liveCwdOf()` → `SessionStatusService#tick()` → `contents.send(…, { cwd })` 一直在送，狀態列要
顯示它，而那條路徑的註解自陳「未經 folder 邊界夾制……使用者 `cd` 到 workspace 之外，狀態列就該
誠實地說他在那裡」。

**裁決**：規格收窄為「**持久化的**工作目錄 SHALL NOT 送往 renderer」（那才是 `session-persistence`
那條的延續），並誠實記錄代價：

- **`fs.*` 的可達集合完全沒變** —— renderer 拿到的是一個顯示字串，不是可定址的詞彙（`folder.path`
  早已同樣送給 renderer）。proposal 的核心安全論證不受影響。
- **但路徑的揭露面確實擴大了**：家目錄與其後使用者 `cd` 到的任何位置，第一次成為**常態**地被送往
  renderer 的內容。這與既有 `liveCwdOf` 的取捨同源（誠實性優先），只是頻率從例外變成日常。

**不因此收回誠實性**：一個顯示「我不知道你在哪」的狀態列，比顯示真實 cwd 更糟。

### D10: 全域 session 的 cwd 為家目錄時**跳過 git 狀態偵測**

`agent-status.ts` 的 `readGitWorkingState()` 用 **`spawnSync`** 跑 `git status --porcelain=v2`，
由 `SessionStatusService` **每 2 秒**對 focused session 呼叫一次。dotfiles-as-git-repo 是常見設定
—— 全域 session 一 focus，主行程就每兩秒在整個家目錄上跑一次 `git status`（遍歷 `node_modules`、
快取、掛載點），而 **`spawnSync` 期間主行程的訊息迴圈是停住的**：IPC 不回應、pty 資料轉發延遲，
症狀是「整個 app 每兩秒卡一下」。此前這條路徑要使用者自己 `cd` 出去才走得到，本 change 之後它是
全域 session 的**預設**。

**裁決：cwd 恰為家目錄時不偵測 git 狀態**（使用者裁決）。理由不只是成本 —— 「整個家目錄的 dirty
狀態」對使用者本來就沒有意義。一旦 `cd` 進真正的 repo，狀態照常呈現。

**明確不做**：把 `spawnSync` 改成非同步。那是既有行為的改寫（任何大 repo 都會卡），超出本 change
的範圍，且要重新處理 tick 的並發控制 —— 值得獨立處理。

### D11: 來源未選定時 OpenSpec 身分**可用**

`MainStage.tsx:74` 是 `const openSpecEnabled = panelFolder?.hasOpenSpec ?? false`，於是全域項目
（無 panelFolder）會使 OpenSpec 身分**停用並強制退回 Files** —— 那讓本 change 新寫的 OpenSpec
空狀態**永遠到不了**（獨立稽核抓到的 CRITICAL）。

**裁決：來源未選定時 OpenSpec 身分可用**（使用者裁決），它要呈現的正是「請選一個 repo」。
`workspace-layout` 的「OpenSpec 為條件式身分」因此要納入 delta —— 停用的條件收窄為「**來源已選定
且**該 repo 不含 `openspec/`」。

**這與「rail SHALL NOT 呈現不可操作的控制項」同源**：一個可點、點了會告訴你怎麼辦的入口，勝過一個
停用而不說明為什麼的入口。

### D12: 冷啟動時全域項目**不預設選中**

`session-persistence` 的休眠條款其論證是「**選中的 folder 不被持久化**，因此冷啟動當下沒有任何
folder 被選中，也就沒有任何 session 被啟動」——「開 app 只起一個 claude，不是 N 個一起搶 CPU」正是
`session-restore` 花力氣換來的。

加入一個**恆常存在**的 rail 項目之後，「預設選中它」變成極其自然的實作，而那會讓冷啟動**立刻喚醒**
全域項目的 focused session ⇒ 開 app 就 spawn 一個 claude。

**裁決：不預設選中**，冷啟動維持「沒有任何項目被選中」。代價是使用者要多按一下，換來的是那條休眠
論證原封不動地成立。**這要寫進規格**，否則它只是一個沒有人守著的實作細節。

## Risks / Trade-offs

- **`null` 會讓許多消費點編譯失敗，這是設計意圖而非副作用。** 代價是這個 change 的改動面比看起來
  廣（每個 `forFolder` / `focusedIdFor` / `countFor` 的呼叫點都要決定全域項目怎麼辦）。**接受** ——
  替代方案是 sentinel 字串，而它把同樣的工作量換成了靜默失效。
- **rail 多一列固定項目**，workspace folder 很多時它佔掉一行。**接受**：它是恆常入口，且反過來
  讓「workspace 一個 folder 都沒有」時的 rail 不再是純空狀態。
- **使用者可能期待全域 session 也能用 Files 瀏覽家目錄。** 明確不提供 —— 側欄的 Files 身分恆以某個
  workspace folder 為根。這是本 change 的核心取捨，需要在 UI 的空狀態文案裡說清楚**為什麼**沒有，
  而不是留一塊沉默的空白。
- **`panel.json` 保留鍵與 folder id 形式的耦合**（D1）—— 以單元測試釘住，不倚賴記憶。
- **本 change 不觸及 `filesystem-access`、CSP、導航防護。** 若實作過程中發現需要動它們，那是設計
  走偏的訊號，應回頭檢視而非放寬。

## Open Questions

- 全域項目的**標籤與圖示**：標籤走字典（`ui-localization`），圖示需與 folder 的資料夾圖示明顯區隔。
  文案在 specs 階段定，圖示於實作時定。
- 全域項目的 session 子列**預設展開或收合** —— 傾向與 folder 列一致，於實作時對齊既有行為。
- **主舞台 header 對全域項目呈現什麼**（既有為 `folder.name` + `folder.path`）—— 至少要有一個
  與 repo header 明顯不同的形態，於實作時定，但**不得沿用「尚未選擇 repo」的既有空狀態文案**
  （那句話在叫使用者去做一件他已經做了的事）。

> **已關閉**：「側欄的空狀態文案要不要主動提示可以選一個 repo」—— specs 已寫成 SHALL（
> `openspec-panel` 與 `file-explorer` 各一條）。留著它會讓實作者以為還有裁量空間。
