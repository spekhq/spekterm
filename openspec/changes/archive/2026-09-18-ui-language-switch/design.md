## Context

動機見 `proposal.md`。這裡只記三件塑形了作法的現況：

- **字典是單一份 `en.json`，且 i18n 於模組載入時初始化**（`src/shared/i18n/index.ts`）——
  那個「不導出 init」的決定是刻意的（未初始化的 `t()` 回傳 `undefined`，畫面上什麼都沒有），
  而它限制了「初始語言從哪裡來」：初始語言必須在**模組載入的那一刻**就取得，否則就得回到
  一個「請記得呼叫」的 init。
- **偏好的三條路徑全部自 `PREFERENCE_FIELDS` 一張表推導**（讀入、部分更新時的保留、送往
  renderer 的投影），而那張表在型別上與 `TerminalPreferences` **一對一相繫**（`satisfies`）。
  那個相繫正是「漏一個欄位」成為編譯錯誤的原因（issue #39 的處置），**不能為了塞進一個
  非終端的欄位而鬆掉**。
- **每一支探針都以 `--user-data-dir=<profile>` 啟動**（`probe:identity` 除外，它刻意不傳），
  而 profile 的內容是探針自己種的（`workspace.json`、`intake-routing.json`）——
  **種一個 `preferences.json` 是既有機制，不是新機制。**

### 實測（2026-09-18、Electron 43.1.0、Linux/xvfb）

| `LANG` | `LANGUAGE` | `getLocale()` | `getSystemLocale()` | `getPreferredSystemLanguages()` |
|---|---|---|---|---|
| `zh_TW.UTF-8` | `zh_TW:zh` | `zh-TW` | `zh-TW` | `zh-TW,zh,zh` |
| `en_US.UTF-8` | `zh_TW:zh` | **`zh-TW`** | `en-US` | **`zh-TW,zh,zh`** |
| `zh_TW.UTF-8` | `en_US:en` | **`en-US`** | `zh-TW` | **`en-US,en,en`** |
| `zh_TW.UTF-8` | 未設 | `zh-TW` | `zh-TW` | `zh-TW,zh-TW,zh,zh` |
| `en_US.UTF-8` | 未設 | `en-US` | `en-US` | `en-US,en-US,en,en` |
| 兩者皆未設 | | `en-US` | **`en-US@posix`** | **（空陣列）** |
| `zh_TW.UTF-8` | `zh_TW:zh` ＋ `--lang=en-US` | **`zh-TW`** | `zh-TW` | `zh-TW,zh,zh` |
| `zh_TW.UTF-8` | 未設 ＋ `--lang=en-US` | `en-US` | `zh-TW` | `zh-TW,zh-TW,zh,zh` |

四個結論，每一個都改變了作法：

1. **驅動者是 `LANGUAGE`，不是 `LANG`。** `LANGUAGE` 有值時 `getLocale()` 與
   `getPreferredSystemLanguages()` 一律跟它走，`LANG` 只剩 `getSystemLocale()` 在看。
   **而這台開發機兩者不一致**（`LANG=zh_TW.UTF-8`、`LANGUAGE=zh_TW:zh`）—— 一份只設 `LANG`
   的驗收會得到與它宣稱相反的結果。
2. **`--lang` 不能用。** `LANGUAGE` 有值時它連 `getLocale()` 都蓋不掉。
3. **`getPreferredSystemLanguages()` 會回空陣列**（兩個變數都沒有時）。純函式的 `[]` 分支
   因此不是假想的防禦，是一條量測到的輸入。
4. **`getSystemLocale()` 會回傳帶 POSIX modifier 的 `en-US@posix`** —— 它不是乾淨的 BCP-47
   標籤。這是不以它為偵測來源的另一個理由。

## Goals / Non-Goals

**Goals**

- 語言是一項使用者偏好，切換**立即**生效於兩個 realm，且跨重啟。
- 「locale 從哪裡來」在整個 codebase 裡只有**一個**答案，並由守衛維持。
- 字典不完整、翻譯漏掉插值變數 —— 兩者皆**在 `npm test` 就紅**，不是在畫面上現形。
- 探針執行的語言是**被指定的**，不是碰巧的。

**Non-Goals**

