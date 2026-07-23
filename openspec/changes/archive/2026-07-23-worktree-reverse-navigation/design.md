## Context

`targetOfPath()`（`src/renderer/src/shell/openspec/nav.ts:31`）是反向導覽的整個判準：

```ts
if (segments[0] !== 'openspec') return null
```

它在**渲染期間同步**被呼叫（`FilesPanel.tsx:292`），回 `null` 就不畫 **View in OpenSpec** 那顆
按鈕。邊界內 worktree 的檔案其 folder-relative 路徑是
`.claude/worktrees/<slug>/openspec/changes/<slug>/proposal.md` —— 首段是 `.claude`，於是入口消失。

**難處不在改判準，在於 renderer 沒有做這個判斷的詞彙。** 工作目錄清單主行程有
（`AggregatedScanResult.worktrees`），但送往 renderer 的 `ChangeOrigin`（`openspec-service.ts:94`）
**刻意丟棄了絕對路徑** —— 那是 `openspec-worktree-aggregation` 獨立稽核抓到的 CRITICAL
（關係圖把 worktree 的絕對路徑洩漏給 renderer），不可回頭。現有的 DTO 只有 `key`（路徑的 sha1
前 8 碼，不可逆）、`branch`、`vcs`、`isMain`、`isFolderRoot`，**沒有任何一個能回答「這個 relPath
落在哪個工作目錄底下」**。

另兩個約束：

- **`FilesPanel` 目前完全不碰 OpenSpec 資料**。它只拿 `folder`，入口的 gate 是
  `folder.hasOpenSpec`（`SidePanel.tsx:86`）。
- **但 `OpenSpecProvider` 位於 `MainStage` 之上**（`data.tsx`，AppShell 層），所以 `FilesPanel`
  在它的 context 之內 —— 取數與「隨 `openspec:changed` 自動重取」的機制是現成的，不必新造。

## Goals / Non-Goals

**Goals:**

- 邊界內 worktree 的 OpenSpec 檔案，在 Files 身分中提供 **View in OpenSpec**，與非 worktree
  佈局的行為一致。
- 判準是**查一份權威清單**，不是猜路徑形狀 —— `docs/openspec/changes/<slug>/proposal.md`
  這種「結構與 OpenSpec 完全相同、但不在任何工作目錄的 `openspec/` 底下」的檔案不得被誤判。
- 保持入口的呈現為**每次開檔零 IPC** 的同步決定（清單 per-folder 取一次，見 D1 的窗口說明）。
- renderer 不因此獲得任何表達 workspace 之外位置的詞彙。

**Non-Goals:**

- **邊界外 worktree**（`/tmp/...`）。Files 根本看不到那些檔案，`worktree-aggregation` 既有的
  「僅檔案導覽降級」不變。
- **正向導覽**（change → 檔案），已可用。
- **驗證 slug/topic 是否真的存在**（見 D5）。
- **`hasOpenSpec` 的偵測範圍**（見「Risks」的既有缺口）。

## Decisions

### D1：主行程供應「各工作目錄的 folder-relative 根」，renderer 同步比對

判準改為：**以工作目錄根由長至短逐一嘗試，剝除該根之後的首段是 `openspec` 且其後符合已知結構
者即命中，取第一個命中的結果**。

folder 自己的根是空字串，於是既有的 `openspec/...` 路徑仍然命中同一條規則 —— **這不是加一個
特例，是把現行行為收編為一般情形的一個實例。**

**「逐一嘗試」不等於「取最長的那個根」**（稽核指出的）。後者只試一個根，某個較長的根剝出來
之後若不成立就直接放棄；前者會繼續試較短的根。兩者在正常佈局下同解，但工作目錄開在病態位置
（例如 `<repo>/openspec/wt`）時只有前者不會失手。由長至短只是**tie-break**，用於工作目錄巢狀
的情形。

考慮過的另外兩條：

