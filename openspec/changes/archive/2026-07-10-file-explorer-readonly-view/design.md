## Context

Phase 1 交付了版面骨架與第一個受邊界約束的 fs IPC（`listDir`），但 side panel 裡是一行佔位文字。本 change 把它填成 Files 身分：一棵會 lazy load、會隨磁碟變動更新的檔案樹，以及點下去看得到內容的唯讀檢視。

**撰寫本文件時對每一項關鍵事實都做了實測或原始碼查證**（2026-07-10）。其中三項改變了原本的規劃：`editor.all.js` 那行 import 沒有作用；chokidar 的 `followSymlinks` 預設會走出 workspace 邊界；渲染 markdown 會把 preload 白名單暴露給任意遠端頁面。以下決策皆附證據。

**約束**

- `allowedEditRoots` 僅 `spek-workspace`。
- UI 版面以 `docs/workspace-mockup.html` 為權威 —— 但**它對「開檔如何呈現」沒有表態**（見 D1）。
- PRD §12 的信任模型：`contextIsolation: true`、停用 `nodeIntegration`、能力只走 preload 白名單，fs 受限於已加入的 workspace folders。
- 沿用 Phase 1 D1 的定址：renderer 永遠不傳絕對路徑，邊界檢查一律在主行程。
- 本 change 僅在 Linux x64 實測。

## Goals / Non-Goals

**Goals:**

- 讓使用者看得到已加入 repo 的內容，且**那份內容不會過期** —— agent 在旁邊改檔時，樹要跟著動。
- 讓 Monaco 第一次有真實載體，並把 Phase 1 標為 `REMOVED` 的兩條 requirement 以**真實使用情境**重新確立。
- 在 `readFile` 誕生的同一刻，把「越界的後果從檔名升級為內容」這件事**重新論證一次**，而不是沿用 Phase 1 的「只讀所以還好」。
- 為 Phase 3（編輯）與 Phase 5（spec ↔ 檔案交叉導覽）備好入口。

**Non-Goals:**

- git 狀態標籤（mockup 的 `M` / `A`）、主舞台的檔案 tab、寫檔與 dirty 狀態、OpenSpec 身分的內容、terminal、handoff。
- 樹的展開狀態與捲動位置不持久化。
- mockup 上「focused session 正在做的 change」那條 accent highlight（需要 session 概念）。
- 不改動 `@spekjs/core`（沿用 Phase 1 D4 的理由：等消費者夠多、簽章穩定再談）。

## Decisions

### D1：Files 的開檔在 side panel 內換頁，不做主舞台的檔案 tab

**兩份權威文件在此處衝突**，必須先確認 mockup 是否真的沉默，再談怎麼補。

**查證結果**：`docs/workspace-mockup.html` 中沒有任何開檔畫面 —— 沒有編輯器、沒有檔案 tab、沒有內容區。`.file-row` 的 CSS 明寫 `cursor: default`（:411），全檔的 JS（960–1012、1213–1282）沒有任何選擇器碰過 `.file-row` / `.file-tree`。主舞台那排 `.session-tabs` 的註解寫著「純資訊展示」，且分頁內容是 branch，不是檔案。

所以：**mockup 對「開檔如何呈現」沒有表態**，CLAUDE.md 的「衝突時以 mockup 為準」在這裡無法裁決。而 PRD §11 寫「全域 tab manager：開檔成 tab」，PRD §6.2 的註卻寫「刻意**不**把 Monaco 檔案編輯器當主編輯區的一級公民……Monaco 的角色退為 Files／檔案檢視」。兩者不能同時為真。

**決定**：Files 身分內部有兩個狀態 —— 樹、以及單一檔案的內容。點檔案時面板換頁，`.os-crumb` breadcrumb 從 `project-a / files` 變成 `project-a / files / packages/core/src/scanner.ts`，點 breadcrumb 的上層節點回到樹。

| 方案 | 否決理由 |
|---|---|
| 主舞台檔案 tab（PRD §11 原文） | 與 mockup 的 `.session-tabs` 搶同一列位置。Phase 4 的 terminal 是主舞台的主角（PRD §6.2「terminal 是主場」），檔案 tab 進來就要重新談主舞台的所有權，等於在 Phase 2 預支一場 Phase 4 的架構仗。 |
| side panel 分割成上樹下內容 | 34% 寬的欄位再對切，兩邊都不能用。 |
| 開新視窗 | 與「一個殼裡看完」的產品前提相反。 |

**理由不只是「mockup 沒畫」**：side panel 的另一個身分 OpenSpec 本來就是**面板內導覽**（`本 change / Specs / Changes / Graph`，切換不影響主舞台）。Files 用同一種模式，兩個身分的心智模型才一致 —— side panel 是「上下文」，主舞台是「駕駛座」。深度改檔仍走 agent 或使用者自己的 IDE，這正是 PRD §6.2 的原話。

**代價**：34% 寬看程式碼偏窄。緩解：分界可拖動（Phase 1 已具備），side panel 可拉寬到主舞台的大部分。

