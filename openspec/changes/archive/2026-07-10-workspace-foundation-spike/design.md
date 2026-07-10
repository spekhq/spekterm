## Context

`spek-workspace` 目前沒有任何可執行的程式碼。PRD §8「系統架構」建立在三個未經驗證的假設上：主行程能直接 `import` `@spek/core`、`node-pty` 能在 Electron 下運作、renderer 能載入編輯器。本 change 的職責是把這三個假設變成事實或推翻它們。

**撰寫本文件時已進行實機驗證**（2026-07-09，Linux x64 / Node 22.22.0 / Electron 43.1.0），結果推翻了 PRD 的一項假設（`electron-rebuild` 的必要性）、修正了另一項（`node-pty` 的版本選擇），並發現一個 PRD 未預見的阻塞（`@spek` 這個 npm scope 已被他人佔用）。以下決策皆附實測證據，而非推論。

**約束**

- 目標三平台（PRD §3.3）：macOS / Windows / Linux。Linux 與 Windows 是刻意要補的 cmux 空窗（§2.4、§3.1）。
- 本 repo 是**專有授權的私有 repo**，卻要依賴**公開 MIT 授權**的 core 套件，且兩者不在同一個 monorepo。
- OpenSpec change 是 repo-local 的：`openspec status` 回報的 `allowedEditRoots` 僅含 `spek-workspace`。

## Goals / Non-Goals

**Goals:**

- 拍板三個技術決策：core 套件的名稱與分發方式、`node-pty` 的取得與載入策略、編輯器選型。
- 立起可執行的 `@spek/workspace` 骨架（開視窗、renderer 載入 React），並從第一天套用 PRD §12 的信任模型。
- 在還沒有任何程式碼可返工的時候，把 PRD §13 的高風險項目提前引爆。

**Non-Goals:**

- 不實作任何工作台功能：多 folder 工作區、檔案樹、terminal UI（xterm.js）、OpenSpec 側欄、handoff 一律不做。
- 不做 `electron-builder` 的實際打包產出（Phase 6），本 change 只確保選型不會讓打包在未來變成死路。
- 不對三平台做完整矩陣驗證。本 change 只在 Linux x64 實測；macOS / Windows 的對應驗證列為 Open Questions。
- 不決定 `spek` repo 內部其他 private workspace（如 `@spek/web`）是否一併更名 —— 那屬該 repo 的 change。

## Decisions

### D1：core 套件更名為 `@spekjs/core`，以 npm public 分發

**問題有兩層。**

第一層：`@spek/core` 在 `spek` monorepo 裡標記 `"private": true`、無 `files` 欄位、從未發佈到 npm（`GET registry.npmjs.org/@spek%2Fcore` 回 404）。它只能被 `spek` 自己的 npm workspaces 解析，因此 `spek-workspace` 沒有任何合法管道安裝它。PRD §8.1／§9.1／§11 全部預設主行程可直接 `import`，卻未交代跨 repo 如何取得。

第二層（PRD 完全未預見）：**`@spek` 這個 npm scope 已被他人註冊，本專案的 npm 帳號 `kewangtw` 無權發佈至該 scope。** 即使把 `private` 拿掉也發不出去。

**實測證據**（2026-07-09，全部以對照組校準；並經一次獨立複驗）

| 查詢 | 對 `spek` 的結果 | 對照組 | 推論 |
|---|---|---|---|
| `npm org ls spek` | exit 0，`{}` | 不存在的 scope → exit 1 + `E404 Scope not found`；`babel` → exit 0，`{}` | scope **存在**，且 `kewangtw` 看不到成員名冊 |
| `npm access list packages @spek` | exit 0，`{}`（0 個套件） | `@kewangtw` → 列出 `pppr`、`monitor-resource`；`@babel` → 列出實際套件；不存在的 scope → `E404` | scope 存在、`kewangtw` 無任何存取權，且其下 **0 個已發佈套件** |
| `GET /-/org/spek/user`（帶 token） | 200 `{}` | 不存在 → 404 `{"error":"Scope not found"}` | scope 已註冊 |

佔用者發佈過 **0 個套件** → 是佔名（name reservation），不是活躍專案。

**兩個無鑑別力、不可採用的驗證方法**（記錄下來，避免日後重蹈）

