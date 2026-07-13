# Design: rail 的可讀性與 repo 列重整

## Context

第一次 dogfooding 的三個回饋（字太小、repo 名稱不夠突出、每個 repo 都掛一行「OpenSpec」）指向
兩塊互相獨立的工程：**字級的治理**與 **rail 的 repo 列**。它們同時被提出，是因為 rail 是使用者
第一眼看的地方 —— 但技術上是兩件事，本文件分開論證。

**現況量測**（實測，非估計）：

| | 數量 |
|---|---|
| 寫死的 `text-[Npx]` | **70**（`12px`×45、`11px`×16、`10px`×4、`13px`×3、`16px`×1、`14px`×1） |
| 既有 token `text-xs`（＝13px） | **35** |
| 既有 token `text-sm`（＝15px） | **4** |
| **字級使用點合計** | **109**，散在 15 個檔案 |
| terminal | `xterm.ts:83` 的 `fontSize: 14`（canvas 設定，非 CSS） |
| `@spekjs/ui` overlay | `index.css` 4 個 selector 的 `font-size`，rem 與 px 混用 |

`@theme` 目前只定義 `--text-xs`(13px) 與 `--text-sm`(15px)。**最大宗的 12px（45 處）在尺度中
根本沒有對應的 token** —— 這正是它們只能寫死的原因，也說明現行尺度是不完整的。

## Goals / Non-Goals

**Goals:**

- 字級成為**單一旋鈕**：調一處，全 app（含 terminal 與 `@spekjs/ui` overlay）整體平移。
- rail 的 repo 列：名稱取回視覺主導、副標改為 git 分支、`◈` 假按鈕移除、「有 openspec」不再發聲。
- 分支在 app 之外被切換時，rail 自己更新。

**Non-Goals:**

- **不定案放大幅度。** 本 change 交付旋鈕；數值由 dogfooding 定。
- **不做字級的 Settings UI。** 旋鈕是原始碼中的一個常數，不是使用者介面。
- **不做多分支／worktree 聚合**（雛型副標的 `master, feat/term`）。只顯示**當前分支**。
- **不改 `hasOpenSpec` 的偵測**，只改 rail 如何呈現它。

## Decisions

### D1 — 字級尺度：五級，由單一 `--text-base` 平移

沿用 Tailwind 的名稱，但**重新定義其值**（`@theme` 的本意就是如此），並以 `calc()` 從一個基準
推導，使「調一個數字」成為真的：

```css
@theme {
  --text-base: 15px;                        /* ← 旋鈕。dogfooding 定案後只改這一行 */
  --text-2xs: calc(var(--text-base) - 4px); /* 11px */
  --text-xs:  calc(var(--text-base) - 3px); /* 12px */
  --text-sm:  calc(var(--text-base) - 2px); /* 13px */
  --text-lg:  calc(var(--text-base) + 1px); /* 16px */
}
```

**為何是平移（等差）而非等比縮放**：使用者的訴求是「字太小」，其心智模型是「每個字都大一點」。
等比縮放（`× 1.15`）會讓大字長得比小字快，把原本 1px 的級差拉開成 2–3px，改變的是**版面的層次
關係**，不只是大小。平移保持級差、只移動整體，是最小驚訝的作法。

**替代方案**：六個各自獨立的 px 常數。被否決 —— 那不是「一個旋鈕」，是六個，使用者試一個幅度就
要改六行且容易改出不一致的級差。

**待實作時驗證（第一件事）**：Tailwind v4 的 `@theme` 是否允許某個 theme 變數以 `var()` 引用
同區塊的另一個變數。理論上 `@theme` 的內容會原樣輸出為 `:root` 的 custom properties，`calc()`
由瀏覽器求值，因此可行；但**這是假設，不是實測**。若不成立，退路是把五個值寫成明確的 px（旋鈕
退化為「改五行」，其餘設計不變）—— 這是一個**局部退路，不影響其他決策**。

### D2 — 最大的風險不是那 70 個寫死值，而是那 35 個 `text-xs`

D1 把 `--text-xs` 從 **13px 重新定義為 12px**。既有 35 處 `text-xs` 的**本意是 13px**，收斂後
它們必須改為 `text-sm`（新的 13px），否則會**靜默縮小 1px**。

**而字級守衛抓不到這件事** —— 守衛掃的是「有沒有寫死的 arbitrary 值」，一個「用了錯誤 token」的
元件在它眼中完全合法。這是本 change 唯一無法以自動化驗收兜底的部分。