**必須回寫 `docs/PRD.md` §11**，把 Phase 2 的「全域 tab manager」改成本決策。留著不動，往後每個 Phase 都會從一份自相矛盾的路線圖長出來。

### D2：Monaco 只取 monarch tokenizer，砍掉全部語言服務

唯讀檢視需要的是**語法高亮**（`basic-languages/*` 的 monarch tokenizer），不是**語意分析**（`language/*` 的 worker 驅動語言服務）。唯讀的檔案沒有 diagnostics 可修、沒有補全可用。

**實測**（`electron-vite build` 後 `out/renderer` 全部檔案的位元組總和，Linux x64）：

| 組合 | 總體積 | 資產數 | 關鍵資產 |
|---|---|---|---|
| V0 現況（renderer 未引用 Monaco） | **633,821 B**（0.60 MB） | 3 | — |
| V1 `editor.api` + `editor.all` + 81 種 basic-languages + `editor.worker` | **9,236,395 B**（8.81 MB） | 86 | 主 chunk 7,519 kB |
| V1b 同上但**移除** `editor.all.js` | **9,236,380 B** | 86 | 主 chunk 7,518.9 kB |
| V2 = V1 + `language/json` | 10,170,446 B（9.70 MB） | 88 | `json.worker` 820.3 kB |
| V3 = V1 + `language/typescript` | **22,548,591 B**（21.51 MB） | 88 | **`ts.worker` 12,953.2 kB** |

**採 V1**：砍掉語言服務省下 12.65 MB（21.51 → 8.81 MB），且 `ts.worker` 那個數字與 Phase 0 量到的 12.65 MB 完全吻合，兩次量測互為佐證。

**實測推翻了 `editor/index.tsx` 現有註解的假設**：V1 與 V1b 只差 15 bytes —— `editor.all.js` 那行 import **沒有作用**。原因在 `basic-languages/_.contribution.js` 開頭就 import 了 `../editor/browser/coreCommands.js`、`../editor/contrib/**` 等整套編輯器 contribution。**只要引用任何一種 basic language，`editor.all` 的內容就已經進來了。** 那行 import 應移除，並更正註解。

**81 種語言幾乎不花錢**：每個 `<lang>.contribution.js` 只呼叫 `registerLanguage({ loader: () => import('./<lang>.js') })`，grammar 是動態 import，Vite 因此為每種語言產出獨立的 lazy chunk（最大的 `freemarker2` 41.1 kB），總計約 640 kB 且**只在真的開了該語言的檔案時才載入**。所以「支援 81 種語言的高亮」與「支援 2 種」在初始載入上幾乎沒有差別 —— 沒有理由手動挑語言。

**代價**：JSON 檔沒有語法錯誤標記、TS 檔沒有型別診斷。對唯讀檢視器而言這不是損失。若 Phase 3 的編輯能力需要 diagnostics，屆時再談 —— 那時它有真實的消費者，且體積代價可以由「能編輯」來償還。

**編輯器切成獨立 chunk**（`manualChunks`），理由不是快取而是**可歸因**：與 app 混在同一個主 chunk 裡時，「編輯器貢獻了多少體積」只能靠「加一次、減一次、再相減」估算，而 requirement 要求它可被辨識。grammar 必須留在原本的動態 chunk 裡 —— 一併塞進靜態 chunk，81 種語言就會全部進入初始載入路徑。

**本 change 完成後的實測**（含 `react-markdown`）：總計 **9.25 MB**，其中編輯器核心 7.01 MB、`editor.worker` 0.52 MB、80 個語言 chunk 合計 0.62 MB、圖示字型 0.12 MB，應用程式與其他相依 0.99 MB。`npm run measure:bundle` 逐項列出，並在偵測到任何 `*.worker` 屬於語言服務時以非零碼結束。

### D3：worker 存活以 link decoration 驗證，不引入任何語言服務 worker

Phase 0 記下的陷阱：**不能靠「看到語法高亮」判定 worker 存活** —— tokenization 在主執行緒完成。必須讓 worker 真的做一次往返。但 D2 砍掉了所有語言服務 worker，那還剩什麼可以驗？

**查證 Monaco 原始碼**：`editor.worker` 並非只為語言服務而存在。`vs/editor/browser/services/editorWorkerService.js:58` 為 `{ language: '*' }` 註冊了一個內建的 link provider：

```js
this._register(languageFeaturesService.linkProvider.register({ language: '*', hasAccessToAllModels: true }, {
    provideLinks: async (model, token) => {
        const worker = await this._workerWithResources([model.uri]);
        const links = await worker.$computeLinks(model.uri.toString());
        return links && { links };
    }
}));
```

`$computeLinks` 定義在 worker 端（`vs/editor/common/services/editorWebWorker.js:188`，內部呼叫 `linkComputer.js` 的 `computeLinks`）。命中的連結會被畫成 inlineClassName `detected-link` 的 decoration（`vs/editor/contrib/links/browser/links.js:283`）。

