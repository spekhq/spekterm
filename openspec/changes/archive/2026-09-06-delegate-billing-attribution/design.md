## Context

動機見 `proposal.md`。這裡只記把方案定下來所需要的現況。

**委派的環境目前是這一行**（`src/main/ipc/insights.ts` 的 `spawnReportDelegate`）：

```ts
env: { ...process.env, ...userEnv, PATH: userEnv.PATH ?? process.env.PATH ?? '' }
```

而它上方的 docstring 第 4 點寫著「`PATH` 取自 `getUserEnv()`」—— **那句話是錯的，而且是死的**：
`getUserEnv()` 結構上不含 `PATH`（`user-env.ts:176` 的 `const { PATH: userPath, ...rest } = resolved`
把它拆走了，`:150–152` 的註解說明那是刻意的），所以 `userEnv.PATH` 恆為 `undefined`，
左邊那個運算元從第一天起就沒有作用。

**這件事讓事實比原本以為的更乾淨**：`userEnv` 對委派今天的貢獻，除了憑證洩漏之外**是零**。

**兩份環境各自帶著什麼（皆為實測）：**

| 來源 | 內容 | 這裡的意義 |
|---|---|---|
| `userEnv` | 使用者互動 login shell 的完整環境 | `user-env.ts` 檔頭自陳持有「API 憑證、服務端點」 |
| `process.env` | 主行程自己的啟動環境 | 自桌面選單啟動時很乾淨；**自終端機啟動時等同那個終端機** |

第二列是容易被略過的一半。**從 Claude Code session 裡啟動 spekterm 時，`process.env` 實測含有**
（2026-09-06，本機，恰為 11 個）：

```
CLAUDECODE  CLAUDE_CODE_ENTRYPOINT  CLAUDE_CODE_SESSION_ID  CLAUDE_CODE_CHILD_SESSION
CLAUDE_CODE_BRIDGE_SESSION_ID  CLAUDE_CODE_MESSAGING_SOCKET  CLAUDE_CODE_MESSAGING_TOKEN
CLAUDE_CODE_EXECPATH  CLAUDE_PID  CLAUDE_EFFORT  CLAUDE_CODE_NO_FLICKER
```

`terminal.ts` 為 pty 剝除的 `NESTED_CLAUDE_ENV` 是為了這一類，而**委派這條路一個都沒剝**。
`CLAUDE_CODE_MESSAGING_SOCKET` / `_TOKEN` 是一條通往**父 session** 的通道 —— 那是剝除它們
最直接的理由。

> **一個曾經寫在這裡、後來被實測推翻的理由。** 前一版說「依 `docs/lessons/terminal.md` 的
> 二分實測，`CLAUDE_CODE_CHILD_SESSION` 單獨一個就會讓 `claude` **完全不寫 transcript**」，
> 並據此推論委派的紀錄不存在、刪除步驟會回報「刪不掉」。**那是外推，不是實測** ——
> 那個二分實測的對象是**掛在 pty 上的互動式 claude**。
>
> 實測（2026-09-06，`claude` 2.1.263，以不存在的模型跑 `-p`，`total_cost_usd: 0`）：
>
> | | 帶著 `CLAUDE_CODE_CHILD_SESSION` | 剝除它 |
> |---|---|---|
> | 是否寫下紀錄 | **有**（221,740 bytes） | **有**（221,758 bytes） |
>
> **`-p` 這條路照寫不誤。** 剝除的理由因此只剩下白名單本身與那條通往父 session 的通道 ——
> 兩者都夠，但**不能用一個沒有發生的後果去論證它**。

> **`NESTED_CLAUDE_ENV` 只有 7 個名字，涵蓋上面 11 個裡的 5 個** —— 另外 6 個今天照樣流進
> 每一個 pty。那是 pty 那條路的缺口，**不在本 change 的範圍**（見 Non-Goals），已登記為 issue。