緩解：

1. 收斂**以檔案為單位一次做完**，每個檔案的每一處字級都經過映射表，不做部分替換。
2. **映射表寫進 `tasks.md`**，逐檔逐值列出（`text-xs`→`text-sm`、`text-[12px]`→`text-xs`…），
   讓它是機械比對而不是逐處判斷。
3. 收斂與 `@theme` 的改動**必須在同一次提交**。中間狀態下畫面是錯的。

**映射表**（現值 → 新 token）：

| 現況 | 處數 | 新 token | 新值 |
|---|---|---|---|
| `text-[10px]` | 4 | `text-2xs` | 11px（**上調 1px** — 10px 過小，且與 11px 的級差不可辨識，見 D3） |
| `text-[11px]` | 16 | `text-2xs` | 11px |
| `text-[12px]` | 45 | `text-xs` | 12px |
| `text-xs`（＝13px） | 35 | `text-sm` | 13px |
| `text-[13px]` | 3 | `text-sm` | 13px |
| `text-[14px]` | 1 | `text-base` | 15px（**上調 1px** — 見 D3） |
| `text-sm`（＝15px） | 4 | `text-base` | 15px |
| `text-[16px]` | 1 | `text-lg` | 16px |

### D3 — 尺度不保留「無法辨識的級差」

現況有 10px 與 11px、14px 與 15px 兩組相鄰 1px 的級距。它們在畫面上**分不出來**，但在原始碼裡
製造了「這裡刻意比那裡小一點」的假象。收斂時各自合併（4 處 10px → 11px、1 處 14px → 15px），
是**刻意的視覺改動**，不是失誤。

這也兌現 `typography-scale` 的「相鄰級距 SHALL 有可辨識的差異」—— 一個沒人分得出來的級距，
只會讓下一個人繼續增生新的寫死值。

### D13 — 行高必須明確釘住，否則「收斂字級」會順手改掉整個 app 的版面（實作時實測抓到）

**這是 D1 沒有預見的副作用，而且它被探針抓了現行犯。**

`text-[12px]` 這種 arbitrary 值**只設 `font-size`**，行高是繼承來的；而 Tailwind 的具名 token
（`text-xs` / `text-sm` …）**會連帶設 `line-height`** —— 每個字級 token 在 Tailwind 的預設 theme
裡都有一個對應的 `--text-*--line-height`。於是那 45 處 `text-[12px]` 一改成 `text-xs`，就憑空多
出一個 16px 的行高。

後果不是「有點醜」：分頁列與對話框變高，而 `probe:terminal` 是以**真滑鼠座標**點擊的 ——
版面一動，那組本來就對時序敏感的 OSC 標題斷言開始點空。徵狀是**時綠時紅、每次紅的還是不同條**，
極易誤判為「既有的 flaky」。**baseline 對照組戳破了這個藉口：stash 掉改動後跑，114/114 全綠、
exit=0。**

因此每一級的行高都**對齊它收斂前的來源**，讓這次改動只動字級：

| token | 來源 | 行高 |
|---|---|---|
| `2xs` | `text-[10px]` / `text-[11px]` | 原本未設 → `normal` |
| `xs` | `text-[12px]`（45 處） | 原本未設 → `normal` |
| `sm` | 舊的 `text-xs`（35 處，13px） | 保持原值 `calc(1 / 0.75)` = 17.33px |
| `base` | 舊的 `text-sm`（4 處，15px） | 保持原值 `calc(1.25 / 0.875)` = 21.43px |
| `lg` | `text-[16px]` | 原本未設 → `normal` |

修正後 `probe:terminal` 連兩輪 114/114。**教訓可一般化：把 arbitrary 值換成設計系統的 token，
換掉的往往不只你盯著的那個屬性。**

### D14 — 旋鈕轉到 17px 才暴露的：宣告的 `minSize` 一直沒有真的兌現（實測）

使用者定案 `--text-base: 17px`。一調上去，`probe:workspace` 立刻紅一條：**rail 縮不到它宣告的
`minSize="180px"`**（卡在 240px）。

根因不是這次改動 —— 是 **flex item 的 `min-width` 預設為 `auto`**，於是 `Panel` 會被它的**內容**
撐住。rail 裡有兩處不會自我截斷的文字（`WORKSPACE` 標題、底部的加入入口），它們的寬度隨字級長大。
`workspace-layout` 明文要求「拖動 SHALL 被夾制於該下限」，而**這道夾制在實作上從來沒有真的兌現**，
只是字級小的時候 rail 的 min-content 恰好小於 180px，所以沒人發現。