- **`npm publish --dry-run` 不向 registry 驗證權限**，它只做本地打包。對照組：對 `@babel/core` 執行 dry-run 同樣「成功」，而那是 `kewangtw` 絕對發不了的 scope。**不可用它判斷 scope 是否可發佈。**
- **npm registry search 的 `scope:` 過濾器不可靠**：`scope:babel` 也回 0 筆。以「`scope:spek` 搜尋回 0 筆」推論 scope 為空是無效推理。

註：`{}` 與 `{"x":"owner"}` 的差異**不能**用來區分 user scope 與 org（`@babel` 回 `{}`、`@angular` 回 `{"angular":"owner"}`，兩者都是 org）。因此本文件只主張「`@spek` 已被註冊且 `kewangtw` 無權」，不主張它是 user 還是 org。

**決定**

註冊新的 npm org **`spekjs`**（已以對照組確認 org 名與 user 名皆未被佔用），core 套件更名為 **`@spekjs/core`** 並發佈至 npm public（`private: false`、`files: ["dist"]`、`publishConfig.access: "public"`）。PRD §9.2 規劃於 Phase 5 抽出的 UI 套件，對應命名為 `@spekjs/ui`。

**替代方案與否決理由**

| 方案 | 否決理由 |
|---|---|
| 維持 `@spek/core` | **不可行**：scope 已被佔，`kewangtw` 無發佈權。 |
| `spek-core`（unscoped，已確認可用） | 可行，但無 namespace 保護；PRD §9.2 之後還要發 `spek-ui`，套件變多後零散，且好的 unscoped 名字容易被搶。 |
| `@kewangtw/spek-core`（user scope，已確認可用） | 可行且零註冊成本，但名字綁個人帳號，與 PRD §2.4「讓 core 成為 OpenSpec 生態的標準解析引擎」的定位衝突。 |
| 向 npm 申請 `@spek` name dispute | 佔用者 0 套件，符合閒置條件，但流程數週且不保證成功。可作為長期並行動作，不應阻塞 Phase 0。 |
| 本機 `file:../spek/packages/core` 依賴 | 綁死本機絕對路徑；npm 對 `file:` 目錄建立 symlink，`electron-builder` 打包與 CI 都要額外處理。把成本推遲到 Phase 6，而非消除。 |
| git dependency 指向 monorepo 子目錄 | npm 原生不支援 monorepo 子目錄作為 git 依賴，需 `gitpkg` 之類中介或維護 dist 分支，複雜度高於發 npm。 |
| 將 `spek-workspace` 併入 `spek` monorepo | 授權衝突：`spek` 是 MIT 公開，workspace 是專有私有（PRD §10）。 |

**選 npm scope 的額外理由**：PRD §2.4 把「core 成為 OpenSpec 生態的標準解析引擎」列為戰略機會。發佈到 npm 是該戰略的前提，而讓 workspace 當它的第一個外部消費者，正好驗證這個引擎對外好不好用 —— 若自己用起來都彆扭，別人更不會用。Phase 0 只需要現有的 `scanOpenSpec()`，不必改動 core 的實作，因此不會立刻被迫發第二版。

**改名的波及範圍**（屬 `spek` repo 的工作，見 D5；此處記錄以利估算）

`spek` repo 內 `@spek/core` 共 412 處引用。其中應改與不應改的界線是關鍵：

- **應改**：`packages/core/package.json` 的 `name`；`packages/web`（24）、`packages/vscode`（6）、`packages/intellij`（6）、`packages/core`（3）的引用；`packages/web` 與 `packages/vscode` 的依賴宣告；`.github/workflows`（2）；`README` / `CLAUDE.md` / `docs` 等描述現況的文件。
- **不應改**：`openspec/changes/`（68 個檔案，含 archive）—— 那是歷史記錄，記載當時的事實，改動等於竄改歷史。`openspec/specs/`（11）描述現況，應改。
- **不需改**：`@spek/web`（47 處）是 `private: true` 的 workspace 名，從不發佈，不佔用 npm scope。是否為求一致而一併更名，由 `spek` repo 自行決定，**不影響本 change**。

**開發期迭代**：`package.json` 一律宣告 npm 版本依賴；本機需要同步改 core 時用 `npm link` 覆寫，不把 `file:` 寫進版控。這樣打包與 CI 永遠看到的是真實的套件依賴。

