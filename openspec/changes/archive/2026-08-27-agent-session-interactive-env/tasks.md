## 1. 取值：從 `$PATH` 一個變數擴大為整份環境

- [x] 1.1 `src/main/user-path.ts` 更名為 `src/main/user-env.ts`，`applyUserPathOnce` /
      `whenUserPathReady` / `startUserPathResolution` 一併正名（`mergeUserPath` **維持原名** ——
      它處理的確實只有 PATH，而 `process.env` 的併入範圍也確實只有它，見 design D6）；更新
      `src/main/index.ts` 與 `src/main/openspec-service.ts` 的 import。驗證：`npm run typecheck`
      通過，且 `git grep -n --no-color 'user-path'` 在版控中無殘留（`archive/` 除外 ——
      注意 `docs/lessons/terminal.md` 有一處）
- [x] 1.2 查詢命令改為固定字串常數 `printf '\0__SPEKTERM_ENV__\0'; env -0`（design D3）。
      **`\0` 一律寫成 escape 序列，不得寫入字面 NUL 位元組** —— 那會讓 `git diff` 與 `grep`
      對整個檔案瞎掉（CLAUDE.md「工具鏈與環境的陷阱」）。驗證：
      `python3 -c "print(open('src/main/user-env.ts','rb').read().count(b'\x00'))"` 輸出 0
- [x] 1.3 讀取改為全程 `Buffer`：移除 `setEncoding('utf-8')`，累加為 `Buffer[]` 後 `Buffer.concat`。
      `parseEnvOutput(stdout: Buffer)` **只收 `Buffer`，不開 `string` 的 union** —— union 等於在
      型別上宣告「維持現狀也可以」（design D3）。取最後一個標記之後的內容，以 NUL 切分為
      `KEY=VALUE`；取不到標記或結果為零個變數時回 `null`。驗證：解析測試通過，含一筆**值裡有換行
      與單雙引號**的變數完整取回
- [x] 1.4 `applyUserEnvOnce()` **只把 PATH 併進 `process.env`**（沿用 `mergeUserPath`，行為不變），
      其餘變數存入模組內的持有者，由 `getUserEnv()` 取用 —— **不寫進 `process.env`**（design D2）。
      驗證：新增一條斷言「套用後 `process.env` 中除 `PATH` 外沒有任何變數被新增或改變」，
      並以「把使用者環境也併進 `process.env`」作為對照組確認它會變紅
- [x] 1.5 新增的任何診斷輸出**只准印變數名稱與數量，不准印值**（design Risks —— 一行 dump 就是把
      API key 寫進使用者的終端輸出）。驗證：`git grep -n --no-color 'console\.' src/main/user-env.ts`
      的每一處都不含變數值
- [x] 1.6 更新 `user-env.ts` 檔頭註解：取值範圍是整份環境、**為什麼不寫進 `process.env`**（含
      實測到的那張「危險變數在桌面啟動時並不存在」的表）、NUL 標記為何是結構性保證。
      驗證：`npm run lint` 通過

## 2. 傳遞與時序

- [x] 2.1 `ptyEnv()` 合併使用者環境，順序為 `{ ...process.env, ...userEnv, TERM }`，其後剝除
      `NESTED_CLAUDE_ENV`（design D2 —— 使用者的值優先，我們承重的兩件事蓋回來）。
      驗證：單元測試斷言「使用者環境的變數出現在結果中」且「`TERM` 與剝除清單不受使用者環境影響」，
      後者以「使用者環境中放一個 `TERM` 與一個 `CLAUDECODE`」為輸入
- [x] 2.2 `TerminalService.create()` 改為 async，內部 `await whenUserEnvReady()`（design D4）。
      驗證：`npm run typecheck` 通過；`ipc/terminal.ts` 兩個呼叫點（建立與重建）都讀回傳值，
      改 async 後未 await 會是型別錯誤
- [x] 2.3 更新 `src/main/terminal.ts` 檔頭關於 `ptyEnv` 的註解 —— 現有那句「使用者自己在
      `~/.zshrc` 之類設定的變數**不受影響**，我們 spawn 的是 login shell，它會重新 source 那些
      檔案」對 claude 目標（非互動）**本來就不成立**，而合併之後它更會誤導：rc 若設了
      `NESTED_CLAUDE_ENV` 裡的名字，剝除之後沒有東西還原。驗證：註解與 2.1 的實際行為一致
- [x] 2.4 重新檢視 `src/main/openspec-service.ts` 的「其餘 core 呼叫只 spawn `git`，不需要使用者
      PATH，讓它們也等是白付延遲」那段裁決 —— 取值範圍變了但 `process.env` 的併入範圍沒變，
      該裁決的依據**仍然成立**，確認後把註解裡「PATH」的措辭與新的分界對齊。驗證：註解不宣稱
      任何與 D2 相反的事

## 3. 驗收載體

- [x] 3.1 `src/main/user-path.test.ts` 更名為 `user-env.test.ts`。`parsePathOutput` 及其驗 `@@`
      標記的 6 條測試**被取代**（不是沿用）—— 但**保留一條**改寫為對照組：以舊的 `@@` 規則解析
      同一份輸出，斷言它在含引號的值上截斷。PATH 合併的測試沿用。驗證：`npm test` 通過
