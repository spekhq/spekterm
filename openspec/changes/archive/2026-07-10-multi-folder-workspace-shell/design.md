## Context

Phase 0 立起了會開視窗的 Electron 骨架，但 renderer 裡是一張診斷頁，preload 白名單只守著一個 `workspace:ping`。本 change 要把它換成 PRD §6.1 的真實版面，並引入第一個會碰檔案系統的 IPC。

**撰寫本文件時已對關鍵事實做過查證**（2026-07-10），其中一項推翻了 PRD 的規劃（§9.3「`listDir` 重用 core」——那個函式不存在），另一項是 proposal 才發現的連鎖效應（移除診斷頁會讓 Monaco 整個消失於 renderer bundle）。以下決策皆附證據。

**約束**

- `allowedEditRoots` 僅 `spek-workspace`。`@spekjs/core` 位於另一個 repo（`spek`，MIT 公開），動它需發 npm 版。
- UI 版面與行為以 `docs/workspace-mockup.html` 為權威（PRD §6.1 明訂衝突時以雛型為準）。
- PRD §12 的信任模型：`contextIsolation: true`、停用 `nodeIntegration`、能力只走 preload 白名單，且 **fs 與 terminal cwd 限制在已加入的 workspace folders**。
- 本 change 僅在 Linux x64 實測；macOS / Windows 的路徑語意差異列為 Open Questions。

## Goals / Non-Goals

**Goals:**

- 讓使用者能把 repo 加進 workspace，且重開 app 記得。
- 立起活動列 + rail + 三欄主舞台的版面骨架，讓 Phase 2–4 有地方可掛。
- **在第一個 fs 能力誕生的同一刻，把信任邊界一起建立起來**，而且是結構性的，不是事後的字串檢查。
- 處理掉診斷頁退場對 `workspace-app-shell` 既有 requirement 的連鎖影響，讓 spec 繼續描述真實。

**Non-Goals:**

- 不做遞迴檔案樹、`readFile` / `writeFile`、tab manager、chokidar、Monaco 開檔、terminal／pty、side panel 的內容、handoff。
- 不持久化 pane 尺寸（PRD §12 有列，留待後續 change）。
- 不實作 rail 的 session 子層（Phase 4）。
- 不改動 `@spekjs/core`（見 D4）。

## Decisions

### D1：fs 能力以 `(folderId, relPath)` 定址，邊界由結構保證而非字串比對

renderer 呼叫 `workspace.fs.listDir(folderId, relPath)`，**永遠不傳絕對路徑**。主行程以 `folderId` 查出已註冊的 folder root，再解析相對路徑。

**為什麼不讓 renderer 傳絕對路徑**：那會把每一次呼叫都變成一道字串驗證題，而字串驗證題會被寫錯。改成 `(folderId, relPath)` 之後，一個有 bug 或被入侵的 renderer **連「表達」邊界外的路徑都做不到** —— 它沒有詞彙可以說出 `/etc/passwd`。這是能力式（capability-style）定址：擁有 id 才擁有存取權，而 id 只從主行程發出。

**仍然必要的執行期檢查**（結構保證擋不住的部分）：

| 攻擊面 | 檢查 |
|---|---|
| `relPath` 為絕對路徑 | `path.isAbsolute(relPath)` → 拒絕 |
| `..` 逃逸 | 解析後比對是否仍在 root 之下 |
| symlink 指向 root 外 | 對 root 與 target 皆取 `fs.realpath` 後再比對 |
| 未知 / 已失效的 `folderId` | 查無 → 拒絕；root 已不存在 → 拒絕 |

**包含關係一律用 `path.relative(root, target)` 判定**（結果不以 `..` 開頭、且不是絕對路徑），**不用 `target.startsWith(root)`**。後者有前綴陷阱：`/a/bc` 會被判定在 `/a/b` 之內。這是這類檢查最常見的錯法，明確寫下來以免日後有人「簡化」。

**替代方案與否決理由**

| 方案 | 否決理由 |
|---|---|
| renderer 傳絕對路徑，主行程驗證 | 邊界退化成字串比對；每個新 API 都要重驗一次，錯一次就全開。 |
| 在 preload 驗證 | preload 與 renderer 同一個行程樹，且 `contextBridge` 之後的物件仍在 renderer 世界。驗證必須在主行程。 |
| 用 Electron 的 `session.setPermissionRequestHandler` | 那管的是 web 權限（相機、地理位置），與檔案系統無關。 |