**決定**：驗收方式是「在唯讀檢視器中開啟一個含 URL 的檔案，DOM 中出現 `.detected-link`」。這一條斷言同時證明了：worker script 被正確解析與載入（dev 的 `http://` 與 build 的 `file://` 兩種路徑）、`MonacoEnvironment.getWorker` 接線正確、且主執行緒與 worker 之間完成了一次雙向往返。

**這個方案的好處**：零 bundle 成本、零產品測試鉤子（`.detected-link` 是 Monaco 自己畫的，不是我們為驗收加的 `data-*`，符合 Phase 1 D6 立下的原則）、且待驗的檔案可以是 repo 裡任何一個含 URL 的真實檔案。

| 替代方案 | 否決理由 |
|---|---|
| 保留 `language/json`，開一個壞掉的 JSON 看 marker | 花 0.93 MB 買一個驗收手段。且唯讀檢視器對使用者的檔案畫紅線是噪音 —— 他在這裡改不了它。 |
| 保留 `language/typescript` | 12.65 MB。同上，而且更貴。 |
| 用 `monaco.editor.colorize` 之類的 API 斷言 | 那些都在主執行緒跑，正是 Phase 0 警告的假驗證。 |

**注意**：`provideLinks` 前有 `canSyncModel` 檢查，模型超過 `_MODEL_SYNC_LIMIT`（50 MB，`textModel.js:116`）就不會同步到 worker，link 靜默消失。D4 的大檔上限遠低於此，不受影響。

### D4：`readFile` 的兩個拒絕條件 —— 大檔與二進位；上限必須低於 Monaco 的 20 MB 懸崖

`readFile` 讀的是內容，不是檔名。它必須在讀之前就知道要不要讀。

**大檔上限定為 2 MiB。這個數字不是拍腦袋的，它被 Monaco 自己的門檻由上方夾住**（`vs/editor/common/model/textModel.js`）：

| Monaco 常數 | 值 | 超過的後果 |
|---|---|---|
| `LARGE_FILE_SIZE_THRESHOLD`（:117） | 20 MB | **停止 tokenization** —— 語法高亮消失 |
| `LARGE_FILE_LINE_COUNT_THRESHOLD`（:118） | 300K 行 | 同上 |
| `_MODEL_SYNC_LIMIT`（:116） | 50 MB | 不與 worker 同步 —— D3 的 link decoration 消失 |

也就是說：**若上限設在 20 MB 以上，「檢視器提供語法高亮」這條 requirement 對某些被接受的檔案就是假的。** spec 不能宣告一件對它自己接受的輸入不成立的事。2 MiB 遠在懸崖之下，且足以涵蓋任何人類會逐行讀的檔案。

**必須先 `stat` 再讀**，不可讀進記憶體後才發現太大 —— 否則一個 4 GB 的檔案會在主行程炸掉整個 app。

**二進位偵測採 git 的判準：檔案開頭 8000 bytes 內出現 NUL 即視為二進位。** 這是既有慣例而非自創門檻，且已實測確認 git 的邊界就在 8000：

| 檔案 | NUL 位置 | `git diff --no-index --stat` 的判定 |
|---|---|---|
| `a.txt` | offset 100 | **binary**（`Bin 0 -> 20101 bytes`） |
| `c.txt` | offset 7999 | **binary** |
| `b.txt` | offset 9000 | text（`1 +`） |

**兩者都是拒絕，不是降級呈現。** 截斷後顯示一半的檔案，比不顯示更糟 —— 使用者會以為那就是全部。UI 顯示明確的理由（「檔案過大（12.4 MB），上限 2 MiB」／「二進位檔案，無法以文字檢視」）。

編碼一律以 UTF-8 解碼並去除 BOM。非 UTF-8 的文字檔會出現替換字元 —— 已知限制，記於 Risks。

### D5：watcher 的監看集合 = 樹上展開的目錄集合，靠 `depth: 0` 達成

樹是 lazy load 的，任一時刻只有「已展開的目錄」的直接子項目被顯示。**監看集合只要精確等於這個集合，就沒有多餘的 watcher，也沒有看不到的變更。**

chokidar 的 `depth: 0` 表示「只看這個目錄的直接子項目，不遞迴」（`ChokidarOptions.depth?: number`，`package/index.d.ts`）。於是：

- 每個 workspace folder 一個 chokidar 實例，`depth: 0`。
- 樹展開某目錄 → `watcher.add(absDir)`；收合 → `watcher.unwatch(absDir)`。folder root 在 Files 身分開啟時即加入。

**這個作法讓 `ignored` 規則完全不必要**。常見的替代方案「監看整個 root 並排除 `node_modules` / `.git`」有兩個問題：(a) 大 repo 光是初始 scan 就要走遍整棵樹；(b) 排除清單是猜的 —— 使用者展開了 `node_modules`，他就是想看它。而 `depth: 0` 的方案裡，沒展開的目錄一個 watcher 都不花，展開了就剛好一個。`.git/` 內部的 `index.lock` 抖動也不會產生事件，因為它不是任何已展開目錄的直接子項目。

事件（`add` / `change` / `unlink` / `addDir` / `unlinkDir`，`package/handler.js:19-23`）以每個 folder 為單位、以短 debounce 合批後推給 renderer。agent 一次寫十個檔案不該產生十次 React re-render。

