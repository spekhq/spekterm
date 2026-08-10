## Context

`ChangeView.tsx:85` 的 `orderArtifacts(data.artifacts, data.schemaOrder)`：有 `schemaOrder` 就照它排，
沒有就**原樣**沿用 core 交付的順序（mtime 由新到舊）。`schemaOrder` 來自 core 的 `readChange`，它以
`cliSchemaOrderProvider` **spawn `openspec` CLI** 取得。

本 change 期間的實測（本機、AppImage 產物）：

| 觀察 | 結果 |
|---|---|
| AppImage 主行程的 PATH | 不含任何 nvm 路徑 |
| `openspec` 的安裝位置 | 只在 `~/.nvm/versions/node/<v>/bin/` |
| 該 PATH 下 `readChange` 的 `schemaOrder` | `undefined` |
| 該 PATH 下 artifacts 的順序 | `tasks, specs, design, proposal` |
| 前置 nvm bin 後的 `schemaOrder` | `[proposal, design, specs, tasks]` |

core 對 **archived change 一律不查** CLI（`scanner.js:227` 的 `status === "active"`），因此**每一個
封存的 change 都拿不到權威順序** —— 這條與 PATH 無關，修好 PATH 也不會消失。

**排序規則本身已經不在本 repo 的職責範圍內。** `@spekjs/core` 1.6.0 把 `sortArtifacts` 上移（本專案
回報後促成），1.7.0 再把它泛型化（spek #45，同樣由本 repo 撞到後回報），使它能直接吃
`ChangeArtifactView[]` 並原樣交回。

### 兩個推翻既有假設的實測

**一、`desktop-packaging` 那條要求所倚賴的機制，涵蓋範圍與它宣稱的不同 —— 但不是「完全無效」。**
該 requirement 說「此要求由既有的 login shell spawn 機制承擔」。查 `terminal.ts` 的 `spawnArgs`：
**兩個 spawn 目標給的參數不同**。

- **shell 目標回 `['-l']`** —— 掛在 pty 上就是**互動** login shell，會 source `.zshrc`。實測（真 pty）
  可以解析到 `~/.nvm/.../bin/openspec`。這條路**沒有問題**。
- **claude 目標回 `['-l', '-c', …]`** —— login 但**非互動**，不 source `.zshrc`。實測
  `zsh -l -c 'command -v openspec'` 無輸出、`node` 解析到系統的 v10.19.0。

也就是說：缺口只存在於 **claude 目標**，而 `claude` 目前找得到純粹因為它裝在 `~/.local/bin`（由 login
rc 提供）。**若改以 `npm i -g` 裝在 nvm 底下，那條 requirement 的 scenario 會在桌面啟動下失敗。**
本 change **不修那條路徑**（見 Non-Goals），但它已不是「已由既有機制完整承擔」。

> 第一版 design 把這寫成「該機制以 login（非互動）rc 為限」，對 shell 目標並不成立 —— 那是把兩個
> spawn 目標混為一談。

**二、PATH 的合併順序是承重的，而錯誤方向靜默。** `openspec` 的 shebang 是 `#!/usr/bin/env node`。
把使用者 PATH **附加在後**時，`openspec` 找得到、`node` 卻仍解析到系統的 v10.19.0：

```
$ env PATH="/usr/bin:/bin:$HOME/.nvm/versions/node/v22.22.0/bin" openspec status …
SyntaxError: Unexpected token {
```

CLI 以非零碼結束 ⇒ provider 回 `null` ⇒ **與「openspec 沒安裝」完全無法區分**。

## Goals / Non-Goals

**Goals:**

- artifact 分頁在**任何情況下**都以敘事順序為底，包含每一個 archived change。
- 使用者看得出眼前的順序是權威的還是退路。
- 讓權威順序在打包產物中**真的被取用**。

**Non-Goals:**