### D2：workspace 設定持久化於 `userData/workspace.json`，且**不得讓 app 開不起來**

這是本 repo 第一個跨 session 的磁碟狀態，形狀要一開始就對。

```jsonc
{ "version": 1, "folders": [{ "id": "<uuid>", "path": "/abs/realpath", "addedAt": "<ISO>" }] }
```

- **`version` 欄位從第一天就有**。日後 schema 要動時，沒有版本欄位的舊檔無法安全遷移。
- **原子寫入**：寫 `workspace.json.tmp` 再 `rename`。同一檔案系統上 `rename` 是原子的，避免斷電／當掉留下半截 JSON。
- **讀取失敗一律降級為空 workspace，絕不拋錯終止啟動**：JSON 壞掉、`version` 不認得、`folders` 型別不符 → 把原檔改名保留（`workspace.json.corrupt-<timestamp>`）、以空清單啟動、記一行 log。一個設定檔壞掉導致 app 打不開，是最糟的失敗模式。
- **`path` 存 realpath**，加入時就解析。去重以 realpath 為準 —— 同一個目錄透過 symlink 加入兩次應被視為同一個。
- **`hasOpenSpec` 不持久化**。它是衍生狀態，會隨 repo 內容改變；每次載入與加入時重算（見 D3）。持久化衍生狀態就是持久化謊言。
- **還原時路徑可能已不存在**：標記為 `missing` 保留在清單中（讓使用者自己移除），不靜默刪除、也不讓啟動失敗。

### D3：`openspec/` 偵測用 `node:fs`，不呼叫 `scanOpenSpec()`

rail 上「這個 repo 有沒有 `openspec/`」只需要一次 `stat`。`scanOpenSpec()` 會走遍 specs 與所有 changes、還會 spawn 一次 `git log` 取時間戳（Phase 0 已證實）—— 對只想畫一個標記的 rail 而言太重，而且 Phase 1 根本不顯示 spec 數量。

Phase 0 在開發模式輸出掃描摘要的行為維持不變，兩者互不干擾。真正需要掃描結果的是 Phase 5 的 OpenSpec 側欄。

### D4：`listDir` 用 `node:fs` 實作於主行程，**不推回 `@spekjs/core`**

PRD §9.3 寫「IPC：`fs.listDir`（重用 core）」。**查證結果：core 沒有這個函式。** 它的公開匯出裡沒有 `listDir` / `readFile` / `writeFile` / `stat`；`safeReadDir` 與 `readFileOrNull` 是 `scanner.ts` 的**私有 helper**。要「重用」得先在 `spek` repo 抽出、發一版 npm —— 與 Phase 0 被 `@spek` scope 卡住的是同一種跨 repo 前置，而本 change 無權編輯該 repo。

**決定**：Phase 1 在主行程直接用 `node:fs` 實作，不動 core。

**理由不只是「省事」**：

- `@spekjs/core` 是公開的 MIT 套件，讀者是 OpenSpec 生態的 API 消費者。讓一個私有 app 的**單一**需求去定 `listDir` 的簽章，很可能定錯 —— Phase 1 只知道自己要列一層目錄，不知道 Phase 2 的 lazy load 樹、Phase 3 的寫入、Phase 5 的 watch 各自要什麼。
- **邊界檢查絕不能搬進 core**。那是 app 層的政策（哪些 folder 被使用者加入），不是函式庫的職責。core 服務的另一個消費者（唯讀檢視器 `spek`）根本沒有 workspace folder 的概念。
- 等 Phase 3 有了 `readFile` / `writeFile` / `watch` 三、四個真實消費者、簽章穩定了，再評估是否值得推回 core。**屆時推回去的只會是純粹的 fs 原語，不含邊界政策。**

若日後結論相反，需依 Phase 0 `design.md` D5 的先例，在 `spek` repo 開一個獨立 change 承載。

### D5：`workspace-app-shell` 的兩條 Monaco requirement 標為 `REMOVED`

**事實**（已查證）：`src/renderer/src/App.tsx` 是 renderer 中**唯一** import `./editor` 的模組；而 `src/renderer/src/editor/` 是唯一 import `monaco-editor` 的地方。本 change 用真實版面取代診斷頁後，`editor/` 不再被任何模組引用，**Monaco 連帶不會被打包進 renderer bundle**。