**官方的認證優先序**（`code.claude.com/docs/en/iam`，2026-09-06 讀）共七層，訂閱 OAuth 排**最後**。
能排在它前面的環境變數，在 `env-vars` 頁上目前約有 25 個，且明顯還在增加。
**其中一個是例外**：`CLAUDE_CODE_OAUTH_TOKEN`（第 5 層）是 `claude setup-token` 產生的
**訂閱**憑證 —— 它排在 `/login` 之前，但**不產生 API 計費**。

**一個已存在的耦合**：`report.ts:149` 的 `deleteDelegateRecord` 以 `deps.configDir()`
（＝`resolveConfigDir()`）算出要刪的路徑。今天它與委派實際寫入的位置對得上，是因為
委派拿到整份環境、而 `resolveConfigDir()` 讀的是**同一組來源、同一個優先序**。

**而委派失敗時，語料副本會留在磁碟上**（實測）：`report.ts:177` 的 `if (!run.ok) return`
早退在刪除之前，而失敗的那一趟**照樣寫了紀錄**。無憑證的 `-p` 實測 exit 1、
`is_error: true`，紀錄檔仍然產生。那份副本沒有任何程式碼會去刪，活 30 天。

## Goals / Non-Goals

**Goals:**

- 委派行程的環境**結構上**不可能挾帶會改變認證來源或計費歸屬的變數 —— 包含今天還不存在的名字。
- 「委派寫紀錄的位置」與「我們刪紀錄的位置」由**同一次解析**決定。
- **委派留下的語料副本不分成敗都被刪除。**
- 這些性質有單元測試載體，且對照組會紅。

**Non-Goals:**

- **不動 pty 的環境。** 互動式 `claude` 會就 API key 問使用者一次，那個提問就是同意。
  上面那個 `NESTED_CLAUDE_ENV` 涵蓋不全的缺口同屬 pty 那條路，開 issue 處理。
- **不處理非環境變數的憑證來源。** `settings.json` 的 `apiKeyHelper`、設定目錄下的
  Anthropic profile 檔案、已登入的 gateway session 都不經環境變數，**這個 change 碰不到它們**。
- **不新增失敗碼。** 憑證不足在 `claude` 那端就是一個錯誤，既有的 `delegateFailed` 已涵蓋。
- 不改掃描行程（`utilityProcess.fork`，不做模型請求，也不繼承 shell 環境）。

## Decisions

### D1：白名單，不是剝除清單

**採白名單建構委派環境**：明確列舉要傳進去的變數，其餘一律不傳。

替代方案是剝除清單（`ANTHROPIC_API_KEY`、`ANTHROPIC_AUTH_TOKEN`、`CLAUDE_CODE_USE_BEDROCK`
之屬）。**否決它的是這個 repo 自己的紀錄**，`user-env.ts` 檔頭：

> 一份「不可覆寫」的黑名單會遺漏尚未存在的變數（下一個 Electron 版本新增的那些），
> **且遺漏是靜默的**。

Context 的清單就是這句話的兌現：憑證與端點變數在一年內從三、四個長到二十幾個。
一份剝除清單需要有人定期去讀官方文件並補名字 —— 而漏補的徵狀是「一切正常」。

**也不採前綴法。** `terminal.ts:101` 記著「**絕不以 `CLAUDE*` 前綴一概剝除**：
`CLAUDE_CODE_OAUTH_TOKEN` 是認證用的」。那條教訓在這裡完全適用，而且**方向要看清楚**：
它是訂閱憑證，剝掉它不會換掉任何人的計費歸屬，只會讓以它為唯一憑證的訂閱使用者
**登不進去**。因此它**在白名單上**（見 D2）。

> **這一條是 review 抓出來的自相矛盾。** 前一版拿它去否決前綴法，然後自己的白名單
> 也沒有放它 —— 用來論證的那個受害者，在選定的方案下同樣受害。
> **「不在清單上」與「明確剝除」在後果上沒有差別。**