- **不自行實作排序規則。** 見 D1。
- **不修 `terminal.ts` 的 pty spawn 參數。** 上面第一個實測揭露 claude 目標在「裝於 nvm 底下」時可能
  解析不到，但那是獨立缺陷、獨立驗收（需要一台把 claude 裝在 nvm 的機器），且把 claude 目標改成
  互動 shell 會把互動 rc 的副作用帶進每一個 agent session。**轉為 issue 追蹤。**
- **不做 Windows。** 本 repo 對該平台無任何實測。
- 不改變 tasks／specs 分頁的內容呈現（那是 `spekjs-core-upgrade` 剛做完的事）。

## Decisions

### D1 — 排序整條委由 `sortArtifacts(artifacts, 'schema', schemaOrder)`

`orderArtifacts` 整個刪除。core 的 `schema` 模式**逐條就是本 change 要的行為**：

| 要的行為 | core 的契約 |
|---|---|
| 有權威順序就照它 | `schemaOrder` 非空 → 依它排 |
| 拿不到就走敘事順序 | `schemaOrder` 為 undefined／空 → 整體 `DEFAULT_ORDER` 序 |
| 權威順序只涵蓋部分 | 未涵蓋者接在其後，彼此依敘事順序，再以 id 字母序 tiebreak |

*為什麼不自己寫*：第一版 design 打算用 `DEFAULT_ORDER` + `defaultRank` 自己排。那會是**第三份**同語意
實作（web、core、我們），而 core 1.6.0 存在的理由就是消除它。1.7.0 的泛型化更是本 repo 撞上型別落差
後回報促成的 —— 促成了它卻不用它，等於白做。

*型別*：`sortArtifacts` 泛型的約束是 `Pick<ChangeArtifact, 'id' | 'title'>`，`ChangeArtifactView`
滿足它，且**回傳保持我們自己的型別**（`relPath` 不消失）。已實測：無需任何 cast。

*模式固定為 `schema`，不開放給使用者選*：spek web 有三個模式與偏好持久化，那是「瀏覽器全寬 + 使用者
在讀一份文件」的情境。側欄是「一邊駕駛 agent 一邊盯著」，多一個偏好等於多一個要記得的狀態。
**這個裁決日後要放寬很便宜**（core 的 `ARTIFACT_SORT_MODES` 現成），但現在不做。

### D2 — 退路生效時說明原因，判準與文案沿用上游

順序修好之後仍有一個問題：使用者無從得知眼前的順序是權威的還是推測的。而 **archived change 永遠拿不到
權威順序**，那不是偶發而是常態。

判準與 spek web 的 `ChangeDetail.tsx:231-238` 一致 —— **由 `status === 'archived'` 二分**，兩句話：

- archived：`Schema order isn't tracked for archived changes — showing default order.`
- 其餘：`Schema order unavailable — showing default spec-driven order.`

*為什麼不指出單一成因*：active change 的 `schemaOrder` 可能因 CLI 未安裝、無 `planningArtifacts`、
`outputPath` 對不上、逾時、非零結束而為空 —— 上游的註解明確記著「此處不指定單一成因」。我們沒有更多
資訊，猜一個具體原因會是**編造**。

*文案入字典*（`en.json`）—— 這是使用者可見文字，`copy-language` 與 `aria-label-source` 兩道守衛都適用。

### D3 — 修的是主行程的 `process.env.PATH`，不是傳自訂 `orderProvider` 給 core

`readChange(repoDir, slug, orderProvider?)` 允許注入 provider。**不走這條，理由不是「要複製
`idForOutputPath`」** —— 那是第一版 design 寫錯的：provider 只需回 `SchemaArtifactRef[]`，
`resolveSchemaOrder`（含那段 glob 對應）是 **core 自己**在 `readChange` 裡呼叫的。

真正的理由是要複製的東西仍然不小，而且**每一項都是 core 已經做好的**：`spawn` 與 argv 組法、10 秒
逾時與 `child.kill()`、以 `repoRoot::schema` 分桶的 30 秒 TTL 快取與 in-flight 去重、以及
`parseOrderFromStatus` 的 JSON 萃取（**這四樣都不在 `index.d.ts` 的公開介面**，已 grep 確認）。
自訂 provider 等於在 spekterm 維護一份 core 內部行為的複本。