### D2：使用 `node-pty@1.2.0-beta.14`（釘死版本），不使用 `@electron/rebuild`

**`node-pty` 是正確且唯一的選擇。** 它的週下載量為 18,727,910，遠高於任何替代品；更關鍵的是 **VS Code —— Electron 生態最大的終端機宿主 —— 正是用 `node-pty` 搭配 `@xterm/xterm`**，與 PRD §8.3 的選型一致。「Electron 下的 pty」這件事上沒有更好的候選。

**但 npm 的 `latest` 是錯的版本。** VS Code 依賴的是 `^1.2.0-beta.13`，而 npm `latest` 停在 1.1.0。兩者的 prebuild 覆蓋差異決定了整個 Linux 開發體驗：

| | `node-pty@1.1.0`（npm latest） | `node-pty@1.2.0-beta.14` | `@lydell/node-pty` |
|---|---|---|---|
| prebuilds 平台 | darwin×2、win32×2 | darwin×2、win32×2、**linux×2** | 六平台（分包） |
| Linux 安裝需本地編譯 | **是** | 否 | 否 |
| `node_modules` 實測大小 | — | 27 MB | **188 KB** |
| 來源 | microsoft 官方 | microsoft 官方 | 第三方 fork |
| VS Code 採用 | — | ✓ | — |

**實測證據**（2026-07-09）

1. `node-pty@1.1.0` 的 install script 是 `node scripts/prebuild.js || node-gyp rebuild`。在 Linux 上必定掉進本地編譯（輸出：`Rebuilding because directory .../prebuilds/linux-x64 does not exist`），需要 Python ≥ 3.8 與 C++ toolchain。實測時 `pyenv` 的 shim 讓 `python3` 指向 Python 3.7.0、遮蔽系統的 `/usr/bin/python3.8`，node-gyp 直接拋 `SyntaxError`，安裝失敗。
2. `node-pty@1.2.0-beta.14` 的 `prebuilds/` 涵蓋六平台（含 `linux-x64`、`linux-arm64`）。實測安裝耗時 5 秒、未產生 `build/` 目錄 —— **完全沒有觸發編譯**。
3. 兩個版本的 `pty.node`（無論本地編譯或 prebuilt）皆為純 Node-API 模組：`nm -D` 顯示 **40 個 `napi_*` symbol、0 個 `v8::` symbol**。
4. 兩個 runtime 的 ABI 編號截然不同，但 N-API 版本相同：

   | runtime | Node | ABI (`process.versions.modules`) | N-API |
   |---|---|---|---|
   | Node 22.22.0 | 22.22.0 | 127 | 10 |
   | Electron 43.1.0 | 24.18.0 | 148 | 10 |

5. 將 prebuilt 的 `pty.node`（以及另一次實驗中**為 Node 22 編譯**的版本）放進 Electron 43 runtime（`ELECTRON_RUN_AS_NODE=1`）：`require('node-pty')` 成功，`spawn` 出真 pty（`tty` 回報 `/dev/pts/*`），exit code 0。`@lydell/node-pty` 同樣通過。

**結論**

- **PRD §8.3 與 §13 的假設是錯的**。§8.3 寫「`node-pty` 需 `electron-rebuild` 對齊 Electron ABI」、§13 把「native ABI 對不上 Electron」列為首要風險 —— 那是 `node-pty` 還在用 NAN 的時代的舊事實。Node-API 的 ABI 跨 runtime 穩定，同一顆 `.node` 可同時被 Node 與 Electron 載入。**`@electron/rebuild` 從依賴中移除。**
- **釘死 `node-pty@1.2.0-beta.14`**（不用 `^`）。理由：唯有 1.2.0-beta 系列有 Linux prebuilt，而 Linux 正是 PRD 要主攻的空窗平台之一；同時避免 `^` 在 beta 系列上意外跳版。

**備案**：`@lydell/node-pty`（"Smaller distribution of node-pty"）採 optionalDependencies 分平台包（esbuild 模式），只安裝當前平台，實測 188 KB。若 Phase 6 發現 27 MB 的六平台 prebuilds 讓打包膨脹且 `electron-builder` 的 `files` 規則不好處理，可換用它。代價是第三方 fork、同樣是 beta。

### D3：編輯器沿用 Monaco（使用者決策），fallback 為 CodeMirror 6