白名單順帶把 Context 講的 `NESTED_CLAUDE_ENV` 缺口在委派這條路上一併關掉 ——
**不是額外做了什麼，是那些名字不在清單上**。

### D2：白名單的內容，以及每一項為什麼在上面

**呼叫端 SHALL 傳 `process.env` 本身，不可展開成普通物件。** Node 對 `process.env` 在 Windows 上
是**大小寫不敏感**的代理；展開之後實際的鍵是 `Path`、`SystemRoot`、`Temp`，而白名單查的是
大寫形式 —— 全部 `undefined`，委派連 `claude` 都找不到。**這正是下面那組 Windows 變數
想避免的失敗，用另一種方式重新製造一次。**

**計算出來的：**

| 變數 | 值 | 為什麼 |
|---|---|---|
| `PATH` | `processEnv.PATH` | **不是** `userEnv.PATH`（見 Context：那是死運算元）。`process.env.PATH` 已是使用者路徑前置後的**超集**（`user-env.ts:123–136`），用它才不會丟掉產物自身注入的項目 |

**存在才轉送的（`processEnv` → `userEnv` 覆蓋，維持既有的優先順序）：**

- `HOME` —— 認證憑證（`~/.claude/.credentials.json`）與設定目錄的預設位置都靠它。**沒有它委派一定失敗。**
- `CLAUDE_CODE_OAUTH_TOKEN` —— **訂閱**憑證。轉送它**維持**本 change 想要的計費歸屬，
  不轉送它才是製造受害者。見 D1。
- `CLAUDE_CONFIG_DIR` —— **只在使用者明確設定時**轉送，見 D3。
- `USER`、`LOGNAME`、`TMPDIR` —— 行程執行環境的基本設定。
- `LANG`、`LANGUAGE`、`LC_ALL`、`LC_CTYPE`
- `HTTP_PROXY`、`HTTPS_PROXY`、`ALL_PROXY`、`NO_PROXY` 及其小寫形式、`NODE_EXTRA_CA_CERTS`、
  `SSL_CERT_FILE`、`SSL_CERT_DIR` —— 公司網路裡少了這些連不出去。**它們決定「經過誰」
  而不是「算誰的帳」**，且與使用者自己的終端機一致。見 Risks。
- Windows 的最小集（`SYSTEMROOT`、`COMSPEC`、`PATHEXT`、`USERPROFILE`、`APPDATA`、
  `LOCALAPPDATA`、`TEMP`、`TMP`）—— **本 repo 無 Windows 實測**，但少了 `SYSTEMROOT`
  連 Node 都起不來。現在列上去的成本是零，日後才發現的成本是一個只在 Windows 出現的 bug。

**刻意不在上面的：**

- 憑證、計費歸屬與端點那二十餘個（`ANTHROPIC_API_KEY` / `_AUTH_TOKEN` / `_BASE_URL` /
  `_PROFILE` / federation、`CLAUDE_CODE_USE_BEDROCK` / `_VERTEX` / `_FOUNDRY`、`ANTHROPIC_AWS_*`、
  `ANTHROPIC_FOUNDRY_*` …）—— 本 change 的目的。
- `SHELL` —— 工具全關（`--allowed-tools ''`）、非互動，它唯一可能生效的地方是 `apiKeyHelper`
  的執行，**也就是一條憑證路徑**。實測不傳它委派照樣跑得起來。收益零、暴露面非零。
- `TERM` —— 非互動、stdio 是 pipe、輸出走 `--output-format json`。實測不需要。
- `XDG_CONFIG_HOME` —— 它不在清單上是因為它不是委派需要的東西，**不是因為排除它提供了保護**。
  Anthropic profile 住在 `~/.config/anthropic`，不轉送它只是讓委派回到那個預設位置；
  **檔案已經在那裡的話，這條擋不住**（見 Non-Goals）。
  （順帶：dev 模式今天把 `XDG_CONFIG_HOME=~/.config/spekterm-dev` 原封轉送出去，
  反而**意外地遮蔽了** profile —— 白名單之後那個意外的遮蔽會消失。本機該目錄不存在，
  所以今天沒有實際差異。）