- [x] 3.2 新增受控 `HOME` 的真 spawn 測試（design D7）：`.zprofile` 與 `.zshrc` 各放一個哨兵、
      一個值含換行與單雙引號的變數，並由 `.zshrc` 把一個含假可執行檔的目錄加進 `PATH`。斷言：
      (a) `-i -l -c` 取回的環境含 `.zshrc` 的哨兵；(b) **對照組** —— `-l -c` 取回的環境**不**含它。
      驗證：把 (a) 的查詢改回非互動時 (a) 變紅、(b) 仍綠
- [x] 3.3 **找不到 `zsh` 時 SHALL 以可見的 skip 或失敗呈現**，不得靜默通過（design Risks ——
      靜默 skip 就是假綠）。驗證：暫時把查找的 shell 名稱改成一個不存在的值，確認測試輸出裡
      出現該 skip／失敗訊息
- [x] 3.4 新增 pty 端到端測試：受控 `HOME` + 一個由 `.zshrc` 加進 PATH 的假 agent CLI，spawn
      agent 目標的 session，自 pty 輸出確認 **(i)** 只在 `.zshrc` 設定的哨兵在該 session 內可見、
      **(ii)** 那個假可執行檔解析得到（承載「只由互動 rc 提供的可執行檔路徑可被解析」）。
      驗證：對照組為「不合併使用者環境時兩者皆不可見」。
      **node-pty 已實測可在純 Node 22 下載入並 spawn**（N-API 10）；若仍有障礙，改於
      `probe:terminal` 增加一段承載（**不是** `probe:native` —— 那支不碰 `src/main`、
      沒有 `sections.mjs` 框架、且 `scripts/*.mjs` import 不了 TypeScript），並在 3.7 註明載體改變
- [x] 3.5 新增 login shell 目標的斷言：其 pty 環境同樣含 `.zshrc` 的哨兵（承載「不得倒退」條款 ——
      它是最容易靜默腐爛的那種）。驗證：與 3.4 共用受控 `HOME`，對照組同上
- [x] 3.6 新增 `create()` 時序的測試：取得尚未完成時建立 session，確認 pty 於取得完成後才建立；
      取得失敗（resolve `null`）時 session 仍建立得起來。驗證：把 `await` 拿掉時第一條變紅
- [x] 3.7 **逐條**核對 scenario → 載體對照表，共 **15 條**（terminal-sessions 8 條全新；
      desktop-packaging 7 條 —— agent CLI 那條 1 條既有、主行程那條 4 條既有 + 2 條新增）。
      把對應的斷言**實際找出來**寫進表格；找不到的寫「無載體」＋理由，**不得憑印象填「既有」**
      （CLAUDE.md 反覆重演的教訓，第五次的形狀就是「對照表做了，填表的方式錯了」）。
      驗證：表格每一列都指到一個檔名＋斷言文字，或一句明寫的不覆蓋理由

## 4. 文件與追蹤

- [x] 4.1 更新 `CLAUDE.md`：補上「使用者環境於啟動時一次性取得，**只有 PATH 進 `process.env`**，
      其餘只進 pty」這條分界，以及**改了 `.zshrc` 要重開 app** 的快照語意。驗證：新增內容通過
      本文件自己的兩條判準（不知道會不會靜默做錯事、是不是隨時會踩到）
- [x] 4.2 `docs/lessons/terminal.md` 補上四條實測，失效方式都是靜默的：`-i -l -c` 在真 pty 下
      **無噪音**（既有註解記載的 gitstatus 錯誤只出現在非 tty）、互動 shell 啟動 **2.33s vs
      非互動 0.04s**、`bash -i -l -c` 走 login 路徑**不直接讀 `.bashrc`**、
      **驗證 `printf '\0'` 時不可經 `$(...)`**（command substitution 會剝掉 NUL，會量到相反的
      結論）。驗證：每條都附上可重現的量測方式
- [x] 4.3 關閉 issue #20（原票描述的情境已處置），**並開一張後繼票**承接未關閉的那一半：
      非白名單 shell（fish 之屬）與 Windows 下涵蓋範圍仍退回 login rc。驗證：後繼票的編號寫進
      `terminal-sessions` 的涵蓋範圍條款或 `docs/lessons/terminal.md` —— 「已知的缺口」與
      「被追蹤的缺口」是兩件事

## 5. 收尾

- [x] 5.1 `npm run typecheck` 與 `npm run lint` 通過
- [x] 5.2 `npm test` 通過（含 3.1–3.6 的新測試與既有守衛）
- [x] 5.3 `npm run test:e2e` 九支探針完整執行，總結顯示每支皆**完整執行**（不完整的那一輪不得
      拿來判定通過）。**特別確認 `probe:terminal` / `probe:keyboard` 的第一次 create 沒有被
      2.2 的對齊延遲吃掉既有的等待窗口** —— 那些窗口是在沒有這筆延遲的前提下訂的
- [x] 5.4 dogfood 驗一次真實情境：以桌面環境啟動的產物開一個 agent session，確認 Redmine MCP
      起得來（`TRACKER_URL` 與 API key 都在）—— 那正是本 change 的原始症狀。
      同時確認 `~/.config/Spekterm` 仍是 userData 的落點（D2 的分界真的守住了）