**先澄清一個容易誤解的點**：選 CodeMirror 6 **不等於**放棄檔案 view/edit。CM6 完整支援 PRD F3 要的全部能力 —— syntax highlight、dirty 狀態、`Cmd/Ctrl+S` 存檔。PRD §6.2 說編輯器「降級」，指的是**版面地位**（不再是主編輯區的一級公民），不是功能取捨。因此「檔案 view/edit 是必要的」本身不構成排除 CM6 的理由。

**決定採用 Monaco**，理由如下：

- PRD §5 F3 明列 Monaco；§11 Phase 0 也明列「Monaco 能在 renderer 載入並高亮」為驗收項。本決策忠於 PRD。
- **VS Code 同款手感**。本產品的目標使用者正是 VS Code / Claude Code 使用者，編輯器的操作直覺與快捷鍵一致可降低學習成本。
- **保留向上生長的餘裕**。若日後編輯能力要往 IntelliSense、內建 diff 發展，Monaco 不需要更換引擎。

**代價（必須實測，不可假設）**

| | monaco-editor 0.55.1 | CodeMirror 6 核心 |
|---|---|---|
| npm 解開大小 | 69.3 MB | ~1.9 MB（`view` 1.2 + `state` 0.4 + `language` 0.3） |
| Web Worker | 需要（`editor.worker` 等），Vite 設定為 PRD §13 列名風險 | 不需要 |

因此 **Phase 0 對編輯器的驗收條件加嚴**：不只「能載入並高亮」，還要 (a) 量出 renderer bundle 中 Monaco 的實際貢獻，(b) 確認 worker 在 electron-vite 的 **dev 與 build 兩種模式**下都能運作。PRD §8.3 原文即為「先以 Monaco 技術驗證，視打包大小再定；替代 CodeMirror 6」—— 若上述任一項在 Phase 0 證明不可行，即依原文退守 CM6。

**編輯器一律包在一層薄 wrapper 介面之後**，Files 檢視只依賴該介面。無論最終用 Monaco 或退守 CM6，替換成本都侷限於單一模組。

#### Phase 0 實測結果（2026-07-09）：維持 Monaco

**(a) worker 兩模式皆通過 —— PRD §13 的風險不成立。**

`scripts/probe-editor.mjs` 以 CDP 連進執行中的 app，dev 與 build 兩種模式下結果一致：註冊 3 種語言、model 語言為 `typescript`、7 種 token class、實際建立 `typescript` 與 `editorWorkerService` 兩支 worker，且 TypeScript worker 完成語意分析並回填 diagnostic marker。

判定 worker 是否存活的依據刻意不是「看到語法高亮」—— tokenization 由主執行緒完成，看到顏色證明不了 worker。probe 建立一個帶型別錯誤的 model，唯有 `ts.worker` 跑完語意分析才會產生 marker，收到 marker 才算數。

過程中確認的兩件事：Vite 打包後 `file://` 下的動態 import 與 module worker 建立**皆正常**（實測 `import('./assets/tsMode-*.js')` 與 `new Worker(url, {type:'module'})` 都成功），因此不需要改用自訂協定；而 `monaco-editor` 未宣告 `sideEffects`，rollup 不會 tree-shake 掉純副作用的 contribution import。

**(b) 體積：20.88 MB，較不含 Monaco 的基準增加 20.34 MB（×38.7）。**

| 項目 | 大小 |
|---|---|
| 不含 Monaco 的基準（React 19 + Tailwind v4） | 0.54 MB |
| `ts.worker`（TypeScript 編譯器本身） | 12.65 MB |
| 主 chunk（Monaco core + React） | 7.51 MB |
| `editor.worker` | 0.52 MB |
| `codicon` 字型 / `tsMode` / `markdown` | 0.16 MB |
| **renderer 資產總計** | **20.88 MB** |

（以 `npm run measure:bundle` 可重現。）

**判定：維持 Monaco。** worker 風險已證偽，體積對一個 Electron 桌面 app（本體逾百 MB）不構成阻礙。

**但體積的組成揭露了一個之後可收割的選項**：`ts.worker` 一支就佔 12.65 MB，它的存在只為語意分析（診斷 / IntelliSense）。PRD §6.2 已將編輯器降級為 side panel 的檔案檢視，而 F3 只需要語法高亮與存檔 —— 兩者都不需要 `ts.worker`。若 Phase 6 的打包體積成為問題，移除 `language/typescript` contribution 即可省下這 12.65 MB，且不影響 F3 的任何需求。這個取捨留給 Phase 6，不在本 change 執行。

