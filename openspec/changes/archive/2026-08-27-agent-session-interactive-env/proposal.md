## Why

**agent session 的環境不是使用者的 shell 環境。** `terminal.ts` 的 claude 目標以 `zsh -l -c <命令>`
spawn —— 那是**非互動** shell，不讀 `.zshrc` / `.bashrc`。於是每一個只在互動 rc 裡 export 的變數，
在 agent session 內一律不存在。

**這不是推論，是 dogfood 實證。** 使用者在 spekterm 的 agent session 裡跑 Redmine MCP 一直起不來，
根因就是它需要的 `TRACKER_URL` / `TRACKER_API_KEY` 定義在 `.zshrc`。真 pty 下的
對照（受控 `HOME`，`.zprofile` 與 `.zshrc` 各放一個哨兵）：

| | `zsh -l -c`（現行 claude 目標） | `zsh -i -l -c` |
|---|---|---|
| `.zprofile` 的哨兵 | 有 | 有 |
| `.zshrc` 的哨兵 | **無** | 有 |
| `node` | `/usr/bin/node`（系統 v10） | nvm 的 v22.22.0 |
| `openspec` | **無** | 有 |

**issue #20 只記錄了這個缺口最窄的一面**（「`claude` 若裝在 nvm 底下會解析不到」）。它把問題描述成
PATH 的問題，於是既有的緩解也只做到 PATH：`user-path.ts` 於啟動時以互動 shell 查一次 `$PATH`，
併進主行程的 `process.env.PATH`，而 pty 整份繼承主行程環境。**那個機制補不到 PATH 以外的任何一個
變數** —— 而 API key、proxy 設定、工具鏈與語言環境全都在那一類裡。缺口的一般形式是「**環境**」，
不是「**路徑**」。

**現在做，是因為代價已經被量出來，而它落在一個便宜的位置。** 最直覺的修法是把 claude 目標改成
`-i -l -c`，但真 pty 下量三次（每次都一致）：

| | 命令開始執行的時間 |
|---|---|
| `zsh -l -c`（非互動） | **0.04s** |
| `zsh -i -l -c`（互動） | **2.33s** |

那 2.3 秒是使用者 rc 的成本（oh-my-zsh + powerlevel10k + compinit + nvm），**每建立一個 agent
session 都要付一次**（含休眠 session 首次顯示時的重建），且 `claude` 自身啟動只要 0.01s ——
**吸收不掉它**。

而**同一筆 2.3 秒，`user-path.ts` 每次啟動已經在付了**（它查 PATH 用的正是 `-i -l -c`）。把它從
「只取 `$PATH`」擴大為「取整份環境」，**邊際成本是零**，per-session 延遲也是零，而且順帶讓主行程
自己 spawn 的外部程式（core 用的 `openspec`）一併受益。

## What Changes

- **`user-path.ts` 擴大為 `user-env.ts`**：啟動時那一次互動 shell 查詢，自「取 `$PATH` 一個變數」
  改為「取整份環境」。
- **取回的環境不寫進主行程的 `process.env`** —— `process.env` 只保留既有的 PATH 併入（不變），
  其餘變數由模組持有，在建構 pty 環境時才合併。**這是本 change 最重要的一條分界。**
  主行程的環境決定應用程式自身的行為（userData 的落點、CSP 的 dev／production 判定），而那些判定
  發生在啟動流程中，與使用者 rc 的執行速度形成競賽。**實測：決定這些行為的變數多數在桌面環境啟動時
  並不存在**（49 個變數中沒有 `XDG_CONFIG_HOME`、`ELECTRON_*`、`NODE_OPTIONS`）——於是任何
  「只在原本不存在時才加入」的規則對它們一律放行，方向與直覺相反；而一份「不可覆寫」的名單會遺漏
  尚未存在的變數。**不寫進去，這一整類問題就表達不出來。**
