## Context

三件既有的事實決定了這個 change 的形狀：

- **`create()` 只收 `folderId`，而那是刻意的結構保證**（`terminal.ts:256` 的 doc）：
  「renderer 在語彙上無從把初始 cwd 指向 workspace 之外」。`SpawnOptions.cwd` 存在，但它
  **只由主行程的持久化層供應**，renderer 呼叫得到的 IPC 從來沒有這個參數。
- **`#initialCwd` 以 `isWithin(folderPath, cwd)` 夾制** —— 邊界外的 worktree（`/tmp/...`）
  通不過，邊界內的（`<repo>/.claude/worktrees/<slug>`）通得過。
- **`refreshCwd` 明文 `if (session.spawnTarget !== 'shell') continue`** —— claude session 的
  cwd 從來不被持久化。

而 `--resume` 的查找是 **git repo 關聯**的（proposal 已記實測）：cwd 換到同 repo 的另一個工作
目錄仍找得到對話。**這讓「猜錯 worktree」的下場從資料遺失降級為「站錯地方」** —— 錯誤處理因此
可以簡單。

## Goals / Non-Goals

**Goals:**

- session 可開在 folder 所屬 repo 的任一 linked worktree（含邊界外），兩種 spawn 目標皆然。
- renderer 仍然**沒有任何詞彙**可以表達一個任意路徑。
- session 記住它開在哪個工作目錄，重建時回到那裡。
- 續寫入口在 worktree 的 change 上真的可用。

**Non-Goals:**

- **rail 把 worktree 列為一級項目**（issue #5）。本 change 只給一個最小入口，不動 rail 的呈現、
  不動 side panel 來源的粒度、不動鍵盤導航。
- **worktree 的建立／移除**。這個 app 不管 git 的操作，agent 與使用者自己在終端裡做。
- **pty 內的行為受限**。cwd 的邊界只約束**初始**工作目錄，這條立場不變。

## Decisions

### D1：入口是「續寫入口停用時的那句話」，不是 spawn 選單多一層

**選側欄，不選 spawn 選單。**

| | |
|---|---|
| **spawn 選單加一層** | 選單從 2 項變成 2×N 項（或兩層）。使用者要**記得 worktree 的名字**才知道選哪個；單一工作目錄的 repo 平白多一層噪音；`Ctrl+T` 的鍵盤路徑也要跟著長出一層 |
| **側欄的 change 觸發**（採用） | 使用者的真實情境就是「我在側欄看到這個 change，想驅動它」——**上下文已經完整**，不必記名字；而它正好落在使用者現在會撞到的那面牆上 |

具體形式：`foreignWorktree` 這個停用說明**本身變成可觸發的入口**（「在該工作目錄開一個 session」）。
按下去開一個 claude session、cwd 在該 change 的來源工作目錄；其後續寫入口自然可用。

**不把兩件事併成一顆按鈕**（開 session 並自動送出續寫指令）—— 那讓一次點擊做兩件可獨立失敗的事，
而使用者無從得知是哪一件壞了。開 session 是一個他看得見結果的動作，指令由他自己再按一次。

### D2：`worktreeKey` 守得住原本由「不傳路徑」保證的邊界 —— 但保證的形式換了

原本：**renderer 沒有路徑詞彙** ⇒ 它表達不出 workspace 之外的位置。
現在：**renderer 傳一個不可逆的識別碼，主行程在 git 的列舉結果裡查表** ⇒ 可達的路徑集合恆等於
「該 folder 所屬 repo 的工作目錄集合」。

**三個前提保護的是三件不同的事，不要捆成一個「強度」**（稽核指出的 —— 我原本寫成「缺一不可」，
那是錯誤的推理）：

