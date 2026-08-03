# terminal-unicode-width — Design

## Context

終端判定「一個字元佔幾個 cell」時用的是 xterm 內建的 **Unicode 6** 寬度表（實測
`term.unicode.versions === ["6"]`，且無法以選項換掉 —— xterm 核心只註冊這一份）。而 pty 裡的
程式（claude、`ls`、任何做表格對齊的工具）依現代 wcwidth 排版，emoji 是兩格。兩邊對同一段位元組
的寬度認定不同，**每個 emoji 就讓那一行少一格**。

這條缺陷自 Phase 4 終端誕生起就在。它與 `terminal-sessions` 既有的「終端的字格渲染獨立於字型的
glyph 幾何」**相鄰但不同層**：

| | 管什麼 | 由誰決定 |
|---|---|---|
| 既有那條 | 一個 cell **內**怎麼畫（框線相接、粗細一致） | renderer（程式化繪製 vs glyph） |
| **本 change** | 一個字元佔**幾個** cell | core 的寬度表（renderer 無關） |

先前兩次針對「表格破版」的調查（`terminal-rendering-and-preferences` 收行高、
`terminal-gpu-renderer` 上 webgl）都只動了上面那一列，因此都沒有碰到這條。

**約束**：xterm 封裝於單一 wrapper（`src/renderer/src/shell/terminal/xterm.ts`），renderer 其餘模組
不直接 import `@xterm/*`。本 change 不改變這條約束，改動全部落在該檔案與 `package.json`。

## Goals / Non-Goals

**Goals:**

- 終端對字元寬度的判定與 pty 內程式所依據的現代 wcwidth 一致，**含以 VS16 組成的 grapheme
  cluster**（`⚠️` ＝ `U+26A0`＋`U+FE0F`）。
- 寬度表在**任何內容寫入之前**就已生效 —— 包含 `session-restore` 重播的歷史快照。
- 寬度表若未如預期生效，**要能被察覺**，不得靜默退回內建 v6。

**Non-Goals:**

- **不宣稱修好「捲動時破版」。** 本 change 修的是一個**靜態**的寬度缺陷；proposal 已記錄一個尚未
  解釋的觀察（使用者回報 resize 後會恢復，而靜態缺陷不該如此）。若 dogfood 確認仍破，第二個因素
  成立、另案處理。
- **不新增使用者可見的設定**（見 D3）。
- **不改變任何信任邊界、IPC 形狀或持久化格式。** 這是純 renderer 的終端呈現變更；
  `filesystem-access`、`session-persistence` 的資料格式一條未動。
- 不處理終端「字型缺字」造成的視覺問題（那是 fallback 字型的 glyph 幾何，另一層）。

## Decisions

### D1：採 `@xterm/addon-unicode-graphemes`，不採 `addon-unicode11` —— 差別是結構性的，不是版本新舊

**判準為寫入後的 `buffer.active.cursorX`（實際佔用的 cell 數），環境比照產品的 renderer 設定
（見 D8 —— 這一點是承重的）。** 案例集按**類別**組織，不是按實例。

**「期望」欄不是規範推論，是實測 agent 的排版。** 讓 `claude` 畫一張框線表格，自分隔線取欄寬、
逐列數前導與尾隨空格，反推它為每個符號保留幾格（原始文字經終端的複製路徑取得，非截圖）。
七列中有五列是已知值的對照組（`AB`＝2、`東京`＝4、`✅`＝2、`🚀`＝2、`⚠️`＝2），全部符合，
因此其餘兩列可採信：

| 類別 | 例 | **claude 排版** | 內建 v6 | `unicode11` | `graphemes` |
|---|---|---|---|---|---|
| BMP CJK | `一` U+4E00、`㐀` U+3400 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| 星形平面 CJK 擴充 B/C/D | U+20000、U+2A700、U+2B740 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| BMP emoji | `✅` U+2705 | 2 | **1 ✗** | 2 ✓ | 2 ✓ |
| 星形平面 emoji | `🚀` U+1F680 | 2 | **1 ✗** | 2 ✓ | 2 ✓ |
| 半形／全形對照 | `ﾊ` U+FF8A／`Ａ` U+FF21 | 1／2 | ✓ | ✓ | ✓ |
| **基底＋VS16** | `⚠️` U+26A0+FE0F、`ℹ️` U+2139+FE0F | 2 | **1 ✗** | **1 ✗** | 2 ✓ |
| **ZWJ 序列** | `👨‍👩‍👧` | 2 | **3 ✗** | **6 ✗** | 2 ✓ |
| **膚色修飾** | `👍🏽` U+1F44D+1F3FD | 2 | 2 ✓（碰巧） | **4 ✗** | 2 ✓ |