- RTL、字型的語言別回退、日期曆法（en / zh-TW 都是 Gregorian + LTR）。
- 翻譯寫給 agent 讀的文字（見 proposal「四類文字」第 1、2、4 類）。
- `report.ts` 的模型 prompt（proposal 立場 3）。
- 執行期載入語言包（兩份字典一起進 bundle；`zh-TW.json` 約與 `en.json` 同量級，
  相對於 Monaco 的 8.81 MB 可忽略）。

## Decisions

### D1 — 偵測來源是 `getPreferredSystemLanguages()`；偵測只在「偏好檔不存在」時發生，而那個條件由隔離路徑一併維持

「使用者偏好的語言順序」本來就是一個**有序清單**，而我們要回答的問題正是「這個清單裡第一個
我們支援的是哪個」。`getLocale()` 是 Chromium 解析後的**單一**值，拿它來做這件事要自己補回
回退鏈；`getSystemLocale()` 會回傳 `en-US@posix` 這種帶 modifier 的字串。

**偵測的觸發條件是「`preferences.json` 不存在」，不是「`ui.language` 未設定」。** 兩者差在
升級路徑上：現有使用者的偏好檔已經存在（裡面有他的字型設定），若以「欄位未設定」為條件，
**他的 app 會在升級後自己變成中文** —— 那是一次沒有人要求過的行為改變。

> **而「檔案不存在」目前並不等於「從未啟動過」。** `PreferencesStore.load()` 在內容不可信時
> 把原檔**改名保留**並以預設繼續，**不回寫** —— 於是下一次啟動偏好檔是不存在的，偵測會誤觸發，
> 「檔案壞過一次」的使用者會莫名其妙換了語言。**處置是讓隔離路徑立刻寫回一份預設偏好檔**，
> 於是那個等式成立。這不是順手加的保險：D1 的整個論證都架在那個等式上。

映射（`resolveInitialLanguage(preferred: readonly string[]): Language`）是**純函式**，
由單元測試釘住（`['zh-TW']` → `zh-TW`、`['zh-HK','en-GB']` → `en`、**`[]` → `en`（實測會發生）**、
大小寫與底線形式）。「app 真的以那個語言開起來」另由一支探針段落承擔，以 **`LANGUAGE` 環境變數**
造出兩個方向 —— **不用 `--lang`，也不能只設 `LANG`**（見上表：前者蓋不掉，後者不是驅動者）。
該段落 SHALL 同時設定 `LANG` 與 `LANGUAGE` 且兩者一致，避免驗收本身重演這台機器的矛盾。

> **被否決的替代**：以 `app.isPackaged` 為閘只在打包後偵測。那會讓偵測那條路**沒有任何
> probe 覆蓋**（probe 永遠 `isPackaged === false`），與 CSP 曾經踩過的假綠同一族。

### D2 — 初始語言在模組載入時就已知，方法是讓解析器先跑

`@shared/i18n` 維持「載入即初始化」。初始語言由一個**同步**的解析器提供，兩個 realm 各有
一個來源：

- **主行程**：`index.ts` 在 `whenReady` 內、建立視窗**之前**讀好偏好並呼叫
  `i18n.changeLanguage()`。主行程的第一個文案出口（原生對話框、通知）都晚於此。
- **renderer**：以 `en` 初始化，`PreferencesProvider` 取得偏好後 `changeLanguage()`。

**renderer 因此會有一瞬的英文。** 這不是遺漏，是與字型偏好**同一條先例**
（`PreferencesProvider` 的註解已經記著「先以預設字型起、偏好到達再套用」的閃動）。
消除它要嘛把語言塞進 `additionalArguments` 再經 preload 同步取回（多一條啟動期通道，
而 preload 在 dev 不熱套用），要嘛擋住第一次繪製（更糟）。**取一瞬的閃動。**

### D3 — 語言是 `preferences.json` 的第二個區塊，兩張表各自保持一對一

磁碟形狀變成 `{ version: 1, terminal: {...}, ui: { language } }`，**`version` 不動**
（遞增會讓 `parsePreferences` 隔離整檔 ＝ 每個使用者的字型設定歸零）。舊檔沒有 `ui`
⇒ 該區塊為空 ⇒ 依 D1 不偵測 ⇒ 維持英文。

實作上**新增第二張表** `UI_PREFERENCE_FIELDS satisfies { [K in keyof Required<UiPreferences>]: FieldSpec<…> }`，
把讀入與投影的迴圈抽成一個吃「表 ＋ 來源物件」的泛型函式。