| 前提 | 它實際擔保什麼 | 破壞它會怎樣 |
|---|---|---|
| **解析是查表，不是拼接** | **圍堵性** | 可達集合不再受限於列舉結果 ⇒ 邊界失守 |
| **集合的來源是 git 的列舉** | **圍堵性** | 同上 |
| key 不可逆（sha1 前 8 碼） | **路徑不外洩到 renderer**（`openspec-data-access` 既有的要求） | 洩漏絕對路徑，但**可達集合一點也不會變大** —— 查表照樣把它限制在列舉結果內 |
| 查無此 key **即拒絕**，不 fallback | **誠實性** | 退回 folder 根**逸出不了**任何邊界（那是舊邊界之內），但使用者會以為 session 開在他選的工作目錄裡 |

**為什麼要分清楚**：日後任何一條被鬆動時，得能判斷「這會不會破壞邊界」。有人為了 debug 想在 key
裡塞分支名 —— 那破壞的是「不外洩」，圍堵性毫髮無傷；有人想加一個 fallback —— 那破壞的是誠實性，
同樣不影響圍堵性。**捆成一句「缺一不可」就沒有判準可用了**，而 CLAUDE.md 反覆記的正是
「要問的是**失效時會怎樣**」。

**圍堵性的部分與 `openspec-data-access` 的 slug／topic 白名單同構** —— 那裡的結論是「查表比檢查
有沒有 `..` 強，因為後者是黑名單」。同一條論證在這裡成立。

> **仍要在 spec 裡明寫「SHALL NOT 接受路徑」。** 新增一個識別碼參數不等於開放路徑參數，而
> requirement 若只寫「以 worktreeKey 指定」，下一個人可能覺得「那順便收一個 cwd 也還好」。

> **`session-persistence` 的「持久化不得把路徑詞彙交給 renderer」明文宣告自己是這條論證的延續，
> 所以它必須一起改**（稽核抓到的 CRITICAL —— 第一版漏了它）。不改的話，主 spec 會同時存在
> 「renderer 以 folderId + 工作目錄識別碼指定位置」與「renderer SHALL NOT 能指定任何 session 的
> 工作目錄」兩條 SHALL，而下一個人以哪一條為準是不可預測的。**改一條邊界論證時，要把所有宣稱
> 自己是它延續的規格一起找出來。**

### D3：續寫入口的第 4 個條件**不取消，改判準** —— proposal 這一項是錯的

proposal 照 issue 寫著「該條件可以取消」。**實作前的調查推翻了它。**

`foreignWorktree` 現在的判準是 `worktree.isFolderRoot` ——「來源與 session 所屬的 **folder** 是不是
同一個工作目錄」。本 change 之後，**session 的工作目錄不再恆等於 folder 根**，於是：

| 情形 | 條件取消的話 | 正確的行為 |
|---|---|---|
| change 在 worktree A、session 開在 worktree A | 可用 ✔ | 可用 ✔ |
| change 在 worktree A、session 開在 folder 根 | **誤判為可用** ✘ | 停用 |
| change 在 worktree A、session 開在 worktree B | **誤判為可用** ✘ | 停用 |

**取消它會讓 agent 在錯的工作目錄建出一個同名的空 change** —— 那正是這個條件當初存在的理由，
而本 change 讓「錯的地方」多了一種。判準因此要從「來源 vs folder」改為
「**來源 vs focused session 的實際工作目錄**」。

**但「拿兩個 key 對比」是會出錯的寫法**（稽核抓到的）：**開在 folder 根的 session 沒有 key**，
而 folder 本身就是 linked worktree 時，**它自己的 change 帶著 key**（`#origin` 恆填 `key`，
不論 `isFolderRoot`）。於是 `undefined === '0ceceaeb'` 為假 ⇒ 入口被錯誤停用 ⇒ 打破一條**本
change 刻意保留**的 scenario（「folder 本身是 linked worktree 時入口可用」），而 `probe:openspec`
已經在守它。正確的形式是**兩段式**：

```
session 有 worktreeKey ? origin.key === session.worktreeKey : origin.isFolderRoot
```

