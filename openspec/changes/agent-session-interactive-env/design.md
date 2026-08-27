## Context

見 `proposal.md` — Why。此處只記為了選定作法所需的現況。

**既有的機制已經做對了一半。** `src/main/user-path.ts` 於啟動時以 `zsh -i -l -c` 查一次 `$PATH`，
併進 `process.env.PATH`；`ptyEnv()` 整份繼承 `process.env`，於是 pty 也拿到它。缺的只是**取值的
範圍**：它取一個變數，而缺口在整份環境。

**pty 的兩個 spawn 目標，其涵蓋範圍不同 —— 而這不是本 change 要改的。** login shell 目標
（`['-l']`）掛在 pty 上是互動 shell，本來就讀 `.zshrc`；agent CLI 目標（`['-l', '-c', …]`）是非
互動的，不讀。把後者改成 `-i -l -c` 是最直覺的修法，實測也確實有效，**但每個 session 要付 2.33 秒**
（三次量測：2.33 / 2.32 / 2.37，對照非互動的 0.04 / 0.04 / 0.04），而 `claude --version` 只要
0.01 秒 —— 它是原生 binary，吸收不掉這個延遲。

**主行程的 `process.env` 是承重的。** `app.getPath('userData')`（`index.ts:119`–`143`，決定
`workspace.json` / `sessions.json` / `preferences.json` / `panel.json` 的落點）與 CSP 的 dev／
production 判定（`index.ts:152`，讀 `ELECTRON_RENDERER_URL`）都在 `app.whenReady()` 內求值，
而 `applyUserPathOnce()` 於 module load 觸發、**不被 await**（spec 明文「SHALL NOT 阻塞視窗建立」）。
兩者之間有一個競賽窗口。

`TerminalService.create()` 目前是**同步**的，且不與那一次取得對齊。

## Goals / Non-Goals

**Goals:**

- agent session 內的環境等同使用者手動在終端機裡執行同一個東西時的環境 —— **不限於 PATH**。
- **穩態**的 per-session 啟動延遲不增加（啟動窗口內的第一個 session 例外，見 D4 與 Risks）。
- 使用者的 rc **在結構上無法**改變應用程式自身的行為 —— 不倚賴任何一份「不可覆寫」的名單。
- 取值對「值含任意可列印字元」是安全的。

**Non-Goals:**

- **不**把 pty 的 spawn 目標改成互動 shell（成本見 Context；語意變化見 D1 的替代方案）。
- **不**做「重新讀取環境」的使用者入口 —— 環境是啟動時的快照，改了 rc 要重開 app。
- **不**處理 Windows，**也不**處理不在可安全查詢名單上的 shell（見 D5、D8）。兩者的涵蓋範圍
  退回今天的行為，且該缺口必須寫在規格裡而非只寫在這裡。
- **不**改變 `ptyEnv()` 對巢狀 Claude Code 標記的剝除，也不改變它對 `TERM` 的指定。

## Decisions

### D1. 在主行程取得一次，而不是每個 pty 各自取得

**選定**：擴大既有的啟動時查詢，取回整份使用者環境；pty 的 spawn 參數一個字都不改。

**理由**：那 2.33 秒**已經在付了** —— `user-path.ts` 每次啟動都跑一次 `-i -l -c`。把它從「取一個
變數」改為「取整份環境」，邊際成本是零。而每個 pty 各自取得的話，成本是 2.33 秒 × 每個 session，
且休眠 session 首次顯示時再付一次。

**替代方案（已否決）**：agent 目標改用 `['-i', '-l', '-c', …]`。實測有效且副作用比預期小 ——
真 pty 下**沒有 prompt 或初始化噪音**（`user-path.ts` 註解記載的 gitstatus 錯誤只出現在**非 tty**，
那是 `setopt monitor` 失敗的連帶）、`HISTFILE` **不被寫入**、`Ctrl+C` 仍正確中斷且 shell 以 exit
130 結束而不落回 prompt。否決它的唯一理由就是那 2.33 秒。

> **這個否決有前提**：若日後 per-session 的環境新鮮度變得比啟動延遲重要（例如使用者頻繁改 rc
> 並期待新 session 立即反映），這個裁決要重新做。兩者不是互斥的，可以並存。

### D2. 使用者環境**不寫進 `process.env`**，只在 `ptyEnv()` 內合併

**選定**：解析結果由 `user-env.ts` 模組持有；`process.env` 只保留既有的 PATH 併入（`mergeUserPath`，
不變）。`ptyEnv()` 於建構 pty 環境時合併那份使用者環境。

**理由是爆炸半徑，而它必須由結構界定，不是由名單界定。**

