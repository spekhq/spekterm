# 終端與 pty

`node-pty` 的 spawn 與生命週期、`claude` CLI 的實測結論、session 重建、標題權、剪貼簿與滑鼠、渲染、字元寬度、字型偏好。

> 這份文件是 `CLAUDE.md` 的延伸。**它與 CLAUDE.md 同一個定位：**
> 幾乎每一條都是「不知道就會踩、而且失敗是靜默的」的實測結論。
> 觸發條件（什麼時候該讀它）寫在 CLAUDE.md 的「踩雷指南」。

## spawn 與生命週期

- **`node-pty` 的 spawn 對 execvp 失敗「不會」同步拋錯。** 實測 `spawn('/nonexistent')` → 不 throw、
  pty 以 exit code 1 結束、`execvp(3) failed.` 由 `onData` 送出。於是「shell 路徑無效」與「claude
  找不到」殊途同歸，都經 `onExit` + 終端上的錯誤訊息呈現，**不是** `create` 回一個錯誤碼。
- **GUI app 常缺使用者 shell 的 PATH**（從桌面啟動不會繼承 `.zprofile`），直接 `spawn('claude')`
  會 ENOENT。兩種目標因此都經 login shell：`$SHELL -l` / `$SHELL -l -c claude`。
  **這道緩解的真正驗證點在 Phase 6 打包後從桌面啟動** —— `npm run dev` 是從終端起的，測不出來。
  - **但那兩者的涵蓋範圍不同，而差別是承重的（實測）。** `$SHELL -l` 掛在 pty 上是**互動** login
    shell，會 source `.zshrc` / `.bashrc`；`$SHELL -l -c <命令>` 是 login 但**非互動**，不會。
    而 **nvm 之屬正是在互動 rc 初始化的**：

    ```
    $ zsh -l -c 'command -v openspec; command -v node'
    /usr/bin/node          ← 系統的 v10.19.0，openspec 完全沒有輸出
    ```
    ```python
    pid, fd = pty.fork(); os.execv('/bin/zsh', ['/bin/zsh', '-l'])   # 真 pty 下的 shell 目標
    → /home/me/.nvm/versions/node/v22.22.0/bin/openspec
    ```

    所以 **shell 目標沒問題，缺口只在 claude 目標**：`claude` 目前找得到純粹因為它裝在
    `~/.local/bin`（由 login rc 提供）。改用 `npm i -g` 裝到 nvm 底下就會踩到（issue #20）。
- **主行程自己 spawn 的東西不受上面那道緩解保護** —— 那個機制作用於 pty。core 用來取得 schema
  權威順序的 `openspec` 因此在打包產物裡一律 ENOENT，解法是 `src/main/user-path.ts`（啟動時以
  **互動** shell 取一次 PATH）。兩個實測結論：
  - **必須前置（prepend），不能附加。** `openspec` 的 shebang 是 `#!/usr/bin/env node` —— 附加在後
    時它被解析到、卻用系統 node 執行而 `SyntaxError`，而 CLI 非零結束在 core 的 provider 眼中
    **與「未安裝」完全無法區分**。
  - **必須挑 shell，不能一律查詢。** `fish` 的 `$PATH` 是 list，`printf '@@%s@@' "$PATH"` 會印成
    `@@/a@@@@/b@@…`，解析得到的是第一個目錄 —— **沒有錯誤，只是 PATH 少掉大半**。因此是白名單
    （`sh`/`bash`/`zsh`/`ksh`），未知者放棄：沒修好的代價遠小於悄悄弄壞。
  - **它會改變 pty 的環境** —— `ptyEnv` 整份繼承 `process.env`。那是刻意的（agent session 從此也
    解析得到 nvm 底下的東西），但因此**套用只能發生在一個確定的時點**，不能放在某個功能的使用點：
    否則「其他行程有沒有拿到修好的 PATH」會取決於使用者有沒有先用過那個功能。
- **輸出的訂閱必須早於 `create`。** pty 在 `create` 回傳的那一刻就開始吐第一個 prompt，而
  `TerminalView` 要等 React 渲染完才 attach —— 中間沒有接收者的輸出會**直接消失**。
  `SessionsProvider` 因此在任何一次 create 之前就掛好唯一的 `onData`，尚未 attach 的先進 backlog。
  （與 Phase 2 的「**先訂閱、再列目錄**」同源：那個窗口裡的變更會兩頭落空。）