**供應環境，不供應邏輯。** PATH 補上之後，core 內建的 provider 自己就跑得起來。

### D4 — 以**互動** login shell 取得 PATH，前置合併，並對 shell 種類設白名單

由 Context 的實測導出兩個硬性條件：

1. **必須是互動的**（`$SHELL -i -l -c`）。非互動不 source `.zshrc`，而那是 nvm 的常見（本機的實際）
   初始化位置。
2. **必須前置（prepend）**。附加在後會讓 `openspec` 被找到卻以系統 node 執行而 `SyntaxError`，
   且該失敗與「未安裝」無法區分。

合併規則：`PATH = <使用者 PATH 中不在現有 PATH 者，保序> + <現有 PATH>`。既有項目一個都不移除
（產物自身注入的 `/tmp/.mount_*` 要留著）—— 但要誠實：**它們會被降級**，排在使用者的路徑之後。
對本 repo 無害（不以裸名解析任何自帶 CLI），但那是「不移除」，不是「不受影響」。

**shell 白名單**：只對 `sh` / `bash` / `zsh` / `ksh` 執行，其餘（未知者）直接放棄。理由是
**`fish` 會靜默給出垃圾** —— 它的 `$PATH` 是 list，`printf '@@%s@@' "$PATH"` 會印成
`@@/a@@@@/b@@…`，「取標記之間」只會拿到第一個目錄。這種失敗不會拋錯，只會讓 PATH 少掉一大半。

**輸出解析**：`printf '@@%s@@' "$PATH"`，取**最後一組**標記之間的內容（互動 rc 印東西到 stdout 是
常態，而那些噪音裡也可能含 `@@`）。**stderr 以 `stdio: 'ignore'` 丟棄，不是接一條沒人 drain 的
pipe** —— 實測本機 zsh 在非 tty 下噴十行以上的 gitstatus 錯誤，沒 drain 的 pipe 滿了會讓子行程卡到
逾時。逾時／非零結束／解析失敗 ⇒ 一律放棄，維持原 PATH。**逾時必須 `child.kill()`**，否則每次啟動
可能留下一個卡住的互動 shell。

### D5 — PATH 在解析完成時**一次套用**，不在使用點套用；而它會改變 pty 的環境

第一版 design 把「套用 `process.env.PATH`」放在 `OpenSpecService.getChange()` 裡。**那是錯的**，
有兩個獨立的問題：

1. **`ptyEnv(source = process.env)` 整份繼承 `process.env`**，所以主行程改 PATH 之後每一個 pty 都跟著
   變。放在 `getChange()` 裡，等於「pty 拿不拿得到修好的 PATH，取決於使用者有沒有先點開過側欄的某個
   change」—— 順序相依，且失效方向靜默。
2. 接線也不成立：`OpenSpecService` 建於 `registerOpenSpecHandlers(store)`，`index.ts` 持有的 Promise
   傳不進去，除非加建構參數（連帶動到既有測試）。

作法：`whenReady` 早期呼叫 `startUserPathResolution()`，**在它的 `.then()` 裡套用一次**
`process.env.PATH`。`OpenSpecService` 只 `await` 同一個 Promise 做時序對齊，不負責套用。單一、確定的
套用點，接線問題一併消失。

**而「pty 的環境會變」必須明說**：這是本 change 的行為變更，不是副作用。方向是好的（agent session
從此也解析得到 nvm 底下的東西），但它讓 Non-Goals 裡「不修 pty」那條的語意變精確 —— **不修的是
spawn 參數，環境確實會變**。

實測互動 login shell 約 **1.3 秒**（powerlevel10k + gitstatus + nvm + compinit），因此不放進啟動的
關鍵路徑。逾時取 **5 秒**（而非 3 秒）：1.3 秒是**熱的**，開機後第一次（compinit 快取冷、gitstatus
daemon 未起）合理更慢，而逾時的代價是靜默落到退路。