第一版 design 主張「使用者環境中主行程環境**所無**的變數才加入，已存在者保留啟動時的值」，並宣稱
危險變數（`XDG_CONFIG_HOME`、`DISPLAY`、`ELECTRON_*`、`HOME`、`NODE_OPTIONS`）**啟動時都已存在**，
因此規則自動涵蓋它們。**實測推翻了這個前提。** 讀取一個自桌面選單啟動的產物（49 個變數）：

| 變數 | 桌面啟動環境中 |
|---|---|
| `DISPLAY` | 存在 |
| `HOME` | 存在 |
| `XDG_CONFIG_HOME` | **不存在** |
| `NODE_OPTIONS` | **不存在** |
| `ELECTRON_RENDERER_URL` | **不存在** |
| `ELECTRON_RUN_AS_NODE` | **不存在** |
| `WAYLAND_DISPLAY` | **不存在** |

「只新增不覆寫」恰好只保護了不需要保護的那兩個；**舉來當理由的那三類，規則一個都擋不到** ——
它們不在啟動環境裡，所以是「可新增」的。方向剛好是反的。

具體後果有二，兩者都靜默：

- **`XDG_CONFIG_HOME` 被注入 ⇒ userData 換位置** ⇒ workspace／sessions／preferences／panel 全部
  讀不到。畫面上是「所有 repo 與 session 消失，而它們的 pty 還活著」——正是 CLAUDE.md 拿來當
  dev 隔離理由的那個結果。窗口實測約 **220 ms**（`whenReady` 抵達的時間），而一個只有幾行
  `export` 的 `.zshrc` 是 **0.02–0.24 s**。本機的 rc 要 1.2 s 所以贏不了這個 race，**但那是運氣**。
- **`ELECTRON_RENDERER_URL` 被注入 ⇒ 打包產物套用 dev CSP**，且 `createWindow` 會拿它去
  `loadURL`。`scripts/run-probes.mjs` 已經把「這個變數自 shell 洩漏進來」當成必須清掉的危害。

**修法不是補一份黑名單。** 黑名單只涵蓋寫下它那天想到的東西，而遺漏是靜默的 —— 下一個 Electron
版本新增的環境變數不會在名單上。**不寫進 `process.env`，這一整類問題就表達不出來**：主行程讀的
`process.env` 從來沒有被使用者環境碰過，`getPath` 與 CSP 判定於是與 rc 的執行速度無關。

**pty 內的合併順序是 `{ ...process.env, ...userEnv, TERM }`，然後剝除巢狀 Claude Code 標記。**
使用者的值**優先** —— 那正是「等同使用者的 shell 環境」的意思；而 `TERM` 與那份剝除是我們承重的，
放在後面蓋回來。`XDG_CONFIG_HOME` 之類進到 pty 是**正確的**：那是子行程的事，使用者自己開終端機
時本來就是那樣。

**代價**：主行程代表使用者 spawn 的外部程式（core 用的 `openspec`、`git`）仍然只拿得到 PATH，
不會拿到其餘變數。那是**現況**，不是退步，而它們也不需要 API 憑證。

**附帶好處**：憑證的擴散面因此**縮小**而非擴大 —— 只有 pty 拿得到（而使用者自己開終端機時本來
就是那樣），主行程 spawn 的東西一個都沒有。

### D3. 取值以 `env -0`，包夾標記用 NUL

**選定**：固定字串命令 `printf '\0__SPEKTERM_ENV__\0'; env -0`，取**最後一個**標記之後的內容，
以 NUL 切分為 `KEY=VALUE`。

**理由**：**NUL 不可能出現在環境變數的名字或值裡**（`execve(2)` 的結構性限制），於是「標記與分隔
符不會與內容混淆」是一個**結構性保證**，不是機率論證。既有的 `@@` 標記不具這個性質 —— 實測一個
值為 `line1\nline2 with 'quote' and "dquote" and @@ mark` 的變數，NUL 方案完整取回，`@@` 方案會
在它身上截斷。

取**最後一個**標記，是因為互動 rc 印東西到 stdout 是常態（既有註解已記載），而我們的 `printf`
恆為最後執行的東西。

**命令是固定的字串常數，沒有任何拼接** —— 這是選它而非「讓 shell 執行我們的 `process.execPath`
以 node 模式印 JSON」的主要理由（後者要把一個路徑拼進 shell 命令）。

**讀取必須全程走 `Buffer`，不可 `setEncoding`。** 既有實作是 `setEncoding('utf-8')` ＋字串累加；
環境變數的值是**任意位元組**，非 UTF-8 的值會靜默變成 U+FFFD，而 NUL 本身活得下來 ⇒ **解析不會
出錯，只是值壞了**。`parseEnvOutput` 的簽名因此**只收 `Buffer`** —— 收 `string` 的 union 等於在
型別上宣告「維持現狀也可以」。