「沒有 key」的語意是「開在 folder 根」，而那正是 `isFolderRoot` 回答的問題 —— 舊判準沒有消失，
它降級成了新判準的一個分支。

> **一般形式**：一個條件之所以成立，往往依賴某個當時為真的**巧合**（這裡是「session 的 cwd 恆為
> folder 根」）。當那個巧合被打破時，該條件通常**不是變得多餘，而是需要更精確的判準**。
> `side-panel-repo-anchor` 拆 `MainStage` 的 `folder` prop 時是同一個形狀。

### D4：claude session 的 cwd **由 `worktreeKey` 決定，不從 `/proc` 讀**

claude session 的 pty cwd 不會漂移（agent 的 `cd` 發生在子行程裡，動不到 pty 自己的 cwd）——
它恆等於 spawn 時的位置，而那個位置我們**已經知道**（`worktreeKey`）。於是不必為它放寬
`refreshCwd`，重建時以 key 重新解析即可。

**shell 則相反**：使用者真的會 `cd`。它繼續讀 `/proc`，但夾制要放寬（D5）。

> proposal 說「cwd 的持久化涵蓋 claude 目標」—— 那個描述在**結果**上對（claude session 重生會
> 回到原處），但**手段**不是放寬 `refreshCwd`。以 key 解析比讀 `/proc` 更準：它記錄的是使用者
> 的**意圖**（我要在這個 worktree 開），而不是某個時刻的觀測值。

### D5：shell 的 cwd 夾制放寬為「工作目錄集合的任一個之下」

現行 `isWithin(folderPath, cwd)` 對邊界外的 worktree 為假 —— 於是「手動 `cd` 到 `/tmp` 的
worktree、關 app 再開」會靜默退回 folder 根（proposal 記的既存缺陷）。

放寬為：cwd 落在 **folder 根**之下，或**該 repo 任一工作目錄根**之下。仍然是夾制，不是放行 ——
`cd /etc` 之後重建照樣退回 folder 根。

### D6：worktree 消失時退回 folder 根，且**不需要特別的補救**

`--resume` 跨工作目錄可用（實測），所以退回根目錄**不會丟對話** —— 這是 issue 當初擔心的事，
已證偽。重建時 key 查無對應工作目錄即以 folder 根開啟，如同一個普通的 session。

### D7：session 仍然屬於同一個 folder

`PersistedSession.folderId` 不變，`worktreeKey` 是它的一個附加屬性（比照 `anchoredChange` /
`panelFolderId`）。rail 的 session 子列照常掛在該 folder 底下 —— **worktree 不會因此成為 rail 的
一級項目**，那是 #5。

**這條界線是本 change 能收斂的原因**：它只動「pty 開在哪裡」，不動「workspace 由什麼組成」。

## Risks / Trade-offs

- **[分不清 session 開在哪]** 同一個 folder 底下若有多個 session、分別在不同工作目錄，**分頁上**
  看不出差別。**狀態列已經涵蓋 focused session**（`status-bar` 的既有 requirement：「位於 linked
  worktree 時 SHALL 呈現該 worktree 的名稱」，`StatusBar.tsx` 已實作）—— 真正的缺口只在**分頁列**
  的非 focused 項目。
  → **本 change 不做**：它需要自己的 requirement（分頁標籤的呈現規則），而那是一條使用者可見
  行為，不該只活在 Risks 裡。**留待 dogfood 判斷缺口有多痛** —— 若真的痛，它更可能與 #5
  （rail 把 worktree 列為一級項目）一起解，那時分頁的歸屬本來就要重想。

- **[key 過期]** `worktreeKey` 存在 `sessions.json` 裡，而 worktree 可能在 app 沒開的時候被移除
  → D6 已處理（查無即退回 folder 根）。但**同一個路徑被重建**時 key 相同（sha1 of path），於是
  會正確地重新指向它 —— 那是想要的行為。