| | 為什麼不選 |
|---|---|
| **B. 反推整個移進主行程**（新增 `resolveTarget(folderId, relPath)` IPC） | 判準最強（主行程可以真的查表確認那個 slug 存在），但它是**非同步**的。入口的呈現要從渲染期間同步改為 effect + state：每切換一個檔案就一次 IPC 往返，按鈕會晚一拍出現。為了一個布林值付這個代價不划算 |
| **C. 在 `ChangeSummary` / `SpecSummary` 補 relPath，renderer 以清單反推** | 判準同樣強，但要把**整份 change 與 spec 清單**送進 Files 身分（它現在一份 OpenSpec 資料都不碰），資料量比一份工作目錄根清單大一個量級，且 `ChangeSummary` 目前**沒有** relPath（`ChangeInfo` 無 `path` 欄位，已查證），等於也要改 DTO |

A 的資料極小（一個 repo 通常 1–5 個工作目錄）、變動極少，且它是 renderer 完全合法的詞彙：
folder-relative 路徑，翻不出來的就整筆省略。

**A 也有一個非同步窗口，只是量級不同（稽核指出的，原表格漏了）**：清單本身經 IPC 取得，於是
首次進入某個 folder 的 Files 身分時，入口仍會晚一拍出現。差別是 **per-folder 一次**（其後隨
revision 快取），而 B 是**每切換一個檔案一次**。否決 B 的理由因此要精確化為「B 把窗口放在每次
開檔的熱路徑上」，而不是「A 沒有窗口」。這個窗口的呈現規則寫進了 spec（清單未取得時不呈現入口）。

### D2：以專用的 IPC method 供應，不塞進 `getOverview`

`getOverview` 的欄位全是計數（`specCount` / `activeChangeCount` / `taskStats`…）—— 它是「概況」。
工作目錄根是**定址資料**，塞進去會把那個 DTO 變成雜物袋，而且 Files 身分為了一個布林去取一份
「OpenSpec 概況」，讀起來就是錯的。

代價是 preload 白名單 +1，`probe:shell` 的白名單守衛要跟著更新 —— **那正是它存在的理由**
（`panel-drive-and-shell-affordances` 就因為「這次沒改到那塊」而讓守衛帶著兩條紅燈被封存）。

**這是對「IPC 形狀對齊 spek 的 `ApiAdapter`」的一次刻意偏離**（`openspec-side-panel` D1）：
spek web 沒有 folder 邊界的概念，這個 method 是宿主特有的，不可能在 `ApiAdapter` 上有對應物。
對齊的目的是「日後接 `@spekjs/ui` 時換的是 UI、不是接縫」，而這個 method 不參與那件事。

**不放進 `WorkspaceFolder`。** `workspace-folders` 明文要求 rail 的偵測「SHALL 以單次檔案系統
查詢完成、SHALL NOT 呼叫任何外部程式」，而工作目錄列舉必經 core（會 spawn `git worktree list`）。
那條規格與 worktree 列舉的衝突正是 issue #5 卡住的地方 —— **本 change 不去碰它**，把資料留在
OpenSpec 的資料層（它本來就在 core 的掃描路徑上，成本已經付了）。

### D3：worktree 裡的 `openspec/specs/` **照樣給入口** —— 導覽的目標是 topic，不是檔案

**core 的聚合對 spec 與 change 的處理不同**：`specs: main.scan.specs` —— spec 一律取自主工作
目錄（CLAUDE.md 已記為「三個讀取根」）。於是 `.claude/worktrees/wt-a/openspec/specs/auth/spec.md`
這個檔案**不在**側欄的 spec 清單裡，跳過去呈現的是主工作目錄那一份。

**這仍然應該給入口**，四個理由：

1. **反向導覽的目標型別自己就說了語意**：`{ kind: 'spec'; topic: string }` —— 它是「跳到這個
   **topic**」，不是「跳到這個**檔案**」。正向導覽（spec → `Open in Files`）才是檔案層級的。
2. **不給會製造另一種不對稱**：同一個 spec 檔案，在主工作目錄開有入口、在 worktree 開沒有 ——
   而消滅這種不對稱正是本 change 的目的。
3. **判準因此保持統一**：不需要在清單上帶「是不是主工作目錄」，也不需要 `specs` 分支特判。
   與 D4 同一個精神 —— 判準的正確性來自結構，額外的特判是複雜度，而複雜度是新 bug 的住處。
4. **不給也修不好問題**：使用者開著的那個檔案確實是一份 spec，拿掉入口只是讓他無路可走，
   並不會讓他更清楚「側欄呈現的是哪一份」。