### D6：`followSymlinks: false`，且事件路徑一律再過一次邊界檢查

**chokidar 的 `followSymlinks` 預設為 `true`**（`package/index.js:266`）。若沿用預設，folder 內一個指向 `/etc` 的 symlink 被展開時，watcher 會跟著走出去，並把邊界外的檔名經由事件推給 renderer —— **Phase 1 在 `listDir` 上守住的邊界，會從 watcher 這道側門漏掉。**

**決定**：`followSymlinks: false`。symlink 只當作一個項目呈現，不跟隨。若使用者展開一個指向 folder 外的 symlink 目錄，`resolveWithinRoot` 會以 `ESCAPES_ROOT` 拒絕（Phase 1 已實作），樹上顯示為不可展開。

**縱深防禦**：即使關掉 followSymlinks，watcher 吐出的絕對路徑在轉成 `(folderId, relPath)` 之前，仍要通過一次 `isWithin(root, absPath)`。落在邊界外的事件直接丟棄。理由與 Phase 1 D1 相同 —— 推給 renderer 的每一個路徑，都必須是 renderer 有詞彙表達的路徑。**renderer 永遠不會看到絕對路徑**，事件的形狀是 `{ folderId, type, relPath }`。

### D7：polling 決策重用 core，並且必須用它的 env 對齊 helper

`@spekjs/core` 匯出 `shouldUsePolling(path)`、`pollingInterval(env)`、`withAuthoritativeChokidarEnv()`。這是 Phase 1 D4 分工的正面案例：**純決策邏輯在 core，watcher 實例在 app。**

`withAuthoritativeChokidarEnv` 不是可有可無的包裝。**實測 chokidar 5.0.0 的 `index.js:284-296`**：建構 watcher 時會**事後重讀** `process.env.CHOKIDAR_USEPOLLING` 與 `CHOKIDAR_INTERVAL`，覆寫我們透過 options 傳入的 `usePolling` / `interval`。也就是說，使用者環境裡若有這兩個變數，我們算出來的決定會被無聲推翻（`CHOKIDAR_INTERVAL=0` 甚至會 busy poll）。core 的 helper 在 `chokidar.watch(...)` 的同步窗口內把 env 對齊到權威決定，建立後立即還原。

**前提**：建立 watcher 的那個 callback **必須是同步的**（只呼叫 `chokidar.watch(...)`，不得 `await`）。否則 env 的還原會早於 chokidar 讀取，helper 失效。

### D8：markdown 用 `react-markdown`，且**不得**加入 `rehype-raw`

與 `spek` repo 的 `packages/web` 同一組（`react-markdown` `^10.1.0` + `remark-gfm` `^4.0.1`），Phase 5 抽出 `@spekjs/ui` 時不必替換渲染器。

**為什麼不直接重用 spek 現成的 `MarkdownRenderer`**（已查證，非憑印象）：

| 事實 | 後果 |
|---|---|
| `packages/web` 的 `package.json` 是 `private: true`，且沒有 `main` / `exports` | 它是一個 app，不是可被引用的套件 |
| `npm view @spekjs/ui` → 404 | 共用的 UI 套件尚未存在。抽出它是 **Phase 5** 的工作（PRD §9.2） |
| `MarkdownRenderer.tsx`（267 行）`import { Link } from "react-router-dom"` | 本 app 沒有 router，且它產生的是 in-app 導航 —— 會直接撞上 D9 的 `will-navigate` 防護 |
| 它 `import { slugifyHeading } from "@spekjs/core/headings"`，props 為 `{ content, specTopics, idPrefix }` | 那是 **OpenSpec artifact 的渲染器**（spec 交叉連結、標題錨點），不是通用的檔案檢視器。對一個隨機的 `README.md` 傳 `specTopics` 沒有意義 |

要「直接用」就得先編輯另一個 repo（`allowedEditRoots` 只有 `spek-workspace`）、抽出並發一版 npm —— 與 Phase 0 被 `@spek` scope 卡住、Phase 1 的 `listDir` 不推回 core，是同一種跨 repo 前置。

因此本 change 的 `MarkdownView` **不是重新實作 markdown 渲染**：它用的是同一顆引擎與同一組 plugin，只是不套 spek 的 OpenSpec 外殼，全長約 50 行。**Phase 5 抽出 `@spekjs/ui` 時，應由它一併吸收這個檢視器**，屆時 OpenSpec 身分用 `MarkdownRenderer`、Files 身分用其通用形式。

**安全性來自預設值，而預設值必須被明確保護**（查證 `react-markdown@10.1.0` 的 `lib/index.js`）：

- **raw HTML 不會被渲染**：`raw` 型別的節點被轉成純文字節點（:360-364）。要讓它變成真的 HTML，必須主動加入 `rehype-raw`。**本 change 明文禁止加入它。** 這棵樹渲染的是使用者 repo 裡的任意 `.md` —— 那是不受信任的輸入。
- **URL 由 `defaultUrlTransform` 過濾**（:421）：只放行 `^(https?|ircs?|mailto|xmpp)$` 這幾種協定，其餘帶協定的 URL 一律清成空字串。`javascript:` 因此無效。**不得覆寫 `urlTransform`。**