**修 `Panel` 的 `min-w-0`（外加 rail 的 `overflow-hidden` 與標題的 `truncate`），不是把 180px 調高**
—— 最小寬度是版面契約，不該隨字級浮動；把它調高只會讓下一次調字級時再撞一次。

> **一般化的教訓：字級是版面的輸入，不是裝飾。** 一個「只改字級」的旋鈕，會沿著 min-content 把
> 壓力傳到每一個沒有寫 `min-w-0` 的 flex 容器上。

### D4 — terminal 的字級：專屬 token + 讀 computed style + 重新量測

xterm 的 `fontSize` 是數字（canvas 量測），吃不到 CSS token。作法：

```css
--text-terminal: calc(var(--text-base) - 1px);  /* 14px，隨旋鈕平移 */
```

**terminal 有自己的級距是正當的** —— 等寬字在相同 px 下視覺比例不同 —— 但它 SHALL NOT 是一個
與尺度無關的常數（`typography-scale` 明文要求）。

> **本節原本寫「`getComputedStyle(root).getPropertyValue('--text-terminal')` 解析出數字」——
> 那是錯的，而且會靜默失敗（實作時實測）。** CSS **自訂屬性的 computed value 不會求值
> `calc()`**：那個呼叫回傳的是字面的 `"calc(15px - 1px)"`，`parseFloat` 於是得到 `NaN`，悄悄退回
> fallback。**而 fallback 剛好等於當時的正確值（14px），所以畫面上完全看不出來** —— 終端的字級
> 就此與尺度脫鉤，旋鈕轉了它也不動，沒有任何東西會報錯。
>
> 解法是讓**瀏覽器**去求值：`font-size` 是有型別的屬性，其 computed value 必定是絕對 px。把
> `var(--text-terminal)` 餵給一個離屏元素的 `font-size`，再讀回它 computed 的 `fontSize`
> （實測得到 `"14px"`）。
>
> 另一個相關的實測：**`--text-terminal` 必須定義在 `:root` 而非 `@theme`** —— Tailwind v4 會
> tree-shake 掉沒有任何 utility 用到的 theme token，而這個變數只被 JS 讀取、永遠不會有 utility
> 引用它。放在 `@theme` 裡它會從產物中消失（實測），於是連 `var()` 都拿不到值。

**字級改變後必須 `fit()` 一次**：字級決定 cell 尺寸，cell 尺寸決定行列數。改了字級而不重新量測，
pty 手上的 `cols/rows` 就與畫面錯位（這與 Phase 4 記下的「由隱藏轉為顯示時必須重新 fit」同源）。

### D5 — 字級守衛：掃原始碼，且**必須有對照組**

`npm test` 新增一條：`src/renderer/src` 的產品原始碼不得出現 `text-[<數字>px|rem]`，`index.css`
的 `@theme` 區塊之外不得出現 `font-size:`。

**守衛必須自證有效**：以一段刻意寫死字級的樣本餵給它，它必須命中。CLAUDE.md 已記過
`naming.test.mjs` 因 ANSI 顏色碼讓路徑比對靜默失準而全綠 —— 一條永遠不會紅的守衛等於沒有守衛。

### D6 — 分支從 `.git/HEAD` 讀，不 spawn `git`（實測格式）

實測（`git` 2.x，Linux）：

| 狀態 | `.git/HEAD` 內容 |
|---|---|
| 位於分支 | `ref: refs/heads/master\n` |
| 分支名含 `/` | `ref: refs/heads/feat/x\n`（取 `refs/heads/` 之後**全部**，不可在第一個 `/` 斷開） |
| detached HEAD | `ef48cc91774f5718f672d97f1d0c365702cd57e6\n`（純 sha → 顯示短 sha） |

一次檔案讀取即可，**零子行程**。這守住 `workspace-folders` 既有的「偵測 SHALL NOT 呼叫任何外部
程式」，理由相同：這是每個 folder、每次載入都會發生的判定，而 rail 是使用者最先看到的東西。

**替代方案**：`git rev-parse --abbrev-ref HEAD`。被否決 —— 每個 folder 一次 spawn，啟動時 N 個
子行程；且 CLAUDE.md 已記過「core 的 `getTimestamps` 會 spawn `git log`」如何污染「本段邏輯沒有
spawn 外部程式」的驗收。不要再增加一個。