> **被否決的替代**：把 `language` 塞進 `TerminalPreferences`。表與迴圈一行都不用改，但
> `terminal` 這個區塊名就開始說謊，而下一個非終端偏好會沿著同一條路再塞一個。
>
> **不可以把兩張表併成一張 `Record<string, FieldSpec>`。** 那讀起來等價，但 `Record` 的鍵型別
> 是 `keyof any`，於是它不是 homomorphic mapped type，`FieldSpec` 拿不到逐欄位的 `T` ——
> 清理器接到錯的欄位上**零錯誤**（`PREFERENCE_FIELDS` 的註解已經記著這條）。

`language` 的清理器是**白名單查表**（`SUPPORTED_LANGUAGES` 之一才採用，其餘視為未設定），
與 `sanitizeAgentView` 同一條理由：「檔案壞了」與「使用者選了英文」不是同一件事。
`toRenderer: true`。

**送往 renderer 的投影維持扁平**：renderer 收到的仍是一個不分群組的物件，`language` 與既有的
終端欄位並列。**分群的代價與收益不成比例** —— `PreferencesApi.terminal` 與其每一個消費端都要
改，`probe:workspace` 兩條既有斷言（直接讀 `fontFamily`、以「空偏好的鍵數為 0」判定損毀降級）
會當場變紅，而換到的只是 renderer 端多一層與磁碟同形的巢狀。**分群是磁碟形狀與主行程內部
表的事，不是 IPC 形狀的事** —— 「每個群組各自經過白名單」在主行程那一端完整成立。


### D4 — 語言改變由 setter 的處理常式在主行程先套用，renderer 於 resolve 後套用

不新增推播通道。`workspace:settings:setLanguage` 的處理常式在主行程 `changeLanguage` 後
才回傳投影，renderer 拿到回傳值再改自己的。**順序是承重的**：反過來的話，處理常式失敗時
畫面已經是新語言而原生對話框還是舊語言，而那個分岔沒有任何東西會報錯。

### D5 — `SUPPORTED_LANGUAGES` 是單一來源，四個消費者全部自它推導

`resources` 的組成、清理器的白名單、設定介面的選項、完整性守衛的定義域。加第三種語言時
只動這個陣列與新增一份字典。

**選項的標籤是各自語言的自稱**（`English` / `繁體中文`），**兩份字典裡的值相同**，且
**不隨介面語言改變** —— 一個看不懂當前語言的使用者，要能在清單裡認出自己的語言。
（它們是 JSON 的值，不受 CJK 守衛約束 —— 那道守衛掃的是 `.ts`/`.tsx` 的字串字面值。
**反過來把它們寫成 `.ts` 的常數是不可行的**：`'繁體中文'` 就是 `src/` 之下的 CJK 字串字面值，
`copy-language.test.mjs` 會當場抓到，而本 change 明文不放寬那道守衛。）

**「不隨當前 UI 語言改變」指的是取值時指定語言，不是不經 i18n 層**：每個選項的標籤自**它自己
那份**字典取得（i18next 的 `getFixedT(lang)`），而不是自當前語言的字典取得。寫成 `t()` 的話，
中文介面下兩個選項會變成「英文／繁體中文」—— 那正是這條要防的事。

### D6 — locale 衍生的格式化收斂到單一模組；而「排序」先分成兩類，再收斂

新增 `src/shared/i18n/locale.ts`：`localeOf()`（取自 i18n 當前語言）、`collator()`、
`formatTime()` / `formatDate()` / `formatNumber()` / `relativeTime()`，格式化器**以語言為鍵
快取**（`relative-time.ts` 現有的快取搬進來）。

**不是每一個 `localeCompare` 都該跟著 UI 語言 —— 把它們一視同仁會改壞既有行為。** 全 repo 21
處呼叫分成兩類，分界是**這個順序有沒有被使用者看到**：

**跟隨 UI 語言（走 `locale.ts`）**

| 位置 | 是什麼 |
|---|---|
| `files/useFileTree.ts:35` | 檔案樹的排序（目前硬編 `zh-TW`） |
| `files/relative-time.ts:22` | 相對時間（已正確，搬進新模組） |
| `StatusBar.tsx:269,271` | 用量上限的重置時刻與日期 |
| `insights/InsightsOverlay.tsx:399` | 計量數字（目前硬編 `en-US`） |
| `insights/ReportTab.tsx:21,143,144,208` | 日期、時刻與數字 |
| `intake/SlackSettings.tsx:70` | 重試時刻 |
| `side-panel/PanelSourceBar.tsx:77` | 工作目錄選單的排序 |
| `main/ipc/settings.ts:46` | 字型下拉的排序 |