- **終端必須跨「切換 folder」常駐。** 只掛載當前 folder 的 session 的話，切走再切回時 xterm 實例已
  被卸載，先前的 scrollback 就沒了。因此掛載全部、以 `display:none` 決定顯示 —— 代價是隱藏時
  `FitAddon` 量到 0，由隱藏轉為顯示時必須重新 `fit()`。
- **`disposed` 的 exit 不是 session 結束。** 關視窗與 reload 時我們自己殺光所有 pty，那些都會觸發
  `onExit`。「已結束的 session 不持久化」若直接寫成「收到 exit 就移除」——**關一次視窗，
  `sessions.json` 就被清空了**。`ExitReason` 因此區分 `self`／`killed`（真的結束）與 `disposed`
  （我們收工時殺的：持久化原封不動，**且那個 exit 也不可推給 renderer** —— reload 後的新頁面已用
  同樣的 id 重建，一則遲到的 exit 會把剛重建好的分頁標成已結束）。
- **一個 claude session 是兩個 `/bin/sh` 行程**（`$SHELL -l -c "claude …"` 的那層 shell 不會 exec，
  實測）。**拿行程數去斷言「只喚醒了一個 session」，會把好的實作判成壞的** —— 以 `-l` 認出領頭
  行程，數量才等於 session 數。

## pty 的環境必須抹掉「巢狀 Claude Code」的標記 —— 否則續接功能**靜默失效**

spekterm 若由一個 agent 啟動（dogfooding 時的常態），Electron 會繼承那個 Claude Code session 的
環境變數，pty 再整份繼承下去。於是裡面每一個 `claude` 都認為自己是**巢狀的子 session**，而**巢狀的
claude 不寫 transcript**（實測：對話真的發生了，但 `~/.claude/projects/` 底下什麼都沒有）。
後果：`--resume` 必然失敗 → 自癒接手 → 使用者拿到一個**能用的** claude，只是對話永遠是全新的。
**沒有錯誤訊息、沒有紅燈，連探針也抓不到**（探針用的是 stub claude，它不管 env）。

- **元兇是單一一個變數**（二分實測）：**`CLAUDE_CODE_CHILD_SESSION`**。單獨拿掉 `CLAUDECODE` 或
  `CLAUDE_CODE_ENTRYPOINT` 都無效。
- **絕不以 `CLAUDE*` 前綴一概剝除** —— `CLAUDE_CODE_OAUTH_TOKEN` 是認證用的。`ptyEnv()` 的名單明確
  列舉，且不含任何帶 KEY／TOKEN 的名字。
- login shell 讓副作用很小（使用者自己在 rc 裡設的會被 source 回來）。**兩種 spawn 目標都適用**。

## `claude` CLI 的實測結論（全部左右了設計）

- **`--session-id <uuid>` 可由我們指定對話 id**；`--resume <uuid>` **沿用**原 id（`--fork-session`
  才換）。於是 id 可被持久化並直接續接，**不必去猜哪個 `.jsonl` 是我們的**。
- **`--session-id <已存在的 id>` 會直接報 `already in use`** —— 於是 `claude --resume X ||
  claude --session-id X` 這種自癒寫法是個陷阱（claude 因其他原因非零退出時 `||` 會撞號）。
- **開了 session、還沒跟它講話就關掉 app → claude 根本不寫 transcript**，重建時 `--resume` **必定
  失敗**。**這不是邊角，是主線情境**（開個分頁準備等一下用）。
- **`--resume` 在互動模式下會自己把過去的對話重畫在終端上** —— 因此 **claude session 絕不重播我們
  存的畫面快照**（會看到兩份歷史），**只有 shell 存快照**（順帶省下絕大部分快照 IO）。
- **`--resume` 的查找是 git repo 關聯的**（實測：主工作目錄 ↔ worktree 互通，無關的非 git 目錄
  查不到）。於是「worktree 消失 → 退回 folder 根」這條退路是安全的，對話不會丟。
  > 限制：這是 claude 的**內部行為**，可能隨版本改變。但**降級方向安全**（猜錯的下場是自癒成新
  > 對話，不是撞號讓 session 死掉）。
- **`claude` 一啟動就宣告任務式的 OSC 標題**（`✳ Claude Code`），**即使你一個字都還沒講**。
  所以**分頁標題不是「有對話」的證據**。

## session 的重建