### D6 — 平台閘

`process.platform === 'win32'` 直接放棄。Windows 沒有 `$SHELL -i -l -c` 的對應，且本 repo 對該平台無
任何實測。

### D7 — PATH 那半的驗收判準是「**退路說明有沒有出現**」

第一版 tasks 要以 `/proc/<pid>/environ` 確認主行程 PATH 已含 nvm。**那在物理上做不到**：
`/proc/pid/environ` 讀的是 exec 當下的初始堆疊區，glibc 的 `setenv()` 改的是堆積上的 `__environ` ——
**修法完全正確時它也會回報「沒有 nvm」**。一條恆假的檢查等於沒有檢查。

正確的判準是**行為**，但**不是「順序長什麼樣」** —— 那條路查證後走不通：`openspec` 只有兩個內建
schema（`spec-driven`、`workspace-planning`），兩者的 `actionContext.planningArtifacts` 都是
`proposal, design, specs, tasks`，**恰好等於敘事順序**，而 CLI 沒有提供自訂 schema 的機制。
也就是說「schema 順序 ≠ 敘事順序」的 repo 造不出來，拿順序當判準永遠分不出兩條路。

**判準改為 D2 的那句說明的有無** —— 它與順序無關，正好是這件事的區分器：

| 主行程解析得到 `openspec` | `schemaOrder` | 畫面 |
|---|---|---|
| 是 | 有值 | **不呈現**說明 |
| 否 | `undefined` | 呈現「Schema order unavailable…」 |

於是人工驗收是：`dist:linux` 後**自應用程式選單**啟動，開一個**進行中**的 change，**不應出現任何
退路說明**。出現了就表示主行程仍解析不到 `openspec`。

**一個時序上的注意事項**（spek #46）：core 對取不到的結果也快取 30 秒，而 app 啟動早期的第一次讀取
可能落在 PATH 補好之前。因此驗收要在啟動**約一分鐘後**才判讀 —— 若 PATH 真的沒修好，那句說明會
**永遠**在；修好了則至多在最初半分鐘出現。

> 這條判準的一個附帶性質：**D2 的說明讓 PATH 那半第一次有了可觀察的產物。** 在它之前，
> 「權威順序有沒有被取用」在 spec-driven 之下完全沒有使用者可見的差別。

## Risks / Trade-offs

- **[執行使用者的互動 rc 有副作用]** → 與 pty 每次 spawn 所做的事同級（那也是互動 login shell）。
  一次性、輸出丟棄、失敗不影響任何其他功能。
- **[前置使用者 PATH 會改變主行程解析其他外部程式的來源]** → 主行程經 core 只 spawn `git` 與
  `openspec`。使用者 PATH 前段若有自備的 `git`，主行程會改用它 —— 那正是「代表使用者執行」該有的
  語意。已知且刻意。
- **[cwd 會影響取得的 PATH]** → 本機 `.zshrc` 有 `load-nvmrc` 的 chpwd hook。解析時的 cwd 是主行程的
  cwd，拿到的是 nvm default 版本 —— 而 `openspec` 在該版本下存在。**這是前提不是保證**：使用者若只
  在某個特定 node 版本裝了 openspec，仍會拿不到。退路承接，且 D2 的提示會說出來。
- **[權威順序仍可能拿不到]** → openspec 未安裝、rc 逾時、非 POSIX、非白名單 shell。這正是 D1 退路與
  D2 提示存在的理由 —— 三者**互為保險而非串聯**。
- **[版面會變]** → 提示是新增的一列。CLAUDE.md 有一條實測教訓：版面一動，以真滑鼠座標點擊的探針就
  開始點空，症狀是時綠時紅。驗收要涵蓋 `probe:openspec`，且出現 flaky 時第一嫌疑是版面而非時序。