### D9：主行程必須阻擋 renderer 導航 —— 這是渲染 markdown 引入的新攻擊面

**查證 `src/main/index.ts`：目前沒有 `will-navigate` 或 `setWindowOpenHandler` 的防護。** Phase 1 之前無所謂 —— renderer 裡沒有任何連結。本 change 一旦渲染 markdown，使用者 repo 裡的 `[click](https://evil.com)` 就是一個可點的連結。

**後果比「跳走一個頁面」嚴重得多**：preload 綁在 `webContents` 上，**它會在該 webContents 的每一次導航後重新注入，不分來源**。導航到遠端頁面後，那個頁面的 `window.workspace.fs` 就是我們的 fs 白名單 —— 它可以列出並讀取使用者所有 workspace folder 的內容。D4 那些大檔與二進位的拒絕條件，擋不住一個有耐心的遠端腳本。

**Phase 1 建立的整道邊界，會被一個 markdown 連結繞過。**

**決定**（三道，全部在主行程）：

1. `contents.on('will-navigate', (e) => e.preventDefault())` —— renderer 不得離開它自己的來源。
2. `contents.setWindowOpenHandler(() => ({ action: 'deny' }))` —— 不得開新視窗。
3. 外部連結改由 `shell.openExternal` 交給系統瀏覽器，且**在主行程再驗一次協定**（只放行 `http` / `https`）。不倚賴 `defaultUrlTransform` 已經擋過一次 —— 那是 renderer 的檢查，與 Phase 1 D1 的理由相同：renderer 的檢查等於沒有檢查。

這三道與 markdown 無關的部分也該做（它們是 Electron 應用的基本功），只是直到本 change 才有東西真的會觸發它們。

### D10：`readFile` 的 TOCTOU 與 hard link —— 重新論證，而非沿用

Phase 1 `design.md` 記著「TOCTOU 與 hard link 尚未防護；**Phase 3 引入 `writeFile` 時必須重新評估，不可沿用 Phase 1 的『只讀所以還好』**」。本 change 沒有引入寫入，但把越界的後果從**檔名**升級為**內容**。這足以要求重新論證。

**威脅模型必須先講清楚**：這道邊界防的是**被入侵或有 bug 的 renderer**，不是一個已經拿到本機檔案寫入權的攻擊者。理由是後者早已贏了 —— 這個 app 的整個賣點是在 workspace folder 裡跑一個有完整 shell 權限的 `claude`。

在這個模型下：

- **TOCTOU**（`realpath` 檢查通過後、`open` 之前，路徑被換成指向邊界外的 symlink）：構造這個 race 需要在 folder 內建立 symlink，而 **renderer 沒有任何建立檔案或 symlink 的能力** —— preload 白名單裡只有 `listDir`、`readFile`、`watch`。renderer 無法自己製造這個 race。能製造的角色（本機的其他行程、agent 自己）已經能直接讀那個檔案。**結論：`readFile` 在 Phase 2 維持「先 realpath 檢查、再以該真實路徑開啟」是站得住的。**
- **hard link**（同 inode、不同路徑，`realpath` 兩端各自成立）：路徑檢查在原理上防不住。同上，建立 hard link 需要本機寫入權。**維持 Phase 1 的立場：使用者把 hard link 放進自己加入的 folder，是他自己的選擇。**

**這個論證對 `writeFile` 不成立，Phase 3 不得引用本節。** 寫入的後果是覆寫或損毀邊界外的檔案，且 renderer 屆時**擁有**製造檔案的能力，race 的兩端它都碰得到。Phase 3 必須以 `O_NOFOLLOW`、以 dirfd 相對開啟等機制處理。

### D11：主行程只回 `mtimeMs` 數字，相對時間在 renderer 格式化

`listDir` 的回傳增加 `mtimeMs: number`。**不回傳「2 小時前」這種字串**：它會過期（面板開著十分鐘就錯了）、它把語言決定權放進了主行程、而它的成本本來就是零 —— `listDir` 為了判斷是否為目錄本來就在 `stat`。

renderer 以 `Intl.RelativeTimeFormat`（`zh-TW`）格式化，並在樹重繪時重算。

面板 header 的項目數（mockup 的「18 個項目」）**語意定為「樹上目前可見的列數」**。mockup 那個數字是靜態裝飾 —— 它標 18，而該樹實際畫了 19 列（:722-740），root 的直接子項目則是 7 個。兩種讀法都能對上一個「差不多」的數字，因此由我們定義；「現在這個面板列了幾樣東西」是其中唯一對使用者有意義的一個。

樹的排序為**目錄優先、其次名稱**（`Intl.Collator`），與 mockup 一致（`packages/ docs/ openspec/ scripts/` 在 `CLAUDE.md package.json README.md` 之前）。排序屬於呈現，放在 renderer；`listDir` 的回傳順序不構成契約。