- `NODE_OPTIONS` —— 能改變 `claude` 這支程式的行為，且是使用者環境裡的常客。

> **白名單「夠不夠」已實測**（2026-09-06，`claude` 2.1.263，native installer）：
> 以 `env -i` 只給 `PATH` / `HOME` / `USER` / `LOGNAME` / `LANG` 跑一趟真實的
> `claude -p --output-format json`，**exit 0 並取得回覆**。該安裝是單一 ELF 執行檔
> （不需要 node、與 nvm 無關），認證讀 `~/.claude/.credentials.json`，未連結 libsecret
> （故 `DBUS_SESSION_BUS_ADDRESS` / `XDG_RUNTIME_DIR` 不需要）。
> **這只覆蓋這一種安裝方式**；npm 安裝法的 `#!/usr/bin/env node` 由 `PATH` 涵蓋。

### D3：`CLAUDE_CONFIG_DIR` 只在使用者明確設定時轉送 —— 合成預設值會搬走設定檔

**前一版的 D3 是錯的，而且是實測推翻的。** 它主張「恆設定為 `resolveConfigDir()` 的結果，
即使使用者沒設過（那時它就是 `~/.claude`），語意上等於不變」。實測（2026-09-06，
`claude` 2.1.263）：

- `CLAUDE_CONFIG_DIR` **未設定**時，claude 的主設定檔是 **`~/.claude.json`**。
- 設定之後變成 **`$CLAUDE_CONFIG_DIR/.claude.json`**。

而 `resolveConfigDir()` 的預設值是 `~/.claude` —— 兩者**不是同一個檔案**。對沒設過的使用者
（也就是絕大多數）明確傳入之後，claude 會去找 `~/.claude/.claude.json`（不存在），
於是**憑空建出一份「首次啟動」的空設定**，並印出三行 "Claude configuration file not found at…"。
實測產生了一個 39,417 bytes 的新檔，其 `projects` 為空、沒有 onboarding 狀態。

**而那三行訊息若落在 stdout，讀後感在每個使用者的第一趟會整個壞掉** ——
`report-runner.ts:58` 是 `JSON.parse(stdout)`，零容忍（不取最後一行、不濾非 JSON 前綴），
失敗即 `unparsableReply`。**「只有第一次會發生」是最容易被放行的形狀**：dogfood 跑第二次
就再也看不到。（該訊息走 stdout 還是 stderr **未能重現、查不出結論** —— 而正確的做法讓
這個問題不必回答。）

**這是「不要從語意推論，要實測」那條教訓的又一次兌現**，而且它躲過了自己的 dogfood 計畫：
前一版 tasks 的 5.4 只驗「委派紀錄刪除成功」，而 `projects/` 的位置在兩種寫法下**相同**，
設定檔搬家會靜默通過。

**改為：白名單存在才原樣轉送 `CLAUDE_CONFIG_DIR`，不合成預設值。**

而 D3 原本想要的結構保證另外達成 —— **由 `report.ts` 在 `generate()` 解析一次**：

```
const explicit = deps.explicitConfigDir()          // string | undefined
const configDir = explicit ?? defaultConfigDir()   // 刪除路徑用這個
deps.spawn({ configDir: explicit })                // 委派環境用這個
```

同一次解析、兩個衍生值，「兩邊分歧」表達不出來。**`spawn` 的簽名因此要從 `() => DelegateHandle`
改為收一個參數** —— 那同時把這條規格的載體從「無法測的接線」變成「`fakeDelegate` 記下它收到
什麼」（見 D5）。