**兩份內容分歧不是罕見情形 —— 它是每個 change 出貨前的常態終局。** `common-openspec-change`
skill 的流程 C 步驟 1 明寫「worktree 內：tasks 全勾、測試綠、**main spec 該 backfill 的先補**
（archive 前置）」（`~/.claude/skills/common-openspec-change/SKILL.md:51`）—— backfill 就發生在
worktree 裡。而那正是使用者最常盯著側欄的時刻。

**因此「標示來源」不是退路，是本 change 的交付項**（已寫進 `openspec-panel` 的 delta）：spec
檢視 SHALL 標示其內容的來源工作目錄。少了它，D3 就是在製造一個安靜的謊。

**還有一個代價，比內容分歧更尖銳（稽核指出的）**：`getSpec` 回的 `relPath` 一律取自主工作目錄
的掃描結果（`openspec-service.ts:391`）。於是往返會**換掉檔案** ——

```
<worktree>/openspec/specs/auth/spec.md  ──View in OpenSpec──▶  topic auth
                                        ◀──Open in Files────  openspec/specs/auth/spec.md
```

按兩下就站到另一個檔案上，而 dirty buffer 是 per-relPath 的。**這個 change 的論題正是「同一個
檔案去得了就要回得來」**，D3 在 spec 這一側打開了一個違反它的往返。接受它的理由是上面第 1 點
（反向導覽的目標是 topic，正向才是檔案），而來源標示讓這件事**看得見**而非隱形。

> **這條原本裁決為「不給」，理由是「跳過去會看到不同內容」。翻轉之後我又寫了「分歧只有跑過
> sync 才會發生」—— 同一個決定上，頻率假設連錯兩次，方向還相反。** 第一次把罕見當常態（於是
> 不給），第二次把常態當罕見（於是認為代價可忽略）。裁決本身兩次都不必動，該動的是**代價的
> 處理**：分歧既然是常態，就必須標示，而不是備註。

### D4：誤判防護是判準的**結構**，不是一條額外檢查

`docs/openspec/changes/<slug>/proposal.md`：不匹配任何工作目錄根（folder 自己的根是空字串，
剝根後要求首段為 `openspec`，這裡是 `docs`）→ `null`。
`<worktree>/docs/openspec/changes/<slug>/proposal.md`：剝掉該 worktree 的根之後首段是 `docs`
→ `null`。

**兩者都是「剝根 + 首段判定」自然的結果，不需要黑名單。** 這與既有的「slug 是不受信任的輸入 ⇒
查表，不要過濾字元」同構：白名單式的判準不需要列舉壞情況。

> **反面例子必須帶 `changes/` 或 `specs/` 那一層 —— 這是稽核抓到的假綠。** 原本用的是
> `docs/openspec/notes.md`，而**鬆綁版實作對它也回 `null`**（`openspec` 之後只剩一段，既非
> `specs` 亦非 `changes`）。於是那條「防鬆綁」的驗收對鬆綁實作全綠，D7 押注的整個防護是空的。
> 已實測：
>
> ```
> null            docs/openspec/notes.md                  ← 兩種實作同解，沒有鑑別力
> 命中→change:foo   docs/openspec/changes/foo/proposal.md    ← 只有鬆綁版命中
> ```
>
> **一個反面測試要能區分正確與錯誤的實作，不是「看起來像壞情況」就夠了。**

### D5：不驗證 slug/topic 是否真的存在 —— 與主行程的查表防護是兩件事

`.claude/worktrees/wt-a/openspec/changes/根本沒這個/x.md` 會得到一個 `{kind:'change', slug:'根本沒這個'}`。
**這是現行行為**（`openspec/changes/xxx/` 一樣不驗），下游 panel 收到不存在的 slug 呈現空狀態。

**不要因為「查表是這個 repo 的紀律」就在這裡加驗證。** 那條紀律的對象是**會被拿去拼接檔案路徑**
的 identifier（`readChange(repoPath, slug)`，`openspec-data-access` D6）—— 主行程那層的白名單
查表**不變**。這裡產生的 target 只送給我們自己的 UI，多一層驗證換不到安全性，卻要把 renderer
變成非同步（回到 D1 否決過的 B）。

### D6：邊界外的工作目錄整筆省略；**但 folder 自身恆在清單中，不受此規則約束**