- **pty 的環境以使用者的值優先**，`TERM` 與巢狀 Claude Code 標記的剝除由應用程式蓋回來 ——
  那兩件是我們承重的，其餘一律讓位給使用者，因為「等同使用者的環境」就是這個意思。
- **pty 的 spawn 參數維持不變**（`['-l']` 與 `['-l', '-c', …]`）。本 change **不**把 agent 目標
  改成互動 shell —— 那要付上面那 2.3 秒 × 每個 session。
- **terminal-sessions 新增一條要求**：spawn 目標為 agent CLI 的 session，其環境 SHALL 涵蓋使用者
  互動 shell 所建立的環境 —— **不限於 PATH**。此前規格只談「spawn 目標是什麼」，對「session 拿到
  什麼環境」完全沉默，於是這個缺口在規格層面表達不出來，也就沒有東西擋著它。
- **desktop-packaging 的兩條 requirement 一併擴大**：「解析使用者的 agent CLI」那條移除記載於其中的
  已知缺口與 issue #20 的指向；「主行程代表使用者執行的外部程式亦解析使用者的 PATH」那條自 PATH
  擴大為環境。
- **終端 session 的建立 SHALL 與那一次解析對齊時序**。既有的 `whenUserPathReady()` 目前只有
  `openspec-service` 在用；**pty 沒有對齊** —— 於是「開 app 後 2.3 秒內建立的 session」會拿到未補強
  的環境，而那正是重建休眠 session 的時間窗。少了這一條，本 change 在最常走的那條路上靜默失效。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `terminal-sessions`: 新增「agent 目標的 session 環境等同使用者互動 shell 環境」的要求。既有的
  「使用者選擇 session 的 spawn 目標」一條談的是**選什麼**，不涵蓋**拿到什麼環境**。
- `desktop-packaging`: 「打包產物於桌面環境啟動時仍能解析使用者的 agent CLI」移除已知缺口的記載；
  「主行程代表使用者執行的外部程式亦解析使用者的 PATH」自 PATH 擴大為環境，並補上併入規則。

## Impact

- **程式碼**：`src/main/user-path.ts`（更名為 `user-env.ts`，取值範圍擴大、解析改走 NUL 標記與
  `Buffer`）、`src/main/terminal.ts`（`ptyEnv()` 合併使用者環境；`create()` 對齊時序）、
  `src/main/index.ts` 與 `src/main/openspec-service.ts` 的 import 與相關註解。
  **pty 的 spawn 參數不動，`process.env` 的併入範圍不動。**
- **測試**：`src/main/user-path.test.ts` → `user-env.test.ts`（`parsePathOutput` 及其驗 `@@` 標記的
  測試被 `parseEnvOutput` **取代**，不是沿用）；新增受控 `HOME` 的真 spawn 測試與 pty 端到端測試，
  **對照組是「非互動查詢取不到那個變數」與「舊的 `@@` 規則在含引號的值上會截斷」**。本機的 `claude`
  裝在 `~/.local/bin`（由 login rc 提供），造不出 #20 原本的情境，因此驗收不倚賴 nvm 是否在場。
- **驗收分工**：`desktop-packaging` 那兩條「SHALL 以自桌面環境啟動的執行驗收」維持不變且不被替代
  —— 新增的單元測試證明的是取值、合併與傳遞，不是打包產物在桌面環境下的行為。
- **不影響**：login shell 目標的 spawn 參數、`Ctrl+C` 與 job control 語意（pty 仍為非互動 shell）、
  主行程 spawn 的外部程式（它們仍只拿得到 PATH —— 那是現況）、session 持久化與重建（走同一條
  spawn 路徑，自動受益）。
- **缺口未全關**：使用者的 shell 不在可安全查詢名單上（fish 之屬）或平台為 Windows 時，取得一律
  放棄，agent CLI 目標的涵蓋範圍**退回今天的行為**。這一半寫進規格，並於封存時開一張後繼票。
- **issue**：#20 於本 change 封存時關閉，同時開後繼票承接上一條。