於是兩條 requirement 同時失去意義：

- 「Monaco 編輯器在 renderer 載入並提供語法高亮」—— app 裡沒有編輯器可開。
- 「Monaco 對 renderer bundle 的體積貢獻可量測」—— 貢獻為零，「與不含 Monaco 的基準比較」成了同義反覆。

**決定**：兩條標為 `REMOVED`。保留第三條「編輯器透過 wrapper 介面存取」—— 它是結構約束（*若*有人用 monaco，只能經 wrapper），不需要有人掛載編輯器就成立，且正是它讓 Phase 2 換編輯器的成本侷限於單一模組。

`src/renderer/src/editor/` 保留在磁碟上供 Phase 2／3 使用。`scripts/probe-editor.mjs` 移除（沒有載體可驗的探針是死重）。`npm run measure:bundle` 保留 —— 它報告的是 renderer 資產總覽，Monaco 那幾行自然歸零。

**替代方案：保留 requirement，把驗收載體換成獨立的探針 harness**（在建置設定加一個只在探針模式啟用的 rollup entry）。**否決理由**：

- 它驗的是一個**不會出貨**的 bundle，違背 Phase 0 立下的原則 ——「要驗的正是被出貨的那份程式碼」。
- spec 應描述系統當下為真的行為。Phase 1 的 app 確實不載入 Monaco，寫「SHALL 載入」是假的。
- 為了守一個 Phase 1–2 期間沒有任何使用者的能力，換來 conditional rollup input + 常駐死碼 + 一份會誤導人的 spec。

**代價與緩解**：Monaco 的 worker 在 dev／build 兩模式可運作的保證，在 Phase 1–2 期間無人看守。緩解有三層：

1. `tsc` 與 `eslint` 仍涵蓋 `src/renderer/src/editor/`（它在 `src/**` 之下），因此**型別層面的腐化不會發生**；風險侷限於「打包與 worker 載入」這一層。
2. 封存的 Phase 0 `design.md` D3 完整記錄了讓它運作的作法（Vite `?worker` + 全域 `MonacoEnvironment.getWorker`），以及那個反直覺的教訓 ——「不能靠看到語法高亮判定 worker 存活，tokenization 在主執行緒完成」。Phase 2 不需要重新摸索。
3. **Phase 2 的 proposal 必須以 Files 檢視為載體重新確立這兩條 requirement。** 這筆債記在 `CLAUDE.md` 的路線圖。

### D6：驗收改為不依賴產品 UI 攜帶的測試屬性

Phase 0 的 `probe-shell.mjs` 讀的是診斷頁刻意提供的鉤子：`data-preload-api`、`data-testid="trust-model"`、以及 `p-10 → padding=40px`。那是「不在產品程式碼裡塞測試分支」這條原則的軟性違反 —— 分支沒有，但**為了驗收而存在的 UI 與屬性**有。

診斷頁退場正是修正的時機。新的驗收全部從 renderer 的真實狀態求值：

| 要驗的事 | Phase 0 作法 | Phase 1 作法 |
|---|---|---|
| renderer 看不到 Node API | 直接求值 `typeof require` | 不變（本來就不依賴 UI） |
| preload 白名單可用 | 讀 `data-preload-api` | 直接呼叫 `window.workspace.fs.listDir(...)` 並檢查回傳 |
| 非白名單能力不可得 | 讀 `data-*` | 檢查 `window.workspace` 上不存在未暴露的鍵 |
| React 掛載 | `[data-testid="app-root"]` | `#root` 有子節點 |
| Tailwind 生效 | 診斷頁的 `p-10` | 對真實版面元素的 computed style 斷言 |

選取器優先採語意屬性（`nav[aria-label=…]`、`role="separator"`）—— 它們對無障礙有實質價值，不是測試專用鉤子。`workspace:ping` 這個示範 IPC 隨診斷頁一併移除。

### D7：split panes 採 `react-resizable-panels`

**實測數據**（npm registry，2026-07-10）：

| | `react-resizable-panels` | `allotment` | `react-split-pane` |
|---|---|---|---|
| 版本 / 最後發佈 | 4.12.1 / **2026-07-03** | 1.20.5 / 2025-12-19 | 3.2.0 / 2026-02-19 |
| runtime 依賴 | **無**（`dependencies: {}`，僅 react / react-dom peer） | 有（含 CSS） | 有 |
| 週下載量 | **36,453,810** | — | — |
| 授權 | MIT | MIT | MIT |