**已知限制**：`env -0` 是 GNU coreutils 的旗標。**macOS 的 `env` 不支援 `-0`，本機無法實測。**
屆時（Phase 6 的 macOS 產物）的退路是上面那個 `ELECTRON_RUN_AS_NODE=1 "<execPath>" -p
'JSON.stringify(process.env)'` 方案。**在那之前，解析不出標記或取回零個變數時一律放棄**（維持
原行為）—— 這條退路既有機制已經有了，本 change 沿用。

> 實測附記：驗證「`printf '\0…'` 真的印得出 NUL」時**不可經 command substitution** ——
> `$(...)` 會剝掉 NUL，於是量到的是相反的結論。要直接 pipe（`| od -c`）。
> `sh`(dash) / `bash` / `zsh` 三者實測皆正確；`ksh` 本機未安裝，**未驗**。

### D4. session 的建立與那一次取得對齊時序

**選定**：`TerminalService.create()` 改為 async，內部 `await whenUserEnvReady()`。

**理由**：不對齊的話，「開 app 後最初那段時間建立的 session」拿到未補強的環境 —— **而重建休眠
session 正好落在那個窗口**。既有的 `whenUserEnvReady()` 只有 `openspec-service` 在用。

**不變式與呼叫端是否 `await` 無關** —— `await` 在 `create()` **內部**，漏掉 await 的呼叫端只是
拿不到回傳值的時序，環境該齊的一樣齊。這比「型別會擋住漏掉的呼叫端」是更強的說法：後者其實
只對「會用到回傳值」的呼叫點成立（本 repo 的 eslint **沒有** type-checked 設定，也沒有
`no-floating-promises`，一個 `void service.create(...)` 型別與 lint 都不會紅）。

**延遲的實情**：解析於 module load 就開始，而使用者要看到視窗、點下建立入口才會走到這裡 ——
實測解析 1.2 s，通常已經跑完。最壞情況是既有的 **5000 ms 逾時**（`user-path.ts` 的
`TIMEOUT_MS`），而它的註解自己寫著「開機後第一次…合理更慢」。**不另設更短的上限**：設了會讓
rc 慢的機器拿不到環境，而那正是最需要它的那些機器。這筆延遲寫進 Goals 與 Risks，不假裝沒有。

`whenUserEnvReady()` 在從未啟動過解析時**立即完成**（既有行為），因此單元測試與不經
`applyUserEnvOnce()` 的路徑不會卡住。

### D5. shell 白名單保留，但原本的理由已經不成立

既有白名單（`sh` / `bash` / `zsh` / `ksh`）的理由是 **`fish` 的 `$PATH` 是 list 而非以 `:` 連接的
字串**，對它跑同一個 `printf` 會取回第一個目錄。**新的取值方式不讀任何 shell 變數** —— `env` 是
外部程式，它的輸出與 shell 無關，fish 匯出 PATH 時仍以 `:` 連接。那個理由因此消失。

**仍然保留白名單**，改以「未實測」為由：`-i -l -c` 在其他 shell 上的語意、以及它們是否會讓
`env -0` 正常執行，本機沒有 `fish` 可以驗。放棄的代價只是「沒修好」，猜錯的代價是「悄悄取回一份
不完整的環境」。

> 拿掉它的條件很明確：在目標 shell 上實測「`-i -l -c` 能執行 `env -0` 並取回含互動 rc 變數的
> 完整環境」。這條寫在這裡，是為了下一個人不必重新推導原本那個已經失效的理由。

### D6. 檔名改為 `user-env.ts`

`user-path.ts` 這個名字在取值範圍擴大後會誤導 —— 而它是**下一個人尋找這個機制時會 grep 的字串**。
連同 `applyUserPathOnce` / `whenUserPathReady` / `startUserPathResolution` 一併正名；
`parsePathOutput` **被 `parseEnvOutput` 取代**（連同它那組驗 `@@` 標記的測試），不是沿用。
`mergeUserPath()` **維持原名**：它處理的確實只有 PATH，而 `process.env` 的併入範圍也確實只有它。

### D7. 驗收載體：受控 `HOME` 的真 spawn，且對照組要真的能變紅

**本機造不出 issue #20 原本的情境**（`claude` 裝在 `~/.local/bin`，由 login rc 提供），因此驗收
**不倚賴 nvm 是否在場**。改為建一個受控 `HOME`：`.zprofile` 與 `.zshrc` 各放一個哨兵變數、
一個值含換行與單雙引號的變數，並由 `.zshrc` 把一個含假可執行檔的目錄加進 `PATH`。