> **邊界情形**：使用者把 `CLAUDE_CONFIG_DIR` 明確設成 `$HOME/.claude` 時，它會被當成明確值
> 轉送 —— 而那正是他自己的互動式 claude 看到的值，兩者一致，沒有分歧。

### D4：純函式住在 `report-runner.ts`，比照 `delegateArgs`

新增 `delegateEnv(input): NodeJS.ProcessEnv`，輸入為 `{ processEnv, userEnv, configDir }`
（`configDir` 型別為 `string | undefined`），全部由呼叫端注入、無預設。

`spawnReportDelegate` 住在 `ipc/insights.ts`，那支 import electron，**在 `node:test` 裡載入不起來**。
`delegateArgs` 當初被抽出來就是為了這個。`report-runner.ts` 目前唯一的 import 是一個 `import type`，
新函式不需要 `app.getPath`、不需要 electron。

**`configDir` 必須在 `spawn` 的 closure 之內求值**，不可寫在物件字面值上 —— 後者會在
`whenReady` 當下快照，而 `applyUserEnvOnce()` 可能還沒完成（`getUserEnv()` 那時是空的）。

### D5：三組對照，而不是一組

使用者機器上 `ANTHROPIC_*` 一個都沒設定（已實測）。測試若只是「把真實環境餵進去、
斷言沒有 API key」，**它在修正之前就是綠的**。載體要主動注入。而注入什麼、對照組換成什麼，
決定了它測得到哪一句話：

| 對照組 | 預期 |
|---|---|
| 換回 `{ ...processEnv, ...userEnv, PATH }` | 「憑證不進去」那幾條紅 |
| 白名單移除 `HOME` | 「委派仍取得執行所需的環境」紅 —— **它守的是相反的失效方向，在第一組對照下本來就不該紅** |
| 換成一份剝除清單（明確 delete 掉那幾個已知名字） | 「鍵集合相等」**必須紅** |

**第三組是 D1 唯一的載體。** 若注入的變數全都落在「白名單有」或「剝除清單有」之內，
兩種實作產生的鍵集合**完全相同** —— 於是這條規格的形狀（白名單 vs 剝除清單）根本沒被測到。
注入集合因此必須包含**兩份清單都沒有**的名字：`TERM`、`XDG_CONFIG_HOME`、`NODE_OPTIONS`，
以及至少一個**發明出來的**名字（「今天還不存在的名字」只有發明一個才驗得到）。

**斷言的形狀是「輸出的鍵集合等於一個字面陣列」。** 不可寫成 `[...WHITELIST, …]` 從實作 import
——那是「兩端讀同一個常數」，往白名單加一個憑證名字照樣全綠。

### D6：兩處文案，事前與事中各一

D1 的取捨有看得見的受害者（Risks 第一條），因此兩個時點都要說得清楚：

- **事前**：授權畫面新增一句，說明委派以使用者 `claude` 自身的登入執行，
  shell 環境中的**憑證**不會被使用。（措辭用「憑證」而非「端點設定」—— proxy 是**會**轉送的，
  spec 自己區分了「經過誰」與「算誰的帳」，文案不可與它打架。）
- **事中**：`insights.report.error.delegateFailed` 目前是 "Running claude once in a terminal will
  show whether it needs you to log in."。對這類使用者**是誤導** —— 他在終端機跑得起來。
  改寫為同時涵蓋「還沒登入」與「憑證只存在於 shell 環境因而不被使用」兩種情況。

**事中那一處才是他真正需要那句話的時刻**，前一版只做了事前那一處。

### D7：委派留下的語料副本不分成敗都刪，且以目錄為單位

現行的刪除只在成功路徑上、且以 `sessionId` 定位單一檔案。兩個問題：
失敗的那一趟照樣寫了紀錄（Context 已實測），而失敗路徑上根本拿不到 `sessionId`
（`RunOutcome` 的失敗分支只有 `code`）。