- **spekterm 的 session id 與 claude 的對話 id 必須解耦。** 續接失敗時必須以**全新的** uuid 開新
  對話（沿用舊的會撞號），若兩者是同一個欄位，換號就等於換掉 session 的身分（分頁 key、focus、
  順序、錨定全要跟著搬）。因此持久化有兩個識別碼：`id`（**永不改變**）與 `claudeSessionId`（可換）。
- **續接策略：一律 `--resume`，pty 若在 3 秒內以非零碼結束就判定失敗，以全新 uuid 重試一次**
  （至多一次）。**判準只看「時間 + 結束碼」，不解析 claude 的輸出** —— 這條路徑零 layout 依賴。
- **`#heal()` 是主線情境，而它對 renderer 完全不可見**（`status` 一直是 `running`）。因此凡是
  「pty 誕生時要做的事」，自癒那條路上都要自己再做一次：**推尺寸**（否則新 pty 一輩子停在 80×24）、
  **沿用 session 記住的 cwd**（否則開在 worktree 的 session 會靜默站到別的地方）。
  這兩件事**都是漏掉後才補的**，位置相同、疏漏同型。
- **喚醒把「pty 先誕生、終端後掛載」的順序倒了過來。** `fit()` 在「尺寸沒變」時回 `null`。喚醒
  休眠 session 時：終端先顯示 → `fit()` 成功量到尺寸 → 送 resize → **pty 還不存在，被丟掉**；而
  `lastCols` 已記成那個尺寸 → 之後再 `fit()` 一律回 `null` → **再也沒有人告訴 pty 真正的尺寸**。
  修法：pty 誕生的那一刻（`status` 轉 `running`）把終端當下的尺寸告訴它（`XtermHandle.size()`，
  它不做「有沒有變」的偵測 —— `fit()` 回答不了這個問題）。**新建的 session 不會踩到。**
- **`\x1b[?1049l` 只能條件式地送。** `SerializeAddon` 會把終端模式一起序列化（使用者關 app 時正開
  著 vim，快照裡就真的有 `?1049h`），所以重播完可能就站在 alternate buffer 裡。但兩個直覺修法都
  錯：寫在歷史**之前**對 alt screen 毫無作用；**無條件**寫在歷史之後會毀掉正常情況 —— `?1049l` 會
  **還原「進入 alt screen 當下所儲存的游標」**，沒進去過時那是 **(0,0)**，游標被拉回左上角，分隔線
  蓋掉歷史第二行。**正解**：只有 `term.buffer.active.type === 'alternate'` 時才送。不動游標的重置
  （滑鼠追蹤、SGR）則無條件送。
- **重播完要自己把游標挪到內容之後**（只用相對移動的 `\n` —— 絕對定位在一個尺寸不同的終端上會落在
  錯的地方），再寫分隔線，**然後才接上 live 串流**。
- **快照的取用不可以是「讀完即刪」** —— StrictMode 把掛載 effect 跑兩次，第一次就把快照取走了，
  第二次（真正存活的那個 xterm）拿到 `undefined`，畫面一片空白。改為非破壞性讀取，`close()` 才清。
- **休眠的提示會被 xterm 蓋住。** `.xterm` 是 `position: relative` 且由 `handle.open(host)` 在
  effect 裡 append —— 排在 React children **之後**，兩者都 `z-index: auto` → 依 tree order 繪製。
  修法是 host 給 `relative`、提示給 `z-10`。而**「這個 session 恢復不了」的提示不該是
  `pointer-events-none`** —— 它背後是一個永遠不會活過來的終端，沒有東西值得點。

## 標題與命名權

三層優先序：**使用者取的名字 > pty 宣告的 OSC 標題（僅 `claude` 目標）> 本地流水號**。

- **使用者一旦命名就是永久接管** —— pty 其後宣告的標題一律**靜默地不予呈現**（不覆蓋、不確認、
  不提示）。交還的唯一路徑：**把名字清空**。
  > 這裡原本有一個「pty 想改名，要採用嗎？」的確認對話框，已移除 —— **它的前提是錯的**。它假定
  > 「pty 想改名是罕見事件，值得問一次」，但 `claude` 隨任務進展**持續**改標題。而「保留我的名字」
  > 只清掉待裁決欄位、**不記錄使用者已經拒絕過**，於是下一次判定條件完全相同，對話框再跳一次。
  > 當初的 spec **已經察覺** agent 會頻繁改名（才有「待確認的標題是單一欄位而非佇列」），但緩解只
  > 做到「不要一次問太多次」，沒處理「**沿著時間軸反覆問同一個問題**」。
  > **教訓：一個高頻事件上的確認，要問的是「這個問題值得問嗎」。** 而它的答案是可預測的 ——
  > **「使用者取的名字 > pty 的標題」這條優先序本身就已經是那個裁決。**