**`graphemes` 十三個案例全過，且是與 agent 的實際排版對齊，不是與某個規範的詮釋對齊。**

**`unicode11` 錯四類，且錯的方向是量級上的** —— ZWJ 家庭判成 **6 格**（三個 emoji 各算兩格，
它看不出 ZWJ 把它們連成一個 cluster）、膚色修飾判成 **4 格**。這比現況更糟：現況只是**少**一格，
它是**多**四格，會把後續內容推得更開。

**兩個容易被誤讀的格子：**

- **內建 v6 對星形平面 CJK 是正確的（2 格）。** 它的缺陷限於 emoji，不是「整個星形平面沒有資料」——
  後者是 D8 那個受污染環境的產物，先前的表誤記為 `1 ✗`，此處更正。
- **內建 v6 對膚色修飾「碰巧」正確。** 它把 `👍`(U+1F44D) 與膚色修飾符(U+1F3FD) 各算一格，
  相加得 2 —— 答案對，理由全錯。**一個只用這個案例的驗收會給現況發綠燈**，這正是 spec 要求
  按類別涵蓋、且禁止以個別字元推論整體的原因。

**為什麼升版本結構上到不了那四類。** `U+26A0` 本身是 ambiguous —— 單看它，任何版本的寬度表都回 1。
它成為兩格，是因為後隨的 VS16 把它推進 emoji presentation，而**那是 cluster 層的事實，不是任何
單一 code point 的屬性**。ZWJ 與膚色修飾同理：它們都是「多個 code point 合起來算一個字」。
查表式的實作**沒有地方可以表達這件事**，因此「先用比較小的 `unicode11`，之後有需要再換」不是一條
可行的退路 —— 那四類永遠修不好。

> **這張表原本只有兩格（`✅` 與 `⚠️`），而那兩格恰好是 graphemes 佔優的地方。** 獨立稽核把案例集
> 擴到星形平面後一度得出**相反**的結論（graphemes 把整個星形平面判成一格），我以同一種環境「獨立
> 驗證」也得到同一個結果 —— 兩次測試看似互相印證，實則是同一個環境陷阱的兩次重演（見 D8）。
>
> **兩條教訓要分開記，因為它們各自獨立成立**：(a) 案例集要涵蓋**類別**而不是實例 —— 原本那張兩格
> 的表即使結論碰巧正確，它也支撐不起「嚴格較優」這個宣稱；(b) 測試環境與產品環境的差異，會讓一個
> upstream bug 偽裝成選型缺陷。

*Alternatives considered:*

- **自己註冊一份寬度 provider**（xterm 的 unicode API 允許）：等於自己維護一份 Unicode 寬度表與
  grapheme 分段規則，那是會隨 Unicode 版本過期的東西，且**過期的樣子是一個看起來很正常的錯誤對齊**。
  否決，理由與「不維護模型 → context window 對照表」（`claude-status-bridge`）同型。
- **不修，改為要求 agent 不要輸出 emoji**：控制不了，且 emoji 是 agent 輸出的常態。

### D2：`allowProposedApi: true` 是硬性前提，不是可選的加強

實測：未開啟時 **`loadAddon()` 當場拋錯**（`You must set the allowProposedApi option to true to use
proposed API`），不是等到讀 `term.unicode` 才拋。因此沒有「載入了但沒生效」的中間狀態 —— 這對我們
有利，失效方向是**吵的**而不是靜默的。

**代價要說清楚**：這個選項是一刀切的，開了之後 xterm 的**所有** proposed API 都可存取，而 proposed
API 依 xterm 的政策可在 minor 版本間改變。緩解有三層：