**改為：一趟委派結束後，無論成敗，刪除委派專案目錄的內容。** 那個目錄是
`<configDir>/projects/<encodeProjectDir(delegateCwd)>`，而 `delegateCwd` 是本應用程式
在 userData 底下管理的**專屬空目錄** —— 該目錄下不會有別人的紀錄，以目錄為單位是安全的，
而且它**不需要 `sessionId`**，於是逾時、回覆無法解析、憑證錯誤這幾條路一併涵蓋。

既有那條「刪完要回頭確認目錄真的空了，不能只看 `rmSync` 有沒有拋錯」的紀律保留 ——
理由一字不差（`force: true` 對不存在的路徑不拋錯，於是「路徑一直算錯」會被回報成「刪掉了」）。

**這個 change 必須處理它，而不是開 issue**：整個取捨論證建立在「一個看得見的失敗，好過一筆
沒有人同意過的帳單」之上，而這個 change 正是把一類使用者從「成功」推向「失敗」的原因 ——
放著不修，那個失敗每按一次就多留一份 60 萬字元的語料副本。

## Risks / Trade-offs

- **憑證只存在於環境變數的使用者，讀後感會停止運作** —— Bedrock / Vertex / Foundry、
  `ANTHROPIC_AUTH_TOKEN` 走 gateway、或以 API key 為唯一憑證的人。
  （`CLAUDE_CODE_OAUTH_TOKEN` **不在此列**，見 D2。）
  → **這是刻意選的方向**：一個看得見的失敗，好過一筆沒有人同意過的帳單。緩解是 D6 的兩處文案，
  以及 D7（失敗不再留下語料副本）。對本機使用者代價為零。
  → 若日後要支援那些環境，正確的做法不是放寬白名單，而是讓使用者明確選擇委派的憑證來源
  （一個設定、一次同意）。那是另一個 change。
- **白名單放行了 proxy 與憑證信任那一組，而它們決定語料「經過誰」。** proposal 說「送去哪裡比
  誰付錢更嚴重」，這裡是那句話的例外，**要寫下來而不是靠 D2 的一句辯解**：
  → 它們是使用者機器層級的設定，他自己的終端機、每一個 pty 裡的 claude 都在用同一組。
  排除它們不會提高安全性（他的 claude 本來就經過那台 proxy），只會讓公司網路裡的人連不出去。
- **`CLAUDE_CONFIG_DIR` 本身是一個「憑證目錄選擇器」**，而它在白名單上。設定目錄決定
  `settings.json`（含其 `env` 區塊與 `apiKeyHelper`）與 `.credentials.json` 的位置 ——
  所以「結構上不可能挾帶選擇憑證的東西」這句話對**這一個**白名單項目並不成立。
  → 不轉送它的代價更大（委派讀不到使用者的憑證，且刪除不變式破裂）。這一項是知情的例外。
- **白名單漏掉某個 `claude` 真正需要的變數，症狀是委派失敗** —— 而失敗訊息不會說是為什麼。
  → 緩解：D2 逐項寫下理由並附一次 `env -i` 實測；`HOME` 與 `PATH` 有專屬斷言。
  **這個方向的失效是可見的，比放寬白名單那個方向便宜。**
- **`ANTHROPIC_MODEL` 之屬也一併不轉送**，於是使用者的預設模型偏好對委派無效。
  → 這其實是要的：既有規格說「報告記錄的是本應用程式請求的模型」，轉送它會讓那條記錄變成不實。
- **Windows 那八個變數沒有實測** —— 它們在清單上是為了「日後不必回頭 debug 一個 Windows 專屬
  的啟動失敗」，不代表 Windows 已驗過。

## Open Questions

- **委派環境要不要帶 `TZ`？** 目前不帶（日期歸屬由存檔決定，不由委派的回覆決定 —— 既有規格
  已如此），所以委派看到的時區不影響任何落盤的值。不影響本 change 的規格、方案或工作切分。
