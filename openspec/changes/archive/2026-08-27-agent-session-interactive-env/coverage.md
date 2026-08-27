# scenario → 驗收載體對照表

**填表規則**：每一列的載體都是**實際找出來的那條斷言**（檔名 ＋ 斷言文字），不是憑印象的
「既有」。找不到的寫「無自動化載體」＋理由。

> 這張表本身有前科：`rail-pinned-repos` 建過一張 82 列的對照表，把 39 條既有 scenario 憑印象
> 填成「既有」，事後逐條核對發現**其中 4 條是假的**。所以下面每一列都對回了原始碼。

## `terminal-sessions`（ADDED，8 條全新）

### Requirement: agent 目標的 session 環境等同使用者的互動 shell 環境

| # | Scenario | 載體 |
|---|---|---|
| 1 | 只在互動 rc 設定的變數於 agent session 內可見 | `user-env.spawn.test.ts`「agent 目標的 session 內看得到互動 rc 的變數…」的 `assert.match(out, /AGENT_SEES_RC=from-zshrc/)` |
| 2 | 只由互動 rc 提供的可執行檔路徑可被解析 | 同上一條測試的 `assert.match(out, /AGENT_RESOLVED=<home>\/fake-bin\/claude/)` —— 假 CLI **只**放在由 `.zshrc` 加進 PATH 的目錄裡 |
| 3 | 對照組——未經該機制的環境觀察不到該變數 | `user-env.spawn.test.ts`「對照組：非互動 login shell 取不到互動 rc 的變數」的 `assert.equal(nonInteractive[RC_SENTINEL], undefined)` |
| 4 | 應用程式承重的項目不被使用者環境取代 | `user-env.spawn.test.ts`「ptyEnv 帶上使用者環境，但 TERM 與巢狀標記由我們決定」的 `assert.equal(env.TERM, 'xterm-256color')` 與 `assert.equal(env.CLAUDECODE, undefined)` |
| 5 | 啟動後立即建立的 session 同樣拿到完整環境 | `user-env-timing.test.ts`「取得尚未完成時建立的 session，其 pty 於取得完成後才啟動」的 `assert.ok(ready, …)` |
| 6 | 環境取得失敗時 session 仍建立得起來 | `user-env-fallback.test.ts`「不變更環境，且 session 仍建立得起來」的 `assert.notEqual(created.sessionId, '')` |
| 7 | login shell 目標的環境不因本要求而倒退 | `user-env.spawn.test.ts`「login shell 目標的 session 內同樣看得到（不得倒退）」的 `waitFor(/SHELL_SEES_RC=from-zshrc/)` |

> **第 7 條的鑑別力有限，這裡明說。** login shell 目標掛在 pty 上本就是互動 shell，會自己讀
> 受控 `HOME` 的 `.zshrc` —— 於是即使 `ptyEnv` 完全不合併使用者環境，它**仍可能通過**。
> 對照實驗 2（拿掉合併）實測它**確實變紅**，因為受控 `HOME` 是經由 `userEnv` 之外的路徑傳遞的；
> 但那是這個 fixture 的性質，不是條款本身的保證。它擋得住的是「`ptyEnv` 把 pty 的環境弄壞」，
> 擋不住「login shell 走了一條與 agent 目標不同的環境路徑」。

### Requirement: 本要求的涵蓋範圍取決於使用者的 shell 與平台

| # | Scenario | 載體 |
|---|---|---|
| 8 | 無法安全查詢的 shell 下涵蓋範圍退回 | `user-env-fallback.test.ts` 的 `assert.deepEqual(getUserEnv(), {})` ＋ `assert.notEqual(created.sessionId, '')` |

> **第 8 條是間接的。** 它驗的是「交給 pty 的是空物件，而 session 照樣建得起來」——
> 亦即 pty 只拿得到未補強的 `process.env`，涵蓋範圍等同今天的行為。它**沒有**直接觀察
> 「該 session 內看不到某個互動 rc 的變數」。要直接觀察需要一個「shell 不可查詢、但該 shell
> 的 rc 又設了哨兵」的 fixture，而本機沒有 fish 可以造。記在這裡而不是假裝它是直接的。

## `desktop-packaging`（MODIFIED，7 條：5 既有 + 2 新增）

### Requirement: 打包產物於桌面環境啟動時仍能解析使用者的 agent CLI

| # | Scenario | 載體 |
|---|---|---|
| 9 | 自桌面環境啟動後可建立 agent session | **無自動化載體，且刻意如此** —— spec 明文「SHALL 以自桌面環境啟動的執行驗收，SHALL NOT 以自終端機啟動的執行替代」。由 tasks 5.4 的 dogfood 承載 |

### Requirement: 主行程代表使用者執行的外部程式亦解析使用者的 PATH

| # | Scenario | 載體 |
|---|---|---|
| 10 | 主行程解析得到只由互動 rc 提供的可執行檔 | **無自動化載體，理由同 #9**（spec 對本條有相同的明文）。由 tasks 5.4 承載 |
| 11 | 使用者的路徑前置而非附加 | `user-env.test.ts`「把使用者的新項目前置，而不是附加在後」等 5 條 `mergeUserPath` 測試；端到端由 `user-env.spawn.test.ts`「PATH 併進來了，而使用者的項目在前」承載 |
| 12 | 主行程環境除 PATH 外不因使用者環境而改變 | **新增** —— `user-env.spawn.test.ts`「套用後 process.env 除 PATH 外沒有被新增任何變數」的 `assert.deepEqual(added, [])` |
| 13 | 值含分隔字元的變數不被截斷 | **新增** —— `user-env.test.ts`「值含換行與引號時完整取回」＋「值含 `@@` 時舊規則會截斷，NUL 規則不會（對照組）」；真 shell 端由 `user-env.spawn.test.ts`「值含換行與引號的變數完整取回」承載 |
| 14 | 無法安全查詢的 shell 一律放棄 | `user-env.test.ts`「拒絕 fish」「拒絕未知的 shell」；行為端由 `user-env-fallback.test.ts` 承載 |
| 15 | 取得失敗不致使功能失效 | `user-env-fallback.test.ts`「不變更環境，且 session 仍建立得起來」 |

## 對照組實測（把修正退回，確認真的變紅）

**「有載體」與「載體有鑑別力」是兩個動作。** 四個對照實驗都實際跑過：

| 退回什麼 | 結果 | 說明 |
|---|---|---|
| `startUserEnvResolution` 的 `-i` 拿掉 | **6 條紅**，`pass 4 / fail 6` | 對照組那條（#3）**仍綠** —— 正確，它驗的就是非互動取不到 |
| `ptyEnv` 不合併 `userEnv` | **2 條紅**，`pass 8 / fail 2` | #1／#2 與 #7 |
| `applyUserEnvOnce` 也 `Object.assign(process.env, rest)` | **1 條紅**，`pass 9 / fail 1` | #12 —— 本 change 最重要的那條 |
| `create()` 裡的 `await whenUserEnvReady()` 拿掉 | **1 條紅** | #5 |

還原後 `pass 13 / fail 0`。

## 一個順帶抓到的假綠

tasks 3.3 要求「找不到 `zsh` 時以可見的 skip 或失敗呈現」。第一版用
`describe(..., { skip })` —— 實測缺少 zsh 時輸出是 **`pass 0 / fail 0 / skipped 0`**，
**整批驗收消失得無影無蹤**，在 CI 摘要上與「全部通過」分不出來。處置是加一條一定會執行的
前置斷言（`describe('前置條件')`），缺席時它是一條**紅的**。