- **[解析的來源必須與側欄同源，而「在 IPC 層解析」不會自己成立]**（稽核抓到的）
  terminal 服務不該去 import OpenSpec 服務 —— 這個方向是對的，但**光說「在 IPC 層解析」不可執行**：
  `OpenSpecService` 的實例住在 `ipc/openspec.ts` 的**模組私有 Map**（key 是 `webContents.id`），
  沒有 export，`registerTerminalHandlers` 拿不到它。而**改為直接呼叫 core 的 `listWorkspaces`
  會破壞 D2 的保證**：它的預設是 **`includeJj: true`**，而 `OpenSpecService` 用的是
  `includeJj: false` ⇒ **可達的位置集合會比側欄列舉出來的大**（多出 jj workspace），
  而 D2 說的是「恆等於」。
  → **裁決：導出一個以 `folderId` + key 解析路徑的存取器**，內部走與側欄同一個
  `OpenSpecService` 實例與同一組參數。`terminal-sessions` 的 delta 已把「同源且同參數」寫成
  requirement，不是實作偏好。
  → 連帶要想的兩件事：走 `OpenSpecService` 會**順手建立 watcher**（副作用），且可能回**快取**
  （於是「key 查得到、但路徑已消失」是真實情形，見下）。

- **[「key 查得到、但路徑已消失」在兩條路徑上的行為必須不同]** `#initialCwd` 目前在 `statSync`
  失敗時**靜默退回 folder 根**。**建立**時這麼做違反 spec（「SHALL NOT 退回 folder 根」）；
  **重建**時這麼做卻正是 D6 要的。同一個函式，兩條路徑的行為不同 —— 實作上要能區分，
  不可讓建立路徑沿用重建路徑的寬容。

- **[folder 是 repo 子目錄時，可達集合會含入 folder 的父目錄]**（稽核抓到的）
  `listWorkspaces` 是對 **repo** 作答的（CLAUDE.md 已記過這個行為切換）。folder ＝
  `<repo>/subdir` 時，主工作目錄那筆的路徑是 `<repo>` —— 它是 folder 的**祖先**，而放寬前
  renderer 不可能把 session 開在那裡。
  → **接受**：pty 本來就不是沙箱（`terminal-sessions` 的既有立場），而 `<repo>` 是使用者自己
  加進來的那個 folder 所屬的 repo，不是任意位置。**但這是本 change 唯一一處讓可達位置涵蓋
  folder 祖先的地方**，寫在這裡免得下一個人重新推導 —— 而使用者加子目錄的動機常常正是
  「我只想看這一塊」，若 dogfood 覺得意外，收斂的方式是把祖先自可選清單濾掉（不是改夾制）。

- **[熱路徑的成本]** 每次 `create` / `wake` 都要一次工作目錄列舉。這與 `workspace-folders`
  「rail 的偵測 SHALL NOT 呼叫任何外部程式」**不衝突** —— 那條的對象是「每個 folder、每次載入」
  的熱路徑；這裡是使用者明確的單次動作，比照 `agent-status` 的「單點可 spawn」先例。

- **[`probe:terminal` 的 fixture 不是 git repo]**（`/tmp` 下的暫存目錄）—— worktree 相關的驗收
  必須自己建 git repo 與 worktree，比照 `probe:openspec` 的 `makeWorktreeFixture()`。
  **沒有 worktree 時 core 回空陣列**，於是任何「在 worktree 開 session」的斷言都會靜默地驗不到
  它自稱在驗的東西（`openspec-worktree-aggregation` 記過的頭號假綠來源）。

## Open Questions

- **入口的文案與位置細節**（按鈕在停用說明裡，還是取代它？）留給實作，dogfood 再調。
- **shell 目標要不要也提供這個入口？** 目前 D1 的入口開的是 claude session（續寫的情境）。
  「在這個 worktree 開一個 shell」是合理的需求，但它更像 #5 的地盤 —— 本 change 不做，
  除非 dogfood 指出它是剛需。