**維持與語言無關的定序（明文豁免，且豁免要寫在守衛的清單裡而不是靠沒人去動它）**

| 位置 | 為什麼 |
|---|---|
| `quick-open/score.ts:105` | 分數相同時的 tie-break。它決定的是**演算法的確定性**，而 `score.test.ts:78` 的期望值正是以同一個比較算出來的 —— 換成隨語言變動的比較，那條測試變成在測環境 |
| `main/fs-service.ts:192` | 註解明寫「兩條列舉路徑的順序不同，在此收斂以免呼叫端看到不穩定的順序」—— 它要的是穩定，不是語言 |
| `main/fs-service.ts:146` | 目錄列舉的排序。**使用者看到的順序由 `useFileTree` 的 collator 決定**（renderer 會再排一次），這裡只為確定性。**若日後 renderer 不再重排，這個分類必須重新論證** |
| `main/insights-aggregate.ts:228,364` | `b.n - a.n ||` 之後的次要鍵，同樣是確定性 |
| `MainStage.tsx:472` | 比的是 session id，不是給人讀的字串 |

守衛（`scripts/locale-source.test.mjs`）擋住 `src/` 之下除 `locale.ts` 外出現
`new Intl.`、`toLocaleString`、`toLocaleDateString`、`toLocaleTimeString`、`localeCompare`，
**豁免清單為上表第二類，逐一具名**；`*.test.ts` 一併豁免（三處：`transcript-fixture.test.ts:288`、
`ipc/intake-projection.test.ts:101`、`quick-open/score.test.ts:78`）。

> **具名豁免與「不掃測試檔」是兩件事，不可合併。** 前者每一條都帶著一個理由，日後有人把
> `score.ts` 的 tie-break 改成跟隨語言時，改的是那張表而不是悄悄加一行。

> **這道守衛不是加分項，它有證據。** 本能力成立時 app 只有一種語言，而在那個前提下長出了三處
> 各自不同的做法：一處硬編了另一個 locale 的排序規則、一處硬編了英文的數字格式、一處沿用執行
> 環境的預設。**三處都沒有任何東西會變紅。** 紀律在沒有守衛時已經失效過了。

`<html lang>` 與 `document.documentElement.lang` 同樣由這一處驅動 —— **`index.html` 的靜態
`lang="en"` 留著**（它是第一次繪製的值，而依 D2 那一瞬本來就是英文），由 renderer 於語言確定後覆寫。

### D7 — 完整性守衛比對的是「基底 key ＋ 複數類別 ＋ 插值變數集合」，不是 key 集合

`scripts/dictionary-completeness.test.mjs`，對每一種非基準語言：

1. **基底 key 相等** —— 去掉 `_one` / `_other` 之類的複數後綴後，兩邊的集合必須相同。
2. **複數類別由 CLDR 決定** —— 每個基底 key 在語言 L 中存在的後綴集合，必須恰為
   `new Intl.PluralRules(L).resolvedOptions().pluralCategories`。en 是 `one`/`other`，
   zh-TW 只有 `other`。**單純比對 key 集合的守衛會因為這 12 對而永遠紅。**
3. **插值變數集合相等** —— `{{name}}` 在翻譯裡漏掉時，畫面上是一句**少了檔名的話**，
   沒有錯誤、沒有紅字。這條是三條裡最容易被忽略、而失效最不顯眼的一條。
4. 值不得為空字串。

對照組四條，各自指名一種破壞（少一個 key、多一個 `_one`、漏一個變數、空字串）。

### D8 — 語言種在探針的共用啟動路徑上，且**只在偏好檔不存在時**才種

每支探針在它共用的 `launch()`（或唯一的 spawn 點）呼叫一次 `seedLanguage(profileDir)`，
寫出 `{version:1, terminal:{}, ui:{language:'en'}}`。守衛（`scripts/probe-language.test.mjs`）
要求：**每一支會傳遞 `--user-data-dir` 的探針，其原始碼中都有一次種入**。

理由是失效方向：漏種的探針會在開發者機器的語言下執行，而 `copy.mjs` 仍以 `en.json` 組
選擇器 —— **症狀是「選不到元素」，看起來像產品壞掉**，不是像驗收設定錯了。