**實作上的兩個要點**（供後續 Phase 參考）：語法高亮與語言服務來自不同的 contribution（`basic-languages/*` 提供 monarch tokenizer、`language/*` 提供 worker 驅動的語意分析），少了前者只會得到單一 token class；`monaco.languages.typescript` 在 0.55 已標記 deprecated（型別為 `{ deprecated: true }`，runtime 尚存），不應用於新程式碼。

### D4：Electron 版本鎖定在 43.1.0

鎖定實測過的版本以確保建置可重現。因 D2 的 N-API 結論，Electron 升版不再會打破 `node-pty`，鎖版的理由從「避免 ABI 災難」降級為「可重現建置」，但仍然保留。升版時需檢查 Electron 提供的 N-API 版本不低於 `node-pty` 的要求（目前雙方皆為 10）。

### D5：跨 repo 前置以獨立 change 處理，不寫進本 change 的 tasks

D1 需要註冊 npm org、改動 `spek` repo（更名 + 發佈設定 + 412 處引用的取捨）並執行 npm publish，但 OpenSpec change 是 repo-local 的（`allowedEditRoots` 僅 `spek-workspace`）。把別的 repo 的編輯步驟塞進本 change 的 `tasks.md`，會讓任務清單宣稱一件它無權完成的事。

**作法**：在 `spek` repo 開一個獨立的 OpenSpec change（建議名 `publish-core-to-npm`）承載更名與發佈工作。`spek-workspace` 的 `tasks.md` 只驗證**其結果** —— 「`npm view @spekjs/core version` 能取得已發佈版本」—— 並將其標記為外部前置。兩個 repo 各自對自己的變更負責。

**執行順序**：先在 npmjs.com 註冊免費 public org `spekjs`（唯一無法以唯讀方式完成的前置），再回 `spek` repo 開該 change。此前置**不阻擋** `workspace-app-shell` 與 `native-module-toolchain` 的推進，只阻擋 `spek-core-integration` 的驗收。

## Risks / Trade-offs

- **`spekjs` org 註冊後仍可能與他人衝突** → 已以對照組確認 org 名與 user 名皆為 404（未被佔）。註冊是先到先得，應盡早完成。若在註冊前被搶，退用已確認可用的 `spek-core`（unscoped）或 `@kewangtw/spek-core`。
- **更名波及 `spek` repo 412 處引用** → 大部分是可批次替換的 import 與依賴宣告，且該 repo 有 `type-check` 與 `@spek/core` 的 unit test 可回歸。關鍵是**不要動 `openspec/changes/` 的歷史記錄**（68 檔），只改描述現況的 `openspec/specs/`（11 檔）與程式碼。
- **`node-pty@1.2.0` 仍掛在 `beta` dist-tag（npm `latest` 是 1.1.0）** → VS Code main 分支依賴 `^1.2.0-beta.13`，實務風險低。釘死版本、升版前重跑「Electron 載入 + spawn 真 pty」驗證。若專案政策不接受 beta 依賴，退回 1.1.0 就必須接受 Linux 本地編譯（需 Python ≥3.8 + C++ toolchain），且 macOS / Windows 不受影響 —— 但那等於把痛苦轉嫁給 Linux 貢獻者與 Linux CI。
- **版本管理器會遮蔽系統 Python（實測已發生：`pyenv` 的 3.7 蓋掉 `/usr/bin/python3.8`）** → 僅在退回 1.1.0 的情境下才會遇到。屆時應文件化前置需求並提供環境檢查腳本，且不在 repo 內硬編 `npm_config_python` 路徑（會綁死他人環境）。
- **~~Monaco 的 Web Worker 在 electron-vite 下設定失敗，或打包體積不可接受~~ → 已於 Phase 0 實測證偽**（見 D3「Phase 0 實測結果」）。dev 與 build 兩模式的 worker 皆正常運作，`file://` 下的動態 import 與 module worker 建立亦無阻礙。體積 20.88 MB 可接受，且其中 12.65 MB 的 `ts.worker` 隨時可移除。殘留風險僅在 Phase 6 打包時的安裝檔大小，屆時 wrapper 介面仍確保退守 CM6 的成本侷限單一模組。
- **未來 `node-pty` 要求的 N-API 版本高於 Electron 提供的** → 目前兩邊都是 10，餘裕充足。升 Electron 或 node-pty 時納入檢查。
- **core 發 npm 後，每次改動都要發版**（Phase 1 就會用到 §9.3 要新增的 `listDir` / `readFile` / `writeFile` / `stat`）→ 本機以 `npm link` 迭代，只在里程碑發版。
- **Trade-off：把 core 發到公開 npm 等於讓私有 app 的核心解析邏輯公開可見** → 它本來就是 MIT 開源專案的一部分，發佈不增加任何暴露；商業價值在封閉的 app 與 handoff 層（PRD §10），不在 core。
- **`node-pty` 六平台 prebuilds 使 `node_modules` 達 27 MB** → 對 Electron app（本體逾百 MB）不構成問題，但 Phase 6 打包時需以 `electron-builder` 的 `files` 規則排除非目標平台，否則安裝檔膨脹。備案是改用 `@lydell/node-pty`（188 KB）。
- **本 change 僅在 Linux x64 實測** → macOS / Windows 的 prebuilt 是否真能免編譯載入，未經驗證，見 Open Questions。