### D12：OpenSpec 身分的停用條件，Phase 2 只看 `openspec/` 是否存在

PRD §6.3 寫「repo 要有 `openspec/` **且有 active change** 才可用」。後半句需要掃描 `openspec/changes/`，而那正是 Phase 5 的 `IpcAdapter` 要做的事。Phase 1 已經有 `hasOpenSpec`（一次 `stat`，D3 明訂不做完整掃描）。

**決定**：Phase 2 的 segmented switch 以 `hasOpenSpec` 決定 OpenSpec 鈕是否停用。「有 active change」這個條件延到 Phase 5 —— 屆時 OpenSpec 身分才有內容可顯示，停用的判準與內容的來源會是同一次掃描。現在提前實作它，等於為了一個沒有內容的面板去掃整個 `openspec/`。

**預設身分為 Files，這一點與 mockup 相反**（mockup 的 `.dtab.active` 是 OpenSpec，`#content-files` 帶 `hidden`）。理由：Phase 2 的 OpenSpec 身分只有佔位內容，若沿用 mockup 的預設，使用者加完 repo 打開面板看到的是一片空白 —— 那不是 mockup 想呈現的畫面，mockup 畫的是**有內容的** OpenSpec 面板。**Phase 5 讓 OpenSpec 有內容之後，預設身分應改回 mockup 的定義**，此事記於本節。

### D16：訂閱以樹上的路徑定址，監看以磁碟上的真實路徑進行（驗收期發現）

第一版把「訂閱」與「監看」當成同一件事：`Map<relPath, absPath>`，`unwatch` 直接把 `absPath` 交給 `watcher.unwatch()`。**驗收時以實測推翻。**

folder 內一個指向 `sub/` 的 symlink `link-to-sub/`，在樹上是**兩個節點**，在磁碟上是**同一個目錄**。chokidar 只認絕對路徑。於是：

| 情境 | 第一版的結果 |
|---|---|
| 只展開 `link-to-sub`，於 `sub/` 新增檔案 | 事件的 `relPath` 是 `sub/new.txt`，而 renderer 展開的節點叫 `link-to-sub` —— **該節點永遠不更新** |
| 同時展開 `sub` 與 `link-to-sub`，收合其一 | `watcher.unwatch(<root>/sub)` 把**另一個節點的監看一起關掉** |

**決定**：分成兩層。

- `subscriptions: Map<訂閱者 relPath, absPath>` —— 樹上的節點。
- `watchers: Map<absPath, Set<訂閱者 relPath>>` —— 磁碟上的目錄，附**參考計數**。

`watcher.add()` 只在某個 `absPath` 的第一個訂閱者出現時呼叫，`watcher.unwatch()` 只在最後一個訂閱者離開時呼叫。派送事件時，以 `dirname(absPath)` 反查訂閱者集合，**對每個訂閱者各自以它訂閱時使用的路徑改寫 `relPath`**。

理由與 Phase 1 D1 同源：**renderer 以樹上的位址認識檔案系統。以真實路徑回報，等於交給它一個認不得的位址。**

這個 bug 之所以能通過第一輪全綠的驗收，是因為 `probe:files` 的 fixture 裡**一個 symlink 都沒有**。fixture 現在有兩個：一個指向 folder 內部（`link-to-sub`）、一個指向外部（`escape-link`）。

### D17：先訂閱、再列目錄（驗收期發現）

第一版在 `activate` 裡直接 `loadDir()`，訂閱則由對帳的 effect 稍後發出。**「列完」到「訂閱生效」之間有一個窗口，其中發生的變更兩頭落空** —— 列目錄沒看到它，事件也還沒開始送。

這不是理論上的窗口。這個 app 的前提就是「旁邊有個 agent 一直在寫檔」，而使用者展開目錄的那一瞬間正是 agent 最可能在動那個目錄的時候。驗收時它以「symlink 節點收不到事件」的形式現形 —— 探針在展開後立刻建檔，剛好落進窗口裡。

**決定**：對帳的 effect 是每個目錄**唯一**的載入入口。`watch()` 的結果回來之後才 `listDir()`：

- 訂閱**之前**的狀態，由這一次列目錄補齊；
- 訂閱**之後**的變更，由事件送達。

`activate` 只改變展開狀態，不觸發載入。根目錄的初次載入也走同一條路徑（`collectWatchTargets` 恆含 root），因此掛載時那個獨立的 effect 一併移除。

**殘留窗口**：chokidar 的 `add()` 內部是非同步的，`watch()` 的 IPC 回來時 `fs.watch` 未必已經裝好。落在那極短一段內、且發生在我們 `readdir` 之後的變更仍會遺失，直到下一個事件。`_readyEmitted` 是一次性的，無法逐次 `add` 等待就緒，因此這一段無法在不改 chokidar 的前提下關掉。任何 watcher 都有這一類窗口；此處明文記錄，不假裝它不存在。

### D14：fs 的失敗以結果物件跨越 IPC，不以拋出（實作期發現）