下載已發佈的 tarball 逐項查證（不是憑印象）：型別中有 `collapsible?: boolean`、`collapsedSize?`、`minSize?`；dist 產出含 `role="separator"`，並處理 `ArrowLeft` / `ArrowRight` / `Home` / `End`。ESM 產物 54.7 kB（`dist/` 的 528 kB 大半是 source map，不進 bundle）。

這三件事正是自行實作最容易做壞的部分。拖動本身簡單，但 pointer capture、收合後還原原尺寸、鍵盤操作與 `role="separator"` 的 ARIA 語意都要自己處理，換不到任何東西。

`autoSaveId` 可持久化 pane 尺寸，本 change **不啟用**（Non-Goals），但保留了升級路徑。整個依賴侷限在 renderer 的 `shell/` 模組內，日後要換不會擴散。

### D8：rail 只做 repo 一層，不預先抽象 session

mockup 的 rail 是 `repos → sessions` 兩層，但 session 屬 Phase 4。本 change **不建立空的 session 抽象** —— 沒有實作的抽象只會在 Phase 4 被推翻。

但 DOM 與元件形狀沿用 mockup 的巢狀結構（`.ws-repo` 包住 `.ws-repo-row`），使 Phase 4 加入子列時不需要重構外層。沒有 `openspec/` 的 repo 於 rail 標示，且其 OpenSpec 身分按鈕 disabled（mockup 的 `spek-web`）。

### D9：引入單元測試層（`node:test` + `tsx`），與探針分工

本 repo 的驗收文化是「以 CDP 連進真正執行中的 app」，Phase 0 沒有任何單元測試。本 change 破例引入 `npm test`，理由不是「單元測試比較好」，而是**有兩類 scenario 探針根本測不到或代價過高**：

- **「邊界檢查 SHALL 在主行程執行」在 `contextIsolation` 下無法從 renderer 驗證。** renderer 拿不到 `ipcRenderer`，也就無法繞過 preload 直接餵越界參數給主行程的處理常式。唯一的載體是主行程那個純函式。
- **窮舉邊界的邪惡輸入，透過 app 建構的代價過高。** 兄弟目錄前綴（root `/a/b` 對目標 `/a/bc`）、root 內指向 root 外的 symlink、`realpath` 之後才越界的路徑 —— 這些要用臨時目錄擺出來，在單元測試裡是幾行，在探針裡要重啟 app、種 profile、跨 CDP 傳結果。
- **「偵測不 spawn 外部程式」用行程樹取樣測不準。** 開發模式的掃描摘要本來就會 spawn 一次 `git log`（Phase 0 的 `getTimestamps`），會混淆歸屬；`git` 又是毫秒級行程，取樣容易漏抓。改在單元測試裡攔截 `node:child_process` 的全部入口，並加對照組證明攔截生效。

**分工原則**：純邏輯與邪惡輸入歸單元測試；「被出貨的那份程式碼是否真的這樣運作」歸探針。兩者不重疊 —— 例如邊界的窮舉在 `npm test`，而「renderer 經 preload 呼叫時邊界仍然生效」在 `probe:workspace`。

**執行環境**：`node --import tsx --test src/main/*.test.ts`。選 `tsx` 而非 Node 22 內建的 `--experimental-strip-types`，因為後者要求 import 具體副檔名，與本 repo 的 `moduleResolution: bundler`（省略副檔名）衝突；且 `spek` repo 的 `@spekjs/core` 已用同一組合，維持一致。`tsx` 為 devDependency，不進打包產物。

**代價**：測試檔（`src/main/*.test.ts`）與產品碼同目錄，因此被 `tsconfig.node.json` 與 eslint 一併涵蓋 —— 好處是型別與風格不會漂移，壞處是 `src/main/` 看起來變雜。若日後檔案變多，再考慮移到 `tests/`。

## Risks / Trade-offs