> **第一版的設計是「在每一個建立 profile 的位置種」，那是錯的取捨。** 一支探針只有一處
> `--user-data-dir=` 字面卻有數個 profile（`probe-workspace` 有四個），於是那個版本要改
> 約四十處、而守衛仍然看不出哪個 profile 流進 `launch()`。**種在啟動路徑上涵蓋每一次啟動，
> 改的地方少一個數量級，而覆蓋率更完整。**

**「只在偏好檔不存在時才寫」讓兩個段落不必列為例外**：損毀韌性那一段要的就是一份壞掉的
`preferences.json`，而舊檔那一段要的是一份沒有 `ui` 區塊的檔案 —— 它們寫在前，helper 就不動。
真正要不寫的只有**驗證偵測機制本身**的那一段（它要的正是「檔案不存在」），以明示的旗標關掉。

**三個具名例外**（它們不傳 `--user-data-dir`，用真實的 userData，而**斷言都不經字典**）：
`probe-identity`（驗的正是 userData 實際解析出來的路徑）、`probe-core`（不載入 renderer）、
`probe-native`（它自己就是主行程）。

> **判定「有沒有傳」不能寫成 `includes('--user-data-dir=')`** —— `probe-identity` 的斷言正是
> 去**讀**子行程 argv 裡的那個旗標，字串比對會把它判成相反的事。實測踩到，改為比對樣板
> 字面值的形式。

**偵測段落以環境變數驅動，且必須同時設 `LANG` 與 `LANGUAGE`**（見上表：`LANGUAGE` 才是驅動者，
`--lang` 無效）。它是唯一一段斷言中文介面的驗收，因此 `scripts/lib/copy.mjs` 要多一個
**可指定語言**的取文案入口；`copy()` / `label()` 兩個既有入口**維持只讀 `en.json`** ——
其餘每一段驗收仍然在英文下執行，那是它們的前提而不是巧合。

**`scripts/run-probes.mjs` 要把 `LANG` / `LANGUAGE` 正規化**（它目前只刷 `LEAKED_DEV_ENV`）——
否則「完整驗收」與「單支入口」會在不同的語言環境下跑同一段。

### D9 — 第 2、4 類文字搬離 UI 字典，落在 `handoff-intro.ts` 同一側

`intake.contextHeader` / `intake.prompt` / `intake.promptFirstParty` 移入一個新的
`src/main/agent-protocol-copy.ts`（名字說明它是什麼），以英文常數持有，維持 `{{var}}` 的
插值形式或改為模板函式。它們**仍受 CJK 守衛約束**（那道守衛管的是「不要把中文寫進程式碼」，
與有幾種語言無關）。

`slack.bodyHeader` / `slack.truncatedBody`（第 3 類）**留在字典**並在地化。

### D10 — `zh-TW.json` 先落地完整的 key 骨架，再逐批替換值

完整性守衛（D7）要求基底 key 相等。**若字典逐批長出來，中間每一個 commit 的 `npm test` 都是
紅的** —— 而一個「暫時是紅的」的 `npm test` 會在幾天之內變成沒有人在看的 `npm test`。

因此第一個 commit 就寫出**每一個 key 都在**的 `zh-TW.json`（值暫為英文原文），其後每一批
只**替換值**。守衛從第一天起就是綠的，而「哪些還沒翻」由人維護的清單追蹤 ——
**刻意不做 allowlist**：一個能宣告「這些 key 暫時不必存在」的守衛，與沒有守衛之間只差一次
「先加進 allowlist 之後再說」。

### D11 — 元件之外的 `t` 不會自己重繪，五處要各自處置

renderer 有五個模組直接 `import { t } from '@shared/i18n'` 而非 `useTranslation()`：
`files/names.ts`、`files/relative-time.ts`、`files/useFileTree.ts`、`KeyboardNavigation.tsx`、
`terminal/session-badge.tsx`。`t()` 於**呼叫時**解析，因此「下一次渲染」會拿到新語言 ——
問題只出在**值被存起來**的地方。

已知的一處是 `useFileTree.ts` 的 `describeFailure()`：它產生的字串進了 state，切換語言後
會維持舊語言直到該目錄被重新請求。處置是讓失敗以**結構**入 state（錯誤碼 ＋ 參數），
於呈現時才 `t()` —— 與「主行程拋出的錯誤帶不了 `code` 到 renderer」那條教訓同一形狀。