原本打算沿用 Phase 1 的形狀：主行程拋錯，renderer 的 `invoke` 隨之 reject。**實作 `readFile` 時發現這行不通** —— Electron 把 handler 拋出的 `Error` 序列化給 renderer 時**只保留 `message`**，自訂屬性一律遺失。而 UI 需要的正是那些屬性：

- 「檔案過大（2.0 MB），上限 2.0 MB」需要 `detail.size` 與 `detail.limit`；
- 樹上點一個 symlink 時，要靠 `code` 區分「其實是檔案」（`NOT_A_DIRECTORY` → 改用檢視器開啟）與「指向 workspace 之外」（`ESCAPES_ROOT` → 於該列標示原因）。

從錯誤訊息的字串裡把數字剖析回來，是把一個型別問題偽裝成剖析問題。

**決定**：IPC 層回傳 `{ ok: true, value }` 或 `{ ok: false, code, message, detail? }`。**`fs-service` 內部維持拋錯** —— 它是不跨行程的純邏輯，拋錯在那裡是對的，且既有的單元測試因此一行都不必改。轉換只發生在 `ipc/fs.ts` 這道接縫上，也就是序列化真正發生的地方。

代價：`probe:workspace` 中「拒絕越界」的斷言由「promise reject」改為「`ok === false`」。spec 說的是「呼叫被拒絕並回報錯誤」，兩者皆滿足。

### D15：watcher 的釋放要掛在 `did-navigate`，不能掛在 `did-start-navigation`（實作期發現）

renderer 重新載入不會銷毀 `webContents`，因此監看集合必須在導航時清空，否則反覆重新載入會持續累積 watcher。第一版掛在 `did-start-navigation` 上 —— **實測證明那是錯的**。

`will-navigate` 與 `did-start-navigation` 對**同一次**導航都會觸發，`preventDefault()` 只是隨後取消它。於是 D9 的導航防護每擋下一次導航（例如 markdown 內容裡的 `location.href = ...`），就會順手把該 renderer 的所有 watcher 關掉 —— 檔案樹與檢視器從此靜默地不再更新。

實測（`probe:files` 的固定情境）：

| | 導航前 | 導航被擋 | 導航後 |
|---|---|---|---|
| `did-start-navigation` | 事件送達 viewer ✓ | ✓ | **事件不再送達 ✗** |
| `did-navigate` | ✓ | ✓ | ✓ |

**決定**：掛在 `did-navigate`（導航已 commit）。它只在頁面真的被換掉時觸發，且早於新頁面的 script 執行，因此不會與新頁面的訂閱競態。`probe:files` 留有一條迴歸斷言（「被阻擋的導航不摧毀 watcher」）。

**教訓**：「導航開始」不等於「導航發生」。任何以導航為訊號的資源釋放，都必須挑一個只在**成功**時觸發的事件 —— 否則一個被安全機制擋下的攻擊，會變成一個由安全機制造成的故障。

### D13：lazy load 的 in-flight 去重與 race

同一個目錄可能在 `listDir` 尚未回來之前被反覆展開／收合。以 relPath 為 key 維護 in-flight 集合：重複的請求不再發出；載入途中若又被要求重載（watcher 連續送來事件），記下並於該輪結束後補跑一次。回應抵達時若該節點已收合，內容仍寫入快取但不會顯現 —— 樹只走「可見且已展開」的路徑。

**收合會停止監看，而 chokidar 的 `ignoreInitial` 不會補報收合期間的變更**，因此再次展開時快取可能已經過期。作法：立即以快取呈現（無載入中的閃爍），同時於背景靜默重新列出。這一點在撰寫 spec 時被漏掉了 —— 原本寫的是「再次展開時不重複載入」，那會讓樹在使用者眼前顯示過期內容。spec 已隨之修正。

換 folder 與換檔案一律以 React 的 `key` 重新掛載元件，而非用 effect 把狀態清空：後者多渲染一次，順序也難以推理，且 React 19 的 `set-state-in-effect` 規則會（正確地）擋下它。

樹的展開狀態與捲動位置**不持久化**（Non-Goal），因此重啟後一律回到只展開 root 的狀態，沒有「還原時目錄已不存在」的問題要處理。

## Risks / Trade-offs