- **邊界檢查寫錯 = 整個檔案系統外洩** → D1 的結構性定址讓 renderer 無法表達越界路徑；執行期再以 `path.relative` 與 `realpath` 雙重把關。明文禁止 `startsWith` 前綴比對。
- **TOCTOU：檢查通過後、開啟前，路徑被換成 symlink** → Phase 1 只列目錄，影響侷限於「看到不該看的檔名」。**Phase 3 引入寫入時必須重新評估**（`O_NOFOLLOW`、以 dirfd 相對開啟）。此處明確記錄，避免 Phase 3 以為邊界已經解決。
- **hard link 無法以路徑檢查防禦**（同 inode、不同路徑，realpath 各自成立）→ 已知限制。使用者把 hard link 放進自己加入的 folder，是他自己的選擇；跨使用者的威脅模型不在本 app 範圍。
- **`userData/workspace.json` 損毀** → 原子寫入 + 讀取失敗降級為空 workspace + 保留原檔，絕不讓 app 開不起來。
- **folder 被移動或刪除** → 標記 `missing` 保留於清單，不靜默移除。
- **Monaco 的 worker 保證在 Phase 1–2 期間無人看守**（D5 的代價）→ 型別檢查仍覆蓋、作法已記錄於封存的 design、Phase 2 proposal 必須重新確立。
- **新增 renderer 依賴 `react-resizable-panels`** → 零 runtime 依賴、MIT、活躍維護；使用侷限於 `shell/` 模組。
- **大目錄的 `listDir` 阻塞主行程** → 一律用 `fs.promises`。Phase 1 的實際用量只有「加入 folder 時偵測 `openspec/`」（一次 `stat`），真正的大目錄壓力在 Phase 2 的 lazy load 樹。
- **本 change 僅在 Linux x64 實測** → Windows 的路徑大小寫不敏感與 `realpath` 語意、macOS 的 `/tmp → /private/tmp` symlink，皆可能影響 D1 的比對。見 Open Questions。

## Migration Plan

沒有既有狀態要遷移（`userData/workspace.json` 是首次引入）。rollout 順序：

1. 主行程 `workspace-store.ts`：載入 / 原子寫入 / 損毀降級 / realpath 去重。
2. 主行程 `ipc/fs.ts`：`listDir(folderId, relPath)` 與邊界檢查（D1）。
3. preload 白名單擴充為 `workspace.fs.*`；移除 `workspace:ping`。
4. renderer `shell/`：活動列 + rail + 三欄 `PanelGroup` 骨架。
5. rail 綁上 store：加入（原生對話框）／移除／`missing` 標示／`openspec` 標示。
6. 診斷頁 `App.tsx` 退場；`probe-shell.mjs` 依 D6 改寫；`probe-editor.mjs` 移除。
7. 新增 `probe:workspace`：驗證 fs 邊界（越界一律拒絕）與持久化（重啟還原、損毀降級）。
8. 文件回寫：`openspec/config.yaml` 的 `context:`、`CLAUDE.md`、`README.md`。

**回退**：版面（4）與 store／IPC（1–3）互相獨立，任一側可單獨回退。D5 的 spec 變更若被推翻，`editor/` 與 `probe-editor.mjs` 仍在 git 歷史中，取回成本低。

## Open Questions

- **Phase 2 的 Files 檢視是否仍用 Monaco？** 若改用輕量 highlighter，D5 移除的兩條 requirement 就永遠不會回來，`src/renderer/src/editor/` 應一併刪除。PRD §8.3 的退守選項（CodeMirror 6）尚未被排除。
- **邊界對 TOCTOU 與 hard link 的防護要做到什麼程度？** Phase 3 引入 `writeFile` 時必須回答，不能沿用 Phase 1 的「只讀所以還好」。
- **pane 尺寸持久化**（PRD §12 明列）放哪個 Phase？`react-resizable-panels` 的 `autoSaveId` 讓它幾乎免費，但它與 workspace store 的關係（同一個 JSON？localStorage？）未定。
- ~~**活動列的 `Handoffs` / 搜尋 / 設定在 Phase 1 該渲染成 disabled，還是乾脆不畫？**~~ **已解答**（見 `specs/workspace-layout`）：全部渲染但停用，並附「尚未可用」的提示。保留位置讓版面比例自第一天起就與雛型一致；標示停用而非靜默無反應，讓使用者知道那不是壞掉。
- **Windows / macOS 的路徑語意**：大小寫不敏感的比對、`realpath` 對 UNC 與磁碟機代號的處理、macOS `/tmp` 的 symlink。本 change 僅 Linux 實測。
- **`folderId` 是否應在重啟後保持穩定？** 目前存於 JSON 故穩定。若日後改以 realpath 導出，需考慮 folder 被重新命名的情形。