### D7 — worktree／submodule：`.git` 是**檔案**，需解一層間接（實測）

實測 `git worktree add`：

```
<worktree>/.git            → 一般檔案，內容：gitdir: /path/to/repo/.git/worktrees/wt
/path/to/repo/.git/worktrees/wt/HEAD → ref: refs/heads/feat/x
```

解析：`stat` `<folder>/.git` → 若為**目錄**，HEAD 在 `<folder>/.git/HEAD`；若為**檔案**，讀出
`gitdir:` 指向的路徑，HEAD 在 `<gitdir>/HEAD`。

**那個 gitdir 常在 folder 邊界之外。** 這是主行程自己的檔案存取，不經 renderer 的
`(folderId, relPath)` 詞彙 —— `repo-branch` 的規格已明文寫死「SHALL NOT 被理解為
`filesystem-access` 白名單的擴大」。**這條界線必須守住**：renderer 依然無從指定要讀哪個路徑，
它只收到一個字串。

### D8 — 監看：git 用 **rename** 換掉 HEAD，但 chokidar 撐得住（實測）

**實測結果，反直覺**：`git checkout` 會寫 `HEAD.lock` 再 rename 上去 —— HEAD 的 **inode 每次都變**
（`46684526 → 46684534 → 46684551 → …`）。這正是 CLAUDE.md 警告過的「暫存檔 + 改名」模式，直覺
會認為監看單一檔案的 watcher 會在第一次切 branch 後失聯。

**但它沒有**：連續切三次分支，chokidar 對 `.git/HEAD` 的單一檔案監看**三次都收到 `change` 事件**
（它內部會在 rename 後重新 attach）。因此：

- **監看 `<folder>/.git/HEAD`（或 worktree 的 `<gitdir>/HEAD`）單一檔案。**
- 不監看 `.git/` 目錄 —— 那會被 `index.lock`、`refs/`、object 寫入的事件淹沒，而我們只關心一個檔案。

> 這條實測是必要的。若不測而直接監看單一檔案，看起來會是對的（第一次切 branch 也可能剛好收到）；
> 若不測而保守地監看整個 `.git/`，則是在為一個不存在的問題付出噪音的代價。

### D9 — 「folder 執行期間變成 git repo」需要**第二層**監看（實測推翻直覺）

`repo-branch` 有一條 scenario：folder 於 app 執行期間被 `git init`，rail 應開始呈現分支。

**實測：直接監看尚不存在的 `<folder>/.git/HEAD` 是行不通的** —— `git init` 之後 800ms 內
chokidar **收不到任何事件**（它連父目錄 `.git` 都不存在，無從 attach）。改監看尚不存在的
`<folder>/.git` 亦然：`addDir` 事件遲到，且遲到時 HEAD 的寫入早已錯過。

因此分支的監看是**兩層**：

1. **folder 根目錄（`depth: 0`）** — 恆常存在，用來等 `.git` 出現或消失。事件以 basename `.git`
   過濾；其餘（agent 在頂層寫檔）一律忽略。
2. **HEAD 檔案** — 僅在 `.git` 存在時建立，`.git` 消失時銷毀。

代價是每個 folder 多一個 watcher，且 folder 根目錄的事件流會被 agent 的寫檔活動打到（過濾即可，
不影響正確性）。**這條 scenario 若嫌貴，唯一的替代是把它從 spec 拿掉**（使用者重新加入 folder
或重啟即可）—— 但那會讓「rail 顯示的分支是不是真的」多一個例外，而 `repo-branch` 的核心價值恰恰
是「不要顯示一個看起來像真的舊值」。**保留。**

### D10 — IPC：分支是 folder 狀態的一部分，不是獨立的查詢

分支併入既有的 folder 狀態（`hasOpenSpec` 旁邊多一個 `branch: string | null`），隨既有的
workspace 清單一起送達 renderer。

**替代方案**：新增 `git.getBranch(folderId)` 這類獨立 IPC。被否決 —— rail 需要的是「每個 folder
的當前分支」，那本來就是 folder 狀態；拆成獨立查詢會讓 renderer 得自己為 N 個 folder 發 N 次
請求並自行維護一份與 folder 清單平行的狀態。