1. **xterm 版本本來就釘死**（`@xterm/xterm 6.0.0`），升級是一次明確的動作，不會被動漂移。
2. **接觸面收斂在 wrapper 的一處**（`createXterm` 內設定寬度表），renderer 其餘模組拿不到 `Terminal`
   實例，不可能在別處用到 proposed API。
3. **升級 xterm 時的檢查清單**：本 change 會把「unicode 寬度表仍生效」納入驗收，於是升級後若該 API
   改變，驗收會紅。

*Alternative considered:* 繞過 proposed API、直接改 `term._core.unicodeService` —— 那是私有欄位，
比 proposed API 更不穩定，且失效時**靜默**。否決。

### D3：不新增使用者可見的開關

`terminal-preferences` 有一顆「關閉 GPU 加速」的開關，直覺會想比照辦理。**但那顆開關存在的理由不
適用於此**：GPU 的自動降級只擋得住「渲染資源取不到」，擋不住「取得了但驅動畫錯」—— 後者**只有
使用者看得出來**，所以必須給他一個關掉的方法。

字元寬度沒有這種失效模式：它是確定性的，不依賴驅動、不依賴 GPU、不依賴字型是否缺字。加一顆開關
就必須回答「什麼時候該關」，而唯一想得到的情境是「pty 內某個程式仍用舊 wcwidth 排版」—— 那是罕見
的老工具，而 claude 是這個 app 的主場。**為一個沒有好答案的問題提供一個旋鈕，是把判斷推給使用者。**

此裁決與 `session-title-authority`（移除「pty 想改名要問過」）、`side-panel-repo-anchor`（取消
「跟隨/釘住」toggle）同源：**一個答案可預測的選擇不該被做成選項。**

*此裁決有前提*：若日後出現「一部分輸出用新 wcwidth、一部分用舊」而使用者需要逐 session 切換的實例，
本裁決失效 —— 屆時 xterm 的 unicode API 本來就支援執行期切換版本，加一顆開關的成本很低。

### D4：啟用的版本要明確指名，且指名不到時**必須是一個吵的失敗**

addon 註冊後 `term.unicode.versions` 實測為 `["6", "15", "15-graphemes"]`。有兩種選法：

- **取陣列最後一個** —— addon 升級自動跟上，但「最後一個」不是 API 保證的語意，順序是註冊順序的
  副產品；哪天順序變了就會**靜默地**選到 `"15"`（於是 `⚠️` 那一半悄悄壞回去）。
- **寫死想要的版本字串** —— 意圖明確，但 addon 改名（例如未來的 `16-graphemes`）時會指名不到。

採**寫死＋明確失敗**：指名的版本不在 `versions` 內時，SHALL NOT 靜默沿用內建 v6。

**但這道門的價值比初稿宣稱的小得多，必須說清楚，否則它會取代真正的防線。** 實測 xterm 已經自己
守了兩道：

1. `UnicodeService` 的 `activeVersion` setter **本來就會拋錯**（`if (!this._providers[v]) throw`）。
2. `UnicodeGraphemesAddon.activate()` **自己就把 `activeVersion` 設成 `'15-graphemes'`** —— 產品
   甚至不必指名版本。

所以「指名的版本不存在 ⇒ 靜默沿用 v6」這條路**在樸素實作下就不存在**。抽出純函式仍有價值，但理由
要縮小為：**擋住上面那個「取陣列最後一個」的替代方案**（那才是真的會靜默選錯的寫法）。

**而真正會靜默失敗的失效模式不是這個。** 它是：addon 載入成功、版本啟用成功、`versions` 三個都在，
**寬度表卻對我們在乎的字元給出錯的答案** —— D8 的 #6079 正是這樣的實例，而 D1 那張只有兩格的表
也差點以另一種方式落入同一類。

一般形式（本 repo 已多次踩到）：**「版本字串在不在清單裡」是「寬度對不對」的代理判準，而代理會過、
真的性質會敗。** 因此本 change 的**主要**驗收是「一組代表性字元的 cell 佔用逐一符合現代 wcwidth」
（spec 有對應的 requirement 與 scenario），版本字串那條降為次要。

### D5：寬度表必須在**任何寫入之前**生效 —— 包含重播的歷史