- **接管期間 pty 的標題仍持續被記錄，只是不呈現** —— 這是「清空即交還」得以即時的前提。若直接
  丟棄，清空後會退回 `claude 1`，空等到 pty 下次宣告為止（可能永遠不會來）。
- **login shell 不採用 OSC 標題。** shell 送的是 `使用者@主機:/路徑`，對使用者零識別意義；而且它
  **比 session 晚一秒多才到**（要先載完 rc、畫出第一個 prompt），抵達時分頁從約 60px 暴增到約
  210px，把緊鄰其後的「+」入口**往右推 150px**。**分頁不限寬** —— 根因是標籤內容突變。
  - **擋在 `sessions.tsx` 的 `setTitle()`，不是顯示層** —— 那是 OSC 標題進入狀態的唯一入口。
    只改顯示層的話，標籤是對了，但衍生的行為（當年的確認對話框）仍會被觸發。

## 複製、貼上、滑鼠

- **不能靠瀏覽器原生的路徑。** xterm 的選取**不是 DOM selection**（它自己畫），原生的
  「Ctrl+C 複製選取文字」對它完全無效。複製走 `term.getSelection()` + 主行程 clipboard；貼上走
  `clipboard.readText()` + `term.paste()`。**不用 `navigator.clipboard`** —— 它的 `readText()` 在
  Electron 中受 `clipboard-read` 權限模型擺布，跨平台不一致。
- **選單操作完要把焦點還給終端。** 實測：自右鍵選單貼上之後按 Enter **不會執行**（焦點還在選單）。
- **右鍵 gate 在 mouse reporting**（`term.modes.mouseTrackingMode`）—— 程式接管滑鼠時右鍵**讓位給
  它**（使 claude 的右鍵貼上生效），沒接管時才開我們的複製／貼上選單。
- **中鍵雙貼的兇手是 Chromium 原生的中鍵貼上。** `terminal-clipboard` D5 當年寫「X11 的中鍵貼的是
  PRIMARY，而瀏覽器拿不到它」—— **那個假設在 Electron 裡不成立**。React 的 `onMouseDown`（bubble）
  擋不掉它：其一 bubble 晚於 xterm 掛在 `.xterm-screen` 上的 listener；其二**原生貼上掛在
  `auxclick` 而非 mousedown**。**正解**：host 上的 **capture 階段**原生 listener，對 button 1 的
  `mousedown`／`mouseup`／`auxclick` **一律 `preventDefault`** + `stopPropagation`，並在 mousedown
  做**唯一一次**貼上。
- **終端裡的連結歸誰管**：login shell 中純文字 URL 與 OSC 8 兩套都正常。差別只在 **claude 開了
  mouse reporting** —— xterm 此時把左鍵**轉發給程式**並 `cancel()` 掉自己的處理，而**修飾鍵是一起
  編碼進去的**，於是 `Ctrl+click` 是 **claude 自己**去開那個連結的。`Shift+左鍵`反而沒反應，因為它
  被 xterm 攔去做「強制選取」—— **Shift 從來就不是「連結的繞道」**。
  - **推論：「點檔案路徑開在側欄」在 claude session 裡做不到。** 唯一的攔法是在 capture 階段搶下
    **左鍵**，但左鍵是 claude 整個 UI 的主要互動面，代價與當初搶右鍵不是同一個量級。
    **真正的解是讓 spekterm 被 claude 認成 IDE**（它在 VS Code／JetBrains 裡就是這樣開檔的）——
    那要獨立論證，尚未進行。
- **OSC 8 超連結走 `Terminal.linkHandler`**（與 WebLinksAddon 的純文字連結是**兩套**）。未設它會
  落入 xterm 內建預設：`confirm()`（文字由不受信任的 pty 輸出控制）+ `window.open()`。
  兩套都要匯到 `openExternal`。

## 渲染

- **webgl 是唯一可用的 GPU renderer。** `@xterm/addon-canvas` 對 xterm 6 已死（latest 0.7.0，
  **唯一仍宣告 peer `^5.0.0` 的 addon**，2023-11 後未再發佈）。
- **並存的 webgl context 上限實測恰為 16，超出時最舊的靜默被丟棄、`webglcontextlost` 一次都不觸發。**
  於是「只給當下顯示的那一個終端」是**正確性要求而非優化** —— `onContextLoss` 的自癒救不了它
  （那條倚賴一個通知，而這裡根本沒有通知）。