**這一處是被找出來的，不是被推理出來的**：其餘四處逐一確認過沒有把 `t()` 的結果存進 state
或 ref。加新的 module-level `t` 消費者時要重問一次這個問題。

### D12 — 兩道既有守衛各有一個結構性缺口，本 change 要一併補上

**它們不是順手清理 —— 這個 change 的交付成果直接架在它們上面。** 字典的完整性守衛只保證
「字典裡的每一條都翻了」，它對**從來沒進過字典的字**完全沉默；而那些字會在中文介面裡原樣
留著英文，交出一個半中半英的畫面，**同時每一道守衛都是綠的**。

1. **`aria-label-source.test.mjs` 對合成的 `aria-label` 視而不見。** 它的 pattern 對值以
   `${` 開頭者一律跳過，於是 `` aria-label={`${label} changes`} ``（`openspec/BrowseView.tsx:314`）
   逃掉了 —— 而 `probe-openspec.mjs:575` 正硬編著同一個 ` changes` 後綴。
   守衛要改為：模板字面值中**出現在 `${}` 之外的字面片段**同樣視為硬編。
2. **CJK 守衛與 `aria-label` 守衛之間有一塊沒有人管的地帶**：既不含 CJK、也不是 `aria-label`
   的**可見文字**。實際留著的有麵包屑的 `changes` / `specs` / `files`
   （`openspec/OpenSpecPanel.tsx:237,253`、`files/FilesPanel.tsx:306,317`）、
   `insights/charts.tsx:86` 的 `WEEKDAYS`、以及 `insights/InsightsOverlay.tsx:264-267` 的四組
   分桶標籤。它們要進字典。
   **不為此新增第四道掃描守衛** —— 「這個字串會不會被顯示」無法靜態判定（CLAUDE.md 既有結論），
   一道會誤報 `'utf8'`、`'\n'` 的守衛會立刻被加滿豁免。處置是把它們補進字典，
   並由 dogfood 以中文介面認定（10.4）。

## Risks / Trade-offs

- **[探針漏種語言 ⇒ 看起來像產品壞掉]** → D8 的原始碼守衛；對照組：拿掉任一處的種入，守衛變紅。
  **殘餘風險已知且寫在 D8**：守衛擋得住「整支忘了種」，擋不住「同一支的多個 profile 漏了一個」。
- **[驗收自己踩到 `LANGUAGE` 與 `LANG` 不一致]** → D1／D8 要求偵測段落同時設兩者，
  且 `run-probes.mjs` 正規化它們。**這台開發機的現況就是不一致的**，而第一版 design 的實測
  正是在一個被自己意外清空的 `LANGUAGE` 之下做的 —— 結論因此反了。
- **[沒進過字典的可見英文在中文介面裡原樣留著]** → D12 第 2 點把已知的補進字典；
  **這一類沒有機械守衛**（靜態判不出「這個字串會不會被顯示」），由 dogfood 認定。
- **[翻譯漏掉插值變數 ⇒ 少了檔名的句子]** → D7 第 3 條。
- **[呈現層對已持久化的本文重新翻譯 ⇒ 畫面與磁碟分岔]** → 規格條款（見 specs），
  而它**只在使用者換過語言之後才發生**，一輪探針碰不到 —— 載體必須自己造出「換語言」這個動作。
- **[主行程與 renderer 語言分岔]** → D4 的順序。
- **[升級後自己變成中文]** → D1 以「偏好檔不存在」為偵測條件。
- **[中文在終端裡是雙寬字元]** → session 重播的分隔線 `── 文字 ──` 兩側長度不再等寬。
  純美觀，且探針跑在軟體 GL 上**證明不了畫素**（`terminal-sessions` 已有的條款），由 dogfood 認定。
- **[設定對話框的版面]** → 中文通常較短，但語言選擇器是新的一列，且狀態列是混排字型
  （`leading-none` 那條教訓）。由 dogfood 認定。
- **[翻譯品質]** → 285 條集中在 `insights`/`intake`/`slack`/`openspec`，術語密度最高。
  這不是機制問題，機制擋不住它；由人逐條看過。

## Migration Plan

沒有資料遷移。`preferences.json` 多一個 `ui` 區塊，`version` 不動，舊檔照常讀入並維持英文。
回退即移除該區塊（讀入時被忽略）。