`session-restore` 重建 session 時會把上次的畫面快照 `write()` 回終端。若寬度表在那之後才啟用，
那段歷史會以 v6 排版**寫進 buffer**，而 buffer 裡的 cell 佔用是寫入當下決定的、事後換寬度表不會
重排。使用者會看到「歷史是歪的、新輸出是對的」。

因此設定寬度表的位置是 `createXterm()` 內、`new Terminal()` 之後、把手回傳之前 —— 早於 `open()`，
也早於 `replay()` 與任何 live 串流。這在現行結構下是自然的（其餘 addon 也在那裡載入），但它是
**承重的順序**，不是風格問題。

### D6：驗收管道 —— 既有的「複製路徑」對這條**沒有鑑別力**，必須換

CLAUDE.md 記載的三條 renderer-agnostic 觀測管道中，「畫面內容走產品自己的複製路徑」是既定作法。
**但它驗不到這條，而且我在調查中親自被它騙過**：

> 使用者複製給我的破版內容**每一欄都對齊**，我因此宣稱「buffer 是對的，純渲染問題」。錯了 ——
> 複製是把 cell 轉回字串，emoji 少佔一格但**字元序列完全不變**，貼出來當然是齊的。

一個「不論修沒修都通過」的斷言比沒有斷言更糟。改用**幾何**判準：

- 以產品自己的路徑關閉 GPU 加速（`terminal-preferences` 既有的開關）→ DOM renderer 下每個 row 有
  可量測的 span。
- 寫入一組「同寬度的 emoji 行 / 純 ASCII 行 / 框線行」，斷言**三者的右緣 x 相等**。
- **對照組是強制的**：移除寬度表設定後，emoji 行必須偏移約一個 cell 寬而使斷言變紅。

**為什麼在 DOM renderer 下驗到就夠**：寬度表住在 core 的 `unicodeService`，決定的是 buffer 的 cell
佔用，**兩個 renderer 讀的是同一份 buffer**。這一點與既有那條「軟體渲染路徑證明得了資源生命週期、
證明不了畫素」的限制**不同**：那條的對象是畫素，只有真實驅動看得出來；這條的對象是 cell 佔用，
是確定性的資料，DOM 下量到就是量到。此區別要寫進 spec，否則下一個人會以為這裡也有同樣的驗收缺口。

### D7：效能 —— 含 emoji 的寫入約 **+5%**，接受

**初次量測不具資訊量，已重做。** 那一版每個組態只跑一次、用兩個不同的 `Terminal` 實例（狀態
不對等）、`scrollback: 100` 配 4000 行輸入，結果純 ASCII 跑出 **−37%** —— 而 grapheme 判定不可能
讓純 ASCII 變快，於是雜訊的量級已知**大於**效果。在那個雜訊下，「沒有觀察到退步」和「比較快」
一樣都是資料撐不住的話。

重做的版本：同一實例每輪重建（量完即 dispose）、每組 **n=9 取中位數**、`scrollback` 用產品值 5000。

| 4000 行 | 內建 v6（中位數／範圍） | graphemes（中位數／範圍） | 差異 |
|---|---|---|---|
| 純 ASCII（262 KB） | 32.5 ms ／ 27.3–44.5 | 32.1 ms ／ 27.9–42.8 | **−1.2%**（雜訊內） |
| 含 emoji（199 KB） | 32.7 ms ／ 29.3–43.7 | 34.2 ms ／ **33.2–36.2** | **+4.6%** |

**結論：含 emoji 的輸出有約 5% 的寫入成本（4000 行約多 1.5 ms），純 ASCII 沒有成本。** 接受 ——
這個量級遠低於一次 pty 往返，且 agent 的輸出瓶頸不在解析。

兩件事讓這個結論可信而非又一次的雜訊：graphemes／含 emoji 那一組的範圍**最窄**（33.2–36.2，
其餘三組都跨 15 ms 以上）；而「純 ASCII 無成本」與 provider 的原始碼一致 —— 它對
`32 ≤ codepoint < 127` 有一條 fast path 直接回傳常數。**那條 fast path 也正是初次量測會跑出
−37% 假象的原因**：ASCII 本來就沒有額外工作，剩下的全是雜訊。

### D8：量測 xterm 行為的 harness，其 `webPreferences` 必須比照產品 —— 否則測到的是另一條程式碼路徑