## Migration Plan

這是新 repo，沒有既有狀態要遷移；以下是 rollout 順序與回退策略。

1. 在 npmjs.com 註冊免費 public org **`spekjs`**（需人工操作，無法以 CLI 唯讀完成）。
2. `spek` repo：以獨立 change 將 core 更名為 `@spekjs/core`、解除 `private`、加上 `files` 與 `publishConfig`，發佈至 npm。**不改動 `openspec/changes/` 的歷史記錄。** 此步不阻擋 3。
3. `spek-workspace`：建立 electron-vite + React 19 + Tailwind v4 + TypeScript 骨架，依 PRD §12 設定 `contextIsolation: true`、停用 `nodeIntegration`。
4. 驗證三根支柱：主行程 `import @spekjs/core` 掃描 repo；`node-pty@1.2.0-beta.14` 在 Electron 主行程 spawn shell；Monaco 在 renderer 載入並高亮，且 worker 在 dev 與 build 皆正常、bundle 貢獻可量測。
5. 回寫 PRD：§8.1／§9.1／§11 的 `@spek/core` 更名為 `@spekjs/core`；§8.3 移除「`node-pty` 需 `electron-rebuild`」並補上「須用有全平台 prebuilt 的 1.2.0-beta 系列」；§13 將「node-pty native ABI 對不上 Electron」改寫為「須選用涵蓋目標平台 prebuilt 的版本；N-API 使其免 `electron-rebuild`」。§9.2 的 `@spek/ui` 更名為 `@spekjs/ui`。編輯器選型（Monaco）維持不變。
6. 清掉 `CLAUDE.md` 中記錄的兩個待決事項。

**回退**：若 `spekjs` org 在註冊前被搶，退用 `spek-core`（unscoped）或 `@kewangtw/spek-core`，兩者皆已確認可用，D1 的結構不受影響。若 Monaco 的 worker 或體積不可接受，退守 CodeMirror 6。D2 與 D4 互相獨立，不受上述任一回退影響。

## Open Questions

- **macOS / Windows 的 `node-pty` prebuilt 是否真能免編譯直接載入**？本 change 只在 Linux x64 驗證了 prebuilt 與 N-API 跨 runtime 載入。Windows 另有 `conpty.node` / `conpty_console_list.node` 兩顆額外 binary，其載入路徑未驗。
- ~~**Monaco 的 worker 在 electron-vite 的 dev 與 build 模式下如何設定**？~~ **已解答**：Vite 的 `?worker` 後綴 + 全域 `MonacoEnvironment.getWorker` 即可，dev 與 build 皆通過（D3）。
- **`electron-builder` 打包時如何處理 `prebuilds/`**（asar unpack 規則、排除非目標平台）？屬 Phase 6，但選型不應在此埋雷。
- **`node-pty@1.2.0` 何時脫離 beta**？影響是否需要長期釘死 beta 版本。
- **是否要並行向 npm 申請 `@spek` 的 name dispute**？佔用者 0 套件、符合閒置條件。取回後可考慮 alias 或改名，但不應阻塞任何 Phase。