- **`WebglAddon.dispose()` 不歸還那個額度** —— 該套件全檔沒有 `loseContext`（xterm 6 實測），
  它只移除 DOM 產物，context 等 GC，而上限的檢查是**即時**的。於是「已釋放」的 context 仍佔位置，
  直到把使用中的那一個擠掉。**解除掛載 ≠ 歸還額度**，而兩者的差別在 DOM 上看不出來 ——
  依產物判定的斷言在額度未歸還時**依然全綠**（`terminal-sessions` 為此把「釋放」明確定義成歸還額度）。
  修法是自己呼叫 `WEBGL_lose_context.loseContext()`。
  - **參照要在建立 addon 的當下就抓（`loadAddon` 前後取差集），不是釋放時才去找。**
    所有終端**同時掛載**，因此 `document.querySelector` 會回傳**另一個正在顯示**的終端的 canvas
    —— 釋放它＝使用者當場看到空白，正是這條規格要防的結果本身。終端銷毀那條路更確定：
    React 的 cleanup 跑在節點移除之後，查詢**只可能**命中別人的。**查詢根必須是 `term.element`。**
  - **用差集而非選擇器排除法。** `:not(.xterm-link-layer)` 是黑名單：`.xterm-screen` 下日後多一顆
    沒有 context 的 canvas，查詢它的 webgl context **會當場建立一個新的**（多吃一個額度，方向相反）。
    差集只看「這次新增了什麼」，兩種誤選在結構上都不可能。
  - **順序是 `dispose()` → `loseContext()`。** dispose 會解除 addon 的 DOM listener，因此不會觸發
    它的 handler。反過來會踩到：`webglcontextlost` 的 handler 排一個 **3000ms** 的 timer，而那個
    timer **只有 `webglcontextrestored` 會清、`dispose()` 不清** —— 三秒後仍會印訊息（污染
    #19／#21 賴以判讀的 console 緩衝），且若使用者在那三秒內切回來，它會把剛建好的新 addon 蓋成 `null`。
  - **「dispose 之後那個終端底下一個 canvas 都不剩」是狀態相依的觀察，不是不變式。** 確定被移除的
    只有主 canvas 與 link layer；`_tmpCanvas` 是否還在取決於誰最後光柵化過新 glyph（它跨終端共用
    且會遷移）。**不可據此放寬任何選擇。**
  - **驗收的判準是「該 context 自身是否已失效」，不是「額度滿了誰先被回收」。** 後者的回收順序
    （最早取得者優先）會讓「有歸還」與「沒歸還」在多數佈局下結果**完全相同** —— 追這個缺陷時
    兩度得到那種無差別的結果，差點據此推翻一個正確的結論。而**驗收持有參照這件事是承重的**：
    它讓觀察不受 GC 影響（未歸還的實作之所以多半沒出事，正是因為 GC 碰巧來得及）。
  - **「釋放的是它自己的資源」不能用「切換」驗**（實測）：切換後 React 會為新顯示的終端重建脈絡，
    誤傷了也看不出來 —— 那樣的斷言在以 `document` 為範圍的錯誤實作下**照樣是綠的**。
    載體是**關閉另一個 session**：顯示中的那個自始至終沒換過，沒有重建會掩蓋它。
- **關掉它的開關是必要的**：自動降級只擋得住「資源取不到」，擋不住「取得了但驅動畫錯」，那只有
  使用者看得出來。
- **行高預設 1.0，理由是「因為降級路徑存在」。** DOM renderer 下框線字元是**靠字型自己的 glyph 去
  拼**的，glyph 只有約 1em 高而 row 是 `fontSize × lineHeight` —— **行高大於 1 時上下兩列的 `│`
  接不起來**。實測（同一張表格）：DOM + 行高 1.3 是 7 段 / 30px 空洞，DOM + 行高 1.0 與 webgl 都是
  1 段 / 0 空洞。**webgl 在垂直方向的貢獻是「讓行高自由」，不是「修好縫」** —— 但 DOM 是真實可達
  的降級路徑（context 取不到、驅動有問題、使用者自己關掉），預設 1.3 的話落到 DOM 的使用者開箱就
  是破的表格，而他們正是最沒能力自救的一群。