> **本節原本斷言「不新增任何 preload method，白名單守衛因此不需要放寬」—— 那是錯的，實作時
> 推翻。** 既有的 `folders.*` 只有 `list` / `add` / `remove` 三個 request/response，**沒有任何
> 主行程 → renderer 的推送通道**。而「在 terminal 切 branch 後 rail 自己更新」是 `repo-branch`
> 的硬要求，它必然需要一個訂閱 API。因此**新增一個** `folders.onChanged(listener)`，形狀比照
> 既有的 `fs.onWatchEvent` 與 `openspec.onChanged`（回傳取消訂閱的函式；renderer 拿不到
> `ipcRenderer`，無從自行解除他人的監聽器）。
>
> **而 `probe:shell` 的白名單守衛不會因此變紅 —— 因為它根本沒有涵蓋 `folders.*`**（實測：它只
> 檢查 `fs.*` 與 `openspec.*` 的 keys）。這是守衛的漏洞，不是許可。**順手補上 `folders` 的
> 白名單**：白名單原則的重點是「介面上只能有已為其定義邊界要求的能力」，漏掉一整個 namespace
> 等於那個 namespace 沒有守衛。

### D11 — repo 列的呈現：名稱主導，副標只說「非常態」的事

```
┌────────────────────────────────┐
│ ▸ spekterm                  2 │   ← 名稱：粗體、最亮前景（選中轉 accent）
│   master                       │   ← 副標：mono、弱化 — 只有分支
└────────────────────────────────┘
┌────────────────────────────────┐
│ ▸ some-notes                   │
│   無 openspec/                 │   ← 沒有 git、沒有 openspec：只說異常的那件事
└────────────────────────────────┘
```

副標的內容是**組合**而非二選一：有分支就顯示分支；缺 `openspec/` 就在其後附註（雛型的
`develop · 無 openspec/`）；兩者皆無則副標只有那句附註；兩者皆有（常態）則副標只有分支。
`◈` 移除。路徑失效維持既有的明確標示（那是錯誤，不是弱訊號）。

**名稱的視覺權重**（對齊雛型的 `.ws-repo-name`）：`font-weight: 700`、未選中亦為最亮的
`text-ink`（不再是 `text-ink-dim`）、選中轉 accent。CLAUDE.md 的調查已指出：名稱現在雖然是
15px，卻因為 normal weight + 暗灰而被 12px 的副標平分了注意力 —— **字重與顏色比 px 更能解決
「不夠突出」**。

### D12 — `@spekjs/ui` overlay 的字級覆寫一併收斂

`index.css` 中那 4 個 `.spekui-*` 的 `font-size`（rem/px 混用）改為引用同一組 token。套件的
顏色契約（`--spek-*`）已經是「宿主覆寫變數」的形狀，字級沿用同一手法即可，不需要動到套件。

## Risks / Trade-offs

- **[35 處 `text-xs` 的重映射漏網 → 靜默縮小 1px]** → 這是本 change 最大的風險，且自動化守衛
  抓不到（D2）。以「逐檔映射表寫進 tasks」+「單一提交」緩解。**收斂完成後必須實際開 app 看過**，
  不能只靠 probe 全綠。
- **[字級放大後，side panel 在 320px 最小寬度下截斷變多]** → 既有 `truncate` 已處理，不會破版；
  但這正是「幅度交給 dogfooding 定案」的原因 —— 這個取捨只有在真的用起來時才看得出來。
- **[folder 根目錄的 watcher 被 agent 的寫檔活動打到]**（D9）→ 以 basename 過濾；事件多但廉價，
  不影響正確性。
- **[Tailwind v4 的 `@theme` 不支援 `var()` 互相引用]**（D1）→ 退路是五個明確 px 值，旋鈕退化為
  「改五行」。**此假設必須在實作的第一步就驗證**，不要等到收斂完 109 處才發現。
- **[git 的 HEAD 寫入模式在其他平台／git 版本不同]** → 實測基於 Linux + git 2.x。Windows 的驗證
  併入 Phase 6 打包前的既有清單（CLAUDE.md 已有一條同性質的待辦）。

## Open Questions

- **放大幅度是多少？** 交付旋鈕後由使用者在 dev 中決定。定案前 `--text-base` 維持 15px（即現況）。
- **雛型的副標是複數分支（`master, feat/term`）** —— 那是 worktree 聚合。本 change 只做當前分支；
  是否要做聚合，留待使用者在真的用起來之後判斷。