**這條是本 change 代價最高的一課，兩個獨立的人（作者與稽核）先後踩進同一個坑並互相印證了錯誤結論。**

最小重現最初開了 `nodeIntegration: true`，動機純粹是方便（要用 `ipcRenderer` 把結果送回主行程）。
而 upstream [#6079](https://github.com/xtermjs/xterm.js/issues/6079)（2026-07-28 提出，未修）指出：
`addon-unicode-graphemes` 在模組載入時解碼其 Unicode trie，讀 header 時 `new DataView(data.buffer)`
**漏了 `data.byteOffset`**。在 Node 中 `Buffer.from(str,'base64')` 可能回傳**共用 pool 的一個 view**，
於是 `highStart` 等欄位讀到的是前面殘留的位元組 —— 而 `highStart` 損壞的典型後果，正是**超過它的
碼位全部落回預設值**，也就是整個星形平面。

該 issue 明載此路徑 **"Not reachable from the browser build"**：沒有 `Buffer` 全域時 addon 走 `atob`
分支，那條路徑一律從 offset 0 配置。實測對照（同一份案例集、同一台機器、只差這個選項）：

| harness 的 `nodeIntegration` | `typeof Buffer` | 星形平面 CJK／emoji |
|---|---|---|
| `true`（最初的 harness） | `object` | **1 格 ✗（整片）** |
| `false`（**產品的設定**，`src/main/index.ts`） | `undefined` | 2 格 ✓ |

**產品不受此 bug 影響**（`contextIsolation: true` / `nodeIntegration: false`），因此它不構成選型的
理由 —— 但它構成一條**紀律**：

- 量測第三方套件行為的 harness，其 `webPreferences` SHALL 比照產品；為了方便而放寬的每一項，都
  可能換掉受測物實際走的分支。
- **兩次獨立測試得到同一個錯誤結果，不構成佐證** —— 若它們共用同一個環境假設，那只是同一個錯誤
  被執行了兩次。救回這件事的不是第三次測試，是去讀 upstream issue 的最後一段。

*連帶*：任何日後在 **Node 環境**驗證寬度的嘗試（`@xterm/headless` 的單元測試、CI 腳本）**會**踩到
#6079，且失效方式是靜默的錯誤寬度。見 Risks。

## Risks / Trade-offs

- **[proposed API 在 xterm 升級時改變]** → 版本釘死 + 接觸面收斂於 wrapper 一處 + 驗收會紅（D2）。
- **[指名的 unicode 版本字串在 addon 升級後不存在]** → 明確失敗而非靜默降級（D4）。這是本 change
  最重要的一道防線：靜默降級的結果與「完全沒做這個 change」在畫面上無法區分。
- **[bundle 變大]** → addon unpacked 618 KB（內含 Unicode 表格）。`npm run measure:bundle` 的歸因
  必須看得見它；本 change 不試圖裁剪表格（那會回到 D1 否決的「自己維護一份表」）。
- **[在 Node 環境驗證寬度會踩到 #6079]** → 任何以 `@xterm/headless` 跑寬度斷言的單元測試或 CI 腳本
  **會**遇到 D8 那個 pooled-Buffer trie 損毀，且失效方式是**靜默的錯誤寬度**（也可能是
  `Data error` 或多 GB 配置造成的 hang，取決於該行程先前配置過什麼）。**本 change 因此不在 Node
  環境驗證寬度**，全部走真實 renderer。若日後有人要加 Node 端的寬度測試，必須先處理
  `Buffer.poolSize` 或等 upstream 修正 —— 這條寫在這裡是為了讓那個人不必重新發現一次。
- **[cluster 粒度改變選取／複製行為]** → **已判定：既有的「終端支援複製與貼上」不需要 MODIFIED。**
  該 requirement 規範的是能力與路徑（鍵盤／右鍵 gate 在 mouse reporting／中鍵恰好一次），
  未涉及選取粒度；其既有 scenario「複製選取的內容」已涵蓋內容正確性。且實測內建 v6 本就把 VS16
  當成寬度 0 的組合字元併入前一個 cell，因此**複製所得在本 change 前後相同** —— 這也意味著
  「選取一個 cluster 得到完整 cluster」不可作為本 change 的驗收判準（見 D6 與 spec）。
- **[升級後首次重播舊快照]** → **已實地確認，無退步。** 風險的具體形狀是「`SerializeAddon` 按
  **cell** 走，舊寬度表下 emoji 只佔一格，序列化時補的空白可能與新寬度表下不同」。以同一行程內的
  兩個終端精確模擬（A 無寬度判定負責序列化、B 有負責重播 —— 比跑兩次 build 更精確，因為快照的
  往返本來就是無損的字串）：
  - **快照逐字元攤開後完全無損**，沒有任何補進去的空白（`UW8 U+1F44D U+1F3FD X`）。
  - 重播後的呈現與**新 build 直接寫入**同一份內容**完全一致** —— 這個對照是必要的：少了它，
    任何量測差異都會被誤讀成「重播殘留了舊寬度表的影響」。
- **[pty 內仍有依舊 wcwidth 排版的程式]** → 對那些輸出，本 change 會把「原本恰好對齊」變成「不對齊」。
  接受：claude 是主場，而現代 wcwidth 是正確的一方（D3）。

## Open Questions

1. **「resize 或切回 session 之後會恢復」尚未被解釋。** 本 change 確立的根因是靜態的，不該因重繪
   而恢復。三種可能：

   - (a) 使用者看到的「恢復」是 emoji 溢出鄰接 cell 的**殘影**消失，而偏移一格因為不夠醒目未被察覺；
   - (b) 存在第二個因素；
   - (c) **調查期間的觀察受一個未進版控的本機修改污染** —— 見下。

   **(c) 的完整揭露**：調查中途，作者曾對 `node_modules/@xterm/addon-webgl` 施加
   [PR #5987](https://github.com/xtermjs/xterm.js/pull/5987) 的等效修改（移除 glyph atlas 的
   `generateMipmap`、改設 `LINEAR` filter），用以檢驗一個後來被推翻的假設。**自該時點起的每一次
   dogfood 觀察**（截圖、關閉 GPU 加速、行高 1.0、純 ASCII 對照）**都是在非 pristine 的 build 上
   取得的**。mipmap 取樣會使圖集中相鄰字形互相混入，其症狀正是殘影，且與 cell 幾何相關 ⇒ **對
   resize 敏感**，因此它與 (a) 的描述重疊，不能先驗地排除。

   該修改**已還原**，並以 `npm pack` 取得 registry 版本逐位元組比對確認一致。**因此 7.1 的 dogfood
   將在 pristine build 上進行**，而 (c) 屆時可被直接檢驗 —— 這正是它必須排在 7.1 之前的理由。

   **已結案 —— dogfood 於 pristine build 確認「都正常了」。** 三個可能性的處置：

   - **(b) 存在第二個因素 —— 排除。** 寬度修正之後捲動不再破版；若有第二個因素，它會留下來。
   - **(c) 觀察受 patch 污染 —— 排除，依時間線。** 「resize 後會恢復」這個觀察是使用者在**最初
     回報時**給出的，而 mipmap patch 是在那**之後**才施加的 —— 那時它還不存在。（其後的觀察
     ——截圖、關 GPU、行高、純 ASCII——確實在 patched build 上，但它們都不是這個觀察的來源。）
   - **(a) 看到的「恢復」是溢出殘影消失、而偏移一格未被察覺 —— 唯一存活的解釋。**

   **誠實的界線**：(a) 是消去法留下的，**不是被直接觀察到的**（沒有人拍到「殘影存在、偏移也存在」
   的中間狀態）。它與已確立的事實相容且不需要額外假設，但它的證據強度低於本文件其餘的實測結論。
   若日後有人重新遇到「捲動時破版」，不應把這條當作已排除的嫌疑。

2. **是否向 upstream 補充 #6079 的一個症狀。** D8 那個 trie 損毀，在本次環境中的表現是**整個星形
   平面（含與 emoji 無關的 CJK 擴充 B/C/D）一律判為一格** —— 該 issue 目前記載的三種失效模式
   （錯誤寬度、`Data error`、hang）沒有涵蓋這個具體形態，而它是 `highStart` 損壞的典型後果。
   最小重現已具備。**不是交付的前提。**

   *（xterm 內建僅 Unicode 6 本身不構成回報標的 —— 官方提供 addon 即為其解法。）*