- **webgl 真正修掉的是水平方向的分數像素。** 出貨預設下 DOM 的 `cellW = 9.63`（垂直線佔的 x 數
  `[1,2,2,1]`），webgl 是 `9`（`[1,1,1,1]`）。峰值亮度相同 —— **不是變暗，是被抹開**：外框線恰好
  落在整數像素而銳利，內部的線被反鋸齒攤到兩個像素。**同一張表格裡有的線是一條、有的是兩條淡的。**
- **`customGlyphs` 是官方機制**（xterm 6 的公開選項，預設 true），程式化繪製 block element 與
  box drawing，且**對 DOM renderer 無效**。
- **「捲動時破版」始終沒有被合成重現，是由 dogfood 認定修好的。** 合成 fixture 量到的是 fixture 的
  結構而非渲染缺陷。**紀律要留著**：下次遇到「只有真實環境才觸發的呈現問題」，能驗的就驗，驗不到
  的標示清楚交給 dogfood，不要用一個合成的綠燈假裝它被證明了。

## 字元寬度（判定單位是 grapheme cluster）

xterm 內建的寬度表是 **Unicode 6**，而 agent 依現代 wcwidth 排版 —— 每個 emoji 都讓那一行少一格。
這條缺陷與「一個 cell 內怎麼畫」（行高、GPU）**相鄰但不同層**。修法是載入
`@xterm/addon-unicode-graphemes` 並開啟 `allowProposedApi`。

| | claude 排版 | 內建 v6 | `addon-unicode11` | `addon-unicode-graphemes` |
|---|---|---|---|---|
| `✅` U+2705 | 2 | 1 ✗ | 2 ✓ | 2 ✓ |
| 星形平面 CJK 擴充 | 2 | 2 ✓ | 2 ✓ | 2 ✓ |
| `⚠️` U+26A0+FE0F | 2 | 1 ✗ | **1 ✗** | 2 ✓ |
| ZWJ 序列 | 2 | 3 ✗ | **6 ✗** | 2 ✓ |
| 膚色修飾 | 2 | 2 ✓（碰巧） | **4 ✗** | 2 ✓ |

**多個 code point 合起來算一個字，而查表式的實作沒有地方可以表達這件事** —— 於是「先用比較小的
`unicode11`，之後再換」不是可行的退路。

- **`allowProposedApi` 是硬性前提**：未開時 `loadAddon()` **當場**拋錯，沒有「載入了但沒生效」的
  中間狀態。而「版本字串在不在清單裡」是「寬度對不對」的**代理判準** —— 真正會靜默失敗的是
  「載入成功、版本對、寬度表卻答錯」，那只有「代表性字元集逐類別正確」的驗收擋得住。
- **不新增設定開關** —— 字元寬度是確定性的，沒有 GPU 那種「取得了但驅動畫錯」的失效模式。
- **效能**：同一實例重建、n=9 取中位數 —— 含 emoji **+4.6%**（4000 行多約 1.5ms），純 ASCII 在
  雜訊內。**初次量測 n=1 且跑出 −37%，唯一誠實的結論是「不具資訊量」，不是「沒有退步」。**

## 字型偏好

- **預設不該是一個「不存在的字型」。** 原本首選 `'JetBrains Mono'` —— 這台機器沒裝、專案也沒打包，
  於是靜默落到系統預設等寬字。字型從此與宣告不符，而且**畫面上看不出來**。預設收斂為誠實的
  `ui-monospace, monospace`；與使用者終端一致由**偏好**達成，不是靠猜一個字型名。
- **列舉系統等寬字用 `fc-list :spacing=100 family`**（`:spacing=100` 正是 fontconfig 的 monospace
  判準）。這是使用者開設定的一次性動作，spawn 一次 `fc-list` 可接受 —— 與「分支偵測不 spawn git」
  的熱路徑紀律不同。目前只支援 Linux。
- **UI 是純 `<select>`，不是可打字的 combobox** —— dogfood 兩次否決（free-text 難用、datalist
  combobox 要先清空才能換）。
- **preview 要含 box-drawing**：DOM renderer 下 preview 的框線就是終端的框線。（若只跑 GPU
  renderer，這條就反了，得重新想。）
- **掛載時「什麼都沒變」不該 resize。** 字型 effect 一開始無條件 `fit()` + `resize()`，於是每個終端
  掛載時都對 pty 多送一次 **SIGWINCH**，shell 收到它會**重畫 prompt，把既有輸出往上推**。
  `setFont` 要回報「有沒有真的改動 xterm 的選項」，沒改動就不打擾 pty。