| 斷言 | 驗什麼 | 退回什麼會讓它變紅 |
|---|---|---|
| `-i -l -c` 取回的環境含 `.zshrc` 的哨兵 | 機制成立 | 把查詢改回非互動 |
| **`-l -c` 取回的環境不含它** | **對照組** | —— 它就是對照組本身 |
| 以 `@@` 規則解析同一份輸出會在含引號的值上截斷 | **對照組** | —— 它證明 NUL 標記有鑑別力 |
| `ptyEnv()` 的結果含該哨兵，且 `TERM` 仍為我們指定的值 | 合併順序 | 把 `userEnv` 從合併中拿掉 |
| pty 內 `.zshrc` 加入 PATH 的假可執行檔解析得到 | 端到端 | 不套用使用者環境 |

**「值含引號的變數完整取回」單獨不是對照組** —— 它只是一條正向斷言，把 NUL 換成任何可用的方案
它都會綠。要有鑑別力，必須同時斷言**舊規則在同一份輸出上會失敗**。

`process.env` **不被使用者環境污染**這件事要有自己的斷言（`applyUserEnvOnce()` 之後，
`process.env` 中除 `PATH` 外沒有任何新增的變數）—— 那是 D2 的整個重點，沒有它，未來一次
「順手也併進 process.env」的改動不會有任何東西變紅。

`desktop-packaging` 那兩條「SHALL 以自桌面環境啟動的執行驗收」**不被這些測試替代**，維持原狀。

### D8. 缺口沒有全關，規格要說出這件事

`startUserEnvResolution()` 在 `win32` 與非白名單 shell 上**直接放棄**。於是 fish／未知 shell 的
使用者，其 agent session 的涵蓋範圍**仍然只有 login rc** —— 也就是 issue #20 原本描述的情境，
原封不動。

因此 `desktop-packaging` 那條記載缺口的段落**不整段刪除**，改寫為「對可安全查詢的 shell 已關閉；
其餘仍在」；`terminal-sessions` 的新要求自帶一條範圍條款。**issue #20 關閉的同時要開一張後繼票**
承接剩下的那一半 —— 「已知的缺口」與「被追蹤的缺口」是兩件事。

## Risks / Trade-offs

- **[環境是啟動時的快照]** → 改了 `.zshrc` 要重開 app 才生效。接受：這與現況（PATH 也是快照）
  一致，且沒有引入新的心智模型。若日後咬人，D1 的替代方案（per-session 互動 shell）仍在桌上。
- **[啟動窗口內的第一個 session 要等]** → 最壞是 5 s 逾時，實測本機 1.2 s，而使用者走到建立入口
  通常已經超過它。**沒有 UI 回饋** —— 若 dogfood 感覺得到，處置是加回饋或縮短上限，不是拿掉對齊。
  另外 `probe:terminal` / `probe:keyboard` / `probe:package` 的第一次 create 也付這筆，既有的
  等待窗口是在沒有它的前提下訂的，重跑時要確認沒被吃掉。
- **[憑證只進 pty，但 pty 裡什麼都可能跑]** → 使用者在 agent session 裡跑的東西全部拿得到
  `NPM_TOKEN` / `MCP_AUTH_TOKEN` / API key 之類。這與他自己開終端機時**一致**，且本 change 不
  擴大任何對外傳輸。**但診斷輸出必須守住**：新增的任何 `console.*` 一律只印變數**名稱與數量**，
  不印值 —— 一行 dump 就是把 API key 寫進使用者的終端輸出。
- **[`env -0` 在非 GNU 平台不可用]** → macOS 未實測（見 D3）。失效方式是「解析不出 ⇒ 放棄 ⇒
  維持原行為」，也就是**退回今天的行為**，不是新的破壞。列為 Phase 6 macOS 產物的前置項。
- **[fish／未知 shell／Windows 的缺口未關]** → 見 D8。處置是寫進規格並開後繼票，不是靜默帶過。
- **[`npm test` 多出 zsh 依賴與真 spawn]** → 跨過了「秒級、無副作用」的分界。受控 HOME 的
  minimal rc 實測 0.02–0.24 s，成本可接受；但**找不到 `zsh` 時必須以可見的 skip 或失敗呈現** ——
  靜默 skip 就是假綠。
- **[bash 使用者的涵蓋範圍取決於他的 profile]** → 實測：`bash -i -l -c` 走 login 路徑，讀
  `.bash_profile` 而**不**直接讀 `.bashrc`（Debian/Ubuntu 的預設 `~/.profile` 會 source 它，
  自訂過的可能不會）。這與**他自己開 login shell session 時看到的一模一樣**，而本 change 的
  目標正是這個等式 —— 不是「等同某個外部終端機」。不做處置，記在這裡以免被誤判為 bug。