邊界外的工作目錄**整筆自清單省略**，不以 `null` 佔位 —— 空字串是 folder 自身的合法值，清單裡
混入 `null` 會與它在消費端糾纏。於是「邊界外不提供檔案導覽入口」是**資料層就成立的**，不靠 UI
記得檢查。

> 這**不是**「延續既有的翻不出來就回 `null`」。既有那條規則是**以 `null` 呈現**（`SpecInfo.path`
> 翻不出來時的作法），這裡是**整筆不出現**。兩者都合理，但寫成「延續」會誤導實作者照既有規則
> 寫成 `null` 進清單。

**而 folder 自身必須恆在清單中 —— 這是稽核抓到的 CRITICAL，照原本的寫法會打壞既有功能。**
三個事實疊起來：

| | |
|---|---|
| `toRelPath` 對 folder 自身回 `null` | `openspec-service.ts:178` —— `if (rel === '') return null` |
| 非 git 目錄的 `listWorktrees` 回空陣列 | `@spekjs/core/dist/worktrees.js:79-88` —— `execFile` 失敗即 `resolve([])` |
| `probe:openspec` 的主 fixture 建在 `/tmp`，不是 git repo | `probe-openspec.mjs:34-38` |

照「翻不出來就不進清單」直覺地寫成 `worktrees.map(toRelPath).filter(Boolean)`，**folder 自己
第一個被丟掉**；非 git 的 folder 清單全空 ⇒ 連 `openspec/specs/core/spec.md` 這種現行可用的路徑
都不再有入口 —— 既有那條反向導覽驗收（`probe-openspec.mjs:1068`）會變紅。

**而 folder 是 repo 子目錄時是靜默的**：`scanOpenSpecAggregated` 在工作目錄 ≤ 1 時退回
`scanOpenSpec`，但 `worktrees` 仍帶著主工作目錄那筆（指向 repo 根，落在 folder 邊界外）→ 翻譯
出界 → 清單全空。**這正是 `openspec-worktree-aggregation` 被獨立稽核抓到的 `#specRoot` 同一個
坑**，`openspec-service.ts:311-315` 的註解就寫著警告 —— 而本 change 的第一版 artifact 一個字
都沒提。

因此：**folder 自身以空字串恆入清單，不經 `toRelPath`、不取決於 git 列舉是否成功。**

### D7：驗收必須成對，否則「修好」與「鬆綁」長得一樣

一個把判準鬆綁成「路徑裡出現 `openspec` 就算」的實作，會通過每一條正面斷言。因此：

- `probe:openspec`：邊界內 worktree 的 OpenSpec 檔案**有**入口 ／
  `docs/openspec/changes/<slug>/proposal.md` **沒有**入口（帶結構那一層，見 D4 的假綠註記）。
- `nav.ts` 的單元測試（**目前沒有**）：判準從一段字串比對變成查清單之後，它該有一組表格式測試 ——
  比 probe 便宜得多，而 probe 那層只驗得到「按鈕在不在」。至少涵蓋：folder 自身的 change／spec、
  archive 底下的 change、worktree 的 change、worktree 的 spec（**給**，D3）、
  `docs/openspec/changes/<slug>/*`（不給）、`<worktree>/docs/openspec/changes/<slug>/*`（不給）、
  **兩個互為字串前綴的根並存**（見下）、巢狀工作目錄、空清單、空 relPath。

**驗 `startsWith` 要用「兩個根互為前綴」，不是 `<root>-suffix`（稽核抓到的第二個沒有鑑別力的
斷言）。** 原本那條的推理是「`startsWith` 會把 `.../wt-a-suffix/...` 誤判為落在 `.../wt-a`
底下」—— 實際剝出來是 `-suffix/openspec/…`，**首段是 `-suffix` 不是 `openspec`，兩種實作都回
`null`**。前綴比對在這個方向產生的是偽陰性，不是偽陽性。

有鑑別力的是**正面**那條：清單同時有 `.claude/worktrees/wt` 與 `.claude/worktrees/wt-a`，開
`.claude/worktrees/wt-a/openspec/changes/x/proposal.md` ——

| 實作 | 結果 |
|---|---|
| 分段比對 | 命中 `wt-a` → `{change, x}` ✔ |
| `startsWith` + 取第一個命中 | 命中 `wt` → 剝出 `-a/openspec/…` → `null` ✘ |