- **markdown 連結導航 → preload 白名單外洩**（D9）→ 主行程三道防護；`shell.openExternal` 前於主行程再驗協定。這是本 change 最嚴重的風險，因為它會使 Phase 1 建立的整道邊界失效。
- **watcher 跟隨 symlink 走出邊界**（D6）→ `followSymlinks: false` + 事件路徑再過一次 `isWithin`。
- **`CHOKIDAR_USEPOLLING` 等環境變數無聲推翻 polling 決定**（D7）→ 用 core 的 `withAuthoritativeChokidarEnv`，且建立 watcher 的 callback 必須同步。
- **renderer bundle 從 0.60 MB 漲到 9.25 MB**（D2）→ 這是換取「開檔看得到高亮」的必要成本，已用實測把最貴的 12.65 MB（`ts.worker`）砍掉。`measure:bundle` 在建置產物出現任何語言服務 worker 時直接失敗，避免日後有人「順手」加回 `language/typescript`。
- **watcher 洩漏**：renderer 熱更新（dev）或視窗關閉時若不清理，會留下無主的 inotify watch 與 CPU 佔用 → watcher 的生命週期綁在 `webContents` 上：`destroyed` 時全部關閉，**導航 commit 時（`did-navigate`）清空監看集合**（不可用 `did-start-navigation`，見 D15）。驗收未採用「讀 `/proc/<pid>/fdinfo` 數 inotify watch descriptor」的構想 —— 它需要跨 pid 讀 fd，在 sandbox 下不可靠，且量到的是實作細節而非行為。改以兩層涵蓋：`WatchService` 的釋放契約（`unwatchAll` / `releaseFolder` / `dispose` 後 `watchedCount` 歸零、反覆重來不累積）由單元測試守；「收合後該目錄的變更不再更新樹」由 `probe:files` 在真實 UI 上守。
- **非 UTF-8 的文字檔**（Latin-1 等）→ 以替換字元呈現。已知限制，不在本 change 處理。
- **2 MiB 以下但超過 300K 行的檔案**（`LARGE_FILE_LINE_COUNT_THRESHOLD`）→ Monaco 靜默關閉 tokenization，高亮消失而檢視器不知情。極端情況（平均每行 < 7 bytes），列為已知限制。
- **`readFile` 把整個檔案讀進主行程記憶體再經 IPC 結構化複製**→ 2 MiB 的上限使其可接受。若 Phase 3 要處理更大的檔案，需改為串流或 `MessagePort`。
- **本 change 僅在 Linux x64 實測**：chokidar 在 macOS（FSEvents）與 Windows（ReadDirectoryChangesW）的事件語意不同，`depth: 0` 的行為需各平台驗證。見 Open Questions。

## Migration Plan

沒有既有狀態要遷移。rollout 順序讓每一步都可獨立回退：

1. **主行程 D9 的三道導航防護**。先做，因為它與其他一切無關，且是後面所有 UI 的前提。
2. **`listDir` 回傳 `mtimeMs`**；`readFile`（D4：`stat` → 大小 → NUL → 解碼）；兩者的邊界仍走 Phase 1 的 `resolveWithinRoot`。
3. **`watch` / `unwatch`**（D5、D6、D7）與 main → renderer 的 push 通道；watcher 生命週期綁 `webContents`。
4. **preload 白名單**擴充為 `fs.readFile` / `fs.watch` / `fs.unwatch` 與事件訂閱；同步更新 `index.d.ts`。
5. **`editor/` wrapper 改造**（D2、D3）：移除 `editor.all.js` 與 `language/typescript` 的 import 及 `ts.worker`；改為引用全部 basic-languages；`getWorker` 只回 `editor.worker`；語言由副檔名判定。
6. **renderer `shell/` 的 side panel**：segmented switch（D12）、Files 身分的樹（D11、D13）、檔案檢視換頁（D1）、markdown 渲染（D8）。
7. **驗收**：`npm test` 擴充（`readFile` 的拒絕條件、watcher 的 dispose 契約、事件路徑的邊界過濾）；探針擴充（身分切換、樹展開、`.detected-link`、導航防護）；`measure:bundle` 改為可歸因 Monaco 的體積。
8. **文件回寫**：`docs/PRD.md` §11（D1）、`openspec/config.yaml` 的 `context:`、`CLAUDE.md`、`README.md`。

**回退**：1–4（主行程與 preload）與 5–6（renderer）互相獨立。D2 若被推翻（例如 Phase 3 需要診斷），加回 `language/typescript` 與 `ts.worker` 是兩行 import。

## Open Questions

- **macOS 與 Windows 的 chokidar 語意**：`depth: 0` 在 FSEvents 與 `ReadDirectoryChangesW` 上是否同樣只回報直接子項目？`followSymlinks: false` 在 Windows 的 junction 與 reparse point 上如何表現？本 change 僅 Linux 實測。
- **markdown 中的遠端圖片仍會發出網路請求**（`![](https://…/x.png)`）。它不會洩漏 preload 白名單（D9 擋住的是導航），但會向第三方洩漏「使用者開啟了這個檔案」。目前未設 CSP、未阻擋 `img`。要處理的話，`session.setPermissionRequestHandler` 管不到圖片，得靠 CSP 或 `webRequest` 攔截。
- **`readFile` 的 2 MiB 上限是否該可設定？** 目前寫死。使用者若要看一個 5 MB 的 log，只能用自己的編輯器。
- **git 狀態標籤（mockup 的 `M` / `A`）獨立成 change 時，要與 watcher 如何協作？** 每次事件都重跑 `git status --porcelain` 太貴；快取的失效條件需要設計。
- **Phase 3 的編輯能力進來時，markdown 是渲染還是原始碼？** 本 change 只渲染，沒有切換原始碼的入口。屆時需要一個 render／source 的切換，且它會與 dirty 狀態互動。
- **檔案檢視的捲動位置與「回到樹」之後再點同一個檔案**：是否該記住？本 change 不記。