**`<root>-suffix` 那條仍值得留著，只是要標對它在測什麼。** 實測四種組合後發現它對**鬆綁版**
是有鑑別力的（鬆綁版會找到那個 `openspec` 分段並命中 `{change, x}`，正確版回 `null`）——
它抓不到的只是它原本宣稱要抓的 `startsWith`。**一個反面案例可以是有用的，同時它的標籤是錯的**：

```
案例                        正確版      鬆綁版        startsWith 版
docs/openspec/changes/foo/…  null      change:foo   null          ← 抓鬆綁
docs/openspec/notes.md       null      null         null          ← 三種同解，無用
兩個根互為前綴（正面）         change:x  change:x     null          ← 抓 startsWith
<root>-suffix                null      change:x     null          ← 抓鬆綁（非 startsWith）
```

## Risks / Trade-offs

- **[前綴比對的老坑]** 工作目錄根的比對若寫成 `relPath.startsWith(root)`，當清單中兩個根互為
  字串前綴時，較短的會先命中並剝出錯誤的剩餘路徑 → **以路徑分段比對**，與 `fs-boundary.ts` 的
  「用 `path.relative`、絕不用 `startsWith`」同一條紀律，並以 D7 那組**有鑑別力**的案例在單元
  測試裡釘住。

- **[folder 自身的根是空字串]** 空字串是每個路徑的前綴，比對時若不特判會讓**每一個**路徑都命中
  folder 自身 → 剝根後仍要求首段為 `openspec`，這條在 D1 的規則裡本來就有，但它是承重的，不可
  「簡化」掉。**而它的反面同樣承重**：空字串在 `toRelPath` 的語意裡是 `null`，於是「翻不出來就
  省略」會把 folder 自己刪掉（D6）。**同一個空字串，兩個方向都會咬人。**

- **[清單過期]** worktree 新增／移除後清單若不更新，入口會停留在舊狀態 → 走既有的
  `openspec:changed` revision 機制（`openspec-worktree-aggregation` 已建立兩層 watcher，涵蓋
  「工作目錄清單本身」）。**不另造監看**。

- **[既有缺口，本 change 不修但要記錄]** `hasOpenSpec` 只看 folder 根目錄的 `openspec/`
  （`workspace-store.ts:58`），而它是 OpenSpec 身分與 **View in OpenSpec** 入口的總開關。
  於是「folder 根**沒有** `openspec/`、但某個 worktree 有」時，整個 OpenSpec 身分是停用的，
  本 change 的一切都到不了。**在使用者的工作流裡不會發生**（`common-openspec-change` 是在既有
  的 openspec repo 上開 worktree，主工作目錄本來就有），且修它要動 `workspace-folders` 那條
  「不 spawn 外部程式」的偵測規格 —— 那是 issue #5 的地盤。

- **[D3 的分歧是常態，不是邊角]** worktree 裡的 `openspec/specs/<topic>/spec.md` 會在 archive
  前的 backfill 之後與主工作目錄那份分歧，而入口跳過去呈現的是主工作目錄那份，往返還會換掉檔案
  → **以「spec 檢視標示來源工作目錄」承擔**（已寫進 `openspec-panel` 的 delta 與 tasks，不是
  dogfood 之後的退路）。它對非 worktree 的使用者同樣是有用的資訊。

- **[topic 只存在於該 worktree 時，入口會指向一個不存在的東西]** worktree 中新增 capability 的
  change 於 backfill 之後，其 `openspec/specs/<new-topic>/spec.md` 只存在於該 worktree，而
  `getSpec` 只查主工作目錄的掃描結果（`openspec-service.ts:378-380` 查不到即 `NOT_FOUND`）→
  呈現「該 topic 不存在」的狀態（D5 已接受的行為，現已明文寫進 spec 的 scenario）。**注意
  `probe:openspec` 現有 fixture 的 worktree 是從含 `openspec/specs/auth/spec.md` 的 commit 切
  出去的，兩份相同 —— 那條驗收碰不到這個情形**，故由單元測試承擔。

## Open Questions

無。D3 曾是唯一一個「合理的人可能選另一邊」的決定，已裁決為**給入口 + 標示來源**（理由、被推翻
的原裁決、以及頻率假設連錯兩次的經過都記在 D3）。
