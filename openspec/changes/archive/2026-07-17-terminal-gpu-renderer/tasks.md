## 0. 排序的理由（先讀這個，順序是承重的）

**觀測點的改寫要在 webgl 之前完成，並在 DOM renderer 上驗到全綠。** 這樣「改寫弄壞了什麼」與「webgl
弄壞了什麼」才分得開 —— 改寫完仍全綠 ⇒ 改寫是無害的；接上 webgl 後**仍然**全綠 ⇒ 新的觀測管道真的是
renderer-agnostic。反過來做（先上 webgl 再修 probe）的話，任何一條紅燈都有兩個嫌疑犯。

**而哨兵要在最前面**（design D7）：`TERMINAL_TEXT` 現在讀不到會回空字串，於是三條否定式斷言是**假綠**。
不先讓失效變成大聲的紅，後面每一步都在假綠上前進。

## 1. 哨兵：讓失效變成紅燈（**最先做，與 webgl 無關，獨立成立**）

- [x] 1.1 `probe-terminal.mjs` 的 `TERMINAL_TEXT`：找不到終端內容的來源時**丟錯**，不回 `''`
- [x] 1.2 `probe-keyboard.mjs` 的 `TERMINAL_TEXT`（**逐字相同的獨立複本**，兩處都要改）同上
- [x] 1.3 `TERMINAL_FONT` 同上（它目前回 `null`，會讓 4 條字級斷言讀成 `undefined`）
- [x] 1.4 跑 `probe:terminal` 與 `probe:keyboard`，確認**現在**仍全綠（哨兵在 DOM renderer 下不該打到任何東西）
      —— **176/176、118/118，與 baseline 一致**
- [x] 1.5 **記下 baseline 數字**（`probe:terminal` 176、`probe:keyboard` 118 為改動前的值）—— 後續每一步都要對照它
- [x] 1.6 **（實作時發現，不在原清單）`scripts/lib/cdp.mjs` 的 `evaluate` 吃掉了例外訊息** ——
      它丟的是 `exceptionDetails.text`，而那**幾乎恆為 `"Uncaught"`**；真正的訊息在
      `exception.description`。**沒有這個修正，哨兵丟出的說明到了輸出上只剩「Uncaught」三個字**，
      等於白做。已改為優先取 `description`
- [x] 1.7 **（實作時發現）哨兵的對照組** —— 把選擇器暫時改成 `.xterm-rows-GONE` 重跑 `probe:keyboard`：
      exit=1 且完整印出「這條觀測管道已失效，不可當成『畫面上沒有東西』」。**證明哨兵有鑑別力，且 1.6
      的修正確實生效**。（已還原）
- [x] 1.8 **（實作時盤點）確認 `.catch(() => '')` 不會把哨兵吞回去** —— `pollUntil` 逾時是回 `last`
      **不丟**，故那些 `.catch` 唯一抓得到的就是 evaluate 的例外。盤點結果：四處 `.catch(() => '')`
      （`COLS=`／`HCOLS=`／`CRASH_64`／`ALT_OK_81`）**全是肯定式斷言**，哨兵丟錯後它們變 `''` → **誠實變紅**；
      真正的假綠（`493`／`658`／`1927`）**沒有 `.catch`**，哨兵會直接往外丟。故這些 `.catch` 不動
      （動了反而可能引入 flaky）

## 2. A 類 14 條：借畫面 → 改讀檔（**判準嚴格更強**）

`echo X > file` → 讀檔。它能**區分回顯與執行**，而讀畫面文字本來就分不清（CLAUDE.md 既有的教訓）。

> **動手前先以 node-pty 實測過（結論全部確認，不必再踩）：**
>
> - **`probe-terminal` 的 8 條全是「命令執行」→ 讀檔直接可行**：`echo OUT_$((6*7)) > a` → `"OUT_42"`、
>   `pwd > b` → 路徑、`stty size > c` → `"24 80"`、`printf '\033]0;…\007' | cat -v > d` →
>   `"^[]0;shell-osc-title^G"`。命令會結束 ⇒ 會 flush，**無緩衝問題**。
> - **`probe-keyboard` 的 6 條要補一個 `Enter`**。按鍵卡在 tty 的 **canonical-mode 行緩衝**裡，**沒有
>   換行就沒有任何行程讀得到它**（`cat -v > f` 與 `stdbuf -o0 cat -v > f` 實測**都**拿不到）。按完待測
>   的鍵之後補送 `Enter` 沖掉行緩衝，就落檔了：實測 `cat -v > f` + `Ctrl+↑` + `Tab` + `Enter`
>   → 檔案 = `"^[[1;5A\t\n"`。
> - **`cat -v` 在 `probe-keyboard` 裡是多餘的**（對照組：**完全不跑 `cat -v`，畫面照樣出現 `^[[A`**）
>   —— 那串 caret 記法是 **tty 自己的 echo**（canonical mode 的 `echoctl`），不是 `cat` 的輸出。改讀檔後
>   `cat` 才第一次真的承重（它得把位元組寫進檔案）。

- [x] 2.1 `probe-terminal.mjs`：新增讀檔用的 helper（寫入 fixture 目錄、輪詢檔案出現、回傳內容）
- [x] 2.2 改寫 `862`（OUT_42 送達 pty 並執行）、`876`（cwd 為 folder 根目錄）、`936`（自選單貼上並執行）
- [x] 2.3 改寫 `1067`（OSC 序列抵達 pty）、`1106`/`1120`（`readCols()` → 終端變窄後 pty 收到更小欄數）
- [x] 2.4 改寫 `2017`（重生於最後 cwd）、`2042`（喚醒的 pty 取得真實尺寸）、`2206`（自癒的 pty 取得真實尺寸）
- [x] 2.5 `probe-keyboard.mjs` 的 6 條（`473`、`493`、`642`、`658`、`929`、`1211`）改為讀檔判定按鍵是否進 pty
      —— **載體改為 `cat -A > file`，且每組按鍵後補送 `Enter`**（見上方實測）
- [x] 2.6 **`493` 與 `658` 補上哨兵語意**（它們目前是 `leaked.length === 0`，**沒有** `1211` 那條 `&& ptyText !== ''`）
- [x] 2.7 **修一條實測發現的、從未生效過的斷言：`493` 的 `^I` 檢查是空轉的。**
      `leaked = ['^[[1;5A', '^[[1;5B', '^I'].filter(…)` —— 但 **`cat -v` 不 escape Tab**（`-v` 只管
      nonprinting；Tab 要 `-T`）。實測送 `\x09`（`Ctrl+Tab` 未被攔截時會送出的位元組）到 pty，
      畫面上是**字面的 tab**，`^I` **永不出現** ⇒ **`Ctrl+Tab` 若外洩進 pty，這支探針抓不到**。
      這比 design 已知的更糟：design 只說它會在「讀不到終端」時假綠，實際上它**在任何情況下都沒作用**，
      而 `Ctrl+Tab` 正是 `keyboard-navigation` 的頭號快捷鍵。**修法：`cat -v` → `cat -A`（＝ `-vET`）。**
- [x] 2.8 **對照組（做法與原訂不同，見下）**：原訂「暫時移除 `Ctrl+Tab` 的攔截，看 `493` 變紅」——
      **實測證明那個對照組設計得不好**：拆掉攔截會讓它前面那批導航斷言全部變紅，狀態機被打亂，
      連 `cat -A` 那行都沒跑成，於是 `493` 是因「檔案 0 字元」（哨兵）而紅，**不是**因為抓到 `^I`。
      改為**針對性**對照組，直接驗證這個修正的宣稱本身（以 node-pty 送 `\x09` 到 pty）：
      **`cat -v` → 檔案 `"\t\n"`（抓不到）；`cat -A` → 檔案 `"^I$\n"`（抓得到）**。
      這乾淨得多 —— 它不需要破壞 app 的導航，就證明了「舊版不可能命中、新版可以」。
- [x] 2.10 **（實作時發現）`Ctrl+T` 那條要先把焦點還給終端，Enter 才送得進 pty。**
      選單以 Escape 關掉後焦點不在終端上（CLAUDE.md 既有的教訓：「自右鍵選單貼上之後按 Enter
      不會執行」）—— 少了 `realClick(termForT)`，那顆沖行緩衝的 Enter 會落空。**這是哨兵抓到的**
      （斷言以「新增的內容=""」變紅，而不是靜默通過）
- [x] 2.9 跑兩支 probe：仍在 DOM renderer 上，數字**不得低於** 1.5 的 baseline

## 3. B 類 4 條（字級）：computed fontSize → cell 幾何

**不可改讀 `.xterm` 容器的 fontSize —— 實測那是假綠**（恆為 `16px` 的瀏覽器預設，不跟 `options.fontSize`
走；它剛好等於當時的正確值，於是第一眼「可行」。見 design D6）。

> **機制與原訂不同（design D6 已回頭改寫）。** 原訂「`.xterm-screen` 的 rect ÷ `cols`」**行不通** ——
> `cols` 只存在於 xterm 實例上，probe 碰不到（暴露它就是測試鉤子）。DOM 上的候選訊號**全部實測為死路**：
> `.xterm-char-measure-element` 在 GPU renderer 下不存在；`.xterm-helper-textarea` 的 computed `fontSize`
> **恆為 `13.3333px`**、其 rect **卡在初始值**（`9.625×19`，字級改了它不動）—— 與 `.xterm` 的 `16px` 同型的假綠。
> **正解：不算 `cellW`，直接讀 pty 的 `cols`**（`stty size` → 檔案，第 2 節的管道）。

- [x] 3.1 新增 `readFontCols` helper：**focus 終端 → `Ctrl+C` 清輸入行 → `stty size` → 讀檔**
      （前兩步是實測補上的：設定對話框送出後焦點不在終端，`typeLine` 會落空、cols 讀成 0）
- [x] 3.2 改寫 `773`（`cols(pref=14) ≠ cols(無 pref)`）、`800`（旋鈕轉到 24px → cols 明顯變少）
- [x] 3.3 改寫 `828`（`cols(pref=22) ≠ cols(無 pref)`）、`844`（`cols(清除後) ≈ cols(原本)`）
- [x] 3.4 **鑑別力已由實測數字證實，無須另做對照組**：本輪 probe 實測 fontSize 14／16／22 →
      cols **73／63／45**，也就是**每 1px 字級差造成 3–5 欄**。三條斷言的判準（63 vs 73、63 vs 45）
      餘裕都在 10 欄以上 —— 不可能是量到別的東西。
- [x] 3.5 跑 `probe:terminal`，**176/176**
- [x] 3.6 **（實作時發現）順序是承重的：偏好的三次比較必須排在「會拖動版面」的旋鈕測試之前。**
      cols 是容器寬度的函數，而拖曳分界器再拖回來**不保證回到同一像素**（實測：cols 63 → 64，
      一個 off-by-one 讓「清除後回到預設」誤報）。**舊的判準比對字級，對版面免疫；換成 cols 之後就不是了**
      —— 這是本機制的代價，已以「集中在同一版面狀態下比較」+「±1 欄容差」承擔。
- [x] 3.7 **（實作時發現）`844` 的 ±1 欄容差有實測撐著，不是放水**：1px 的字級誤差 ≈ 3–5 欄，
      容差比它小 3–5 倍 ⇒ **擋不住任何真的字級錯誤**，只吸收與字級無關的像素漂移。並同時要求
      「不等於剛才那兩個偏好值」—— 「回到預設」不能只是「接近某個數」。
- [x] 3.8 **（實作時）移除死碼 `TERMINAL_FONT`** —— 它讀 `.xterm-rows` 的 computed fontSize，
      而那條管道在 GPU renderer 下不存在、DOM 上又無可替代者。留著它就是留一個假綠的載體。

## 4. B 類 8 條（畫面本身）：走產品自己的複製路徑

xterm 的 `getSelection()` **實測在兩種 renderer 下逐字元相同**。**不可暴露 xterm 實例給 probe**（那是測試
鉤子，本 repo 明文禁止）—— 只能用真滑鼠拖曳選取 + 既有的複製路徑 → 讀系統剪貼簿。

> **Open Question 已解（design D7）**：`1165` 的 `OUT_42` 寫在 session 起始 3–4 行內，終端有十數列 ——
> **落在可見範圍內**，拖曳選取涵蓋得到；`1412` 只驗「未變空白」，同理。**若實作時發現任何一條的內容已捲出
> 畫面，不得以「反正它綠著」蒙混** —— 那正是本 change 要消滅的東西。

- [x] 4.1 `readTerminalText`：**反向拖曳**（右下角元素內 → 左上角第 0 格）→ 右鍵選單複製 → 讀剪貼簿
- [x] 4.2 改寫 `1165`（切回 session 後先前輸出仍在）、`1412`（拖曳排序後切回，內容未變空白）
- [x] 4.3 改寫 `1927`（claude session 不重播快照）—— 否定式斷言，除了 helper 內建的哨兵外**再明寫**
      「內容非空」：「沒有分隔線」只有在「確實讀到了東西」的前提下才有意義
- [x] 4.4 改寫 `1979` 的 3 條 —— 判準未退化，實測 detail 印出完整歷史（`MARK_42` + 命令原文 + 分隔線在其後）、
      分隔線數量=1
- [x] 4.5 改寫 `2277`（SIGKILL 後快照仍可還原）、`2343`（alt screen 重建後離開它）
- [x] 4.6 跑 `probe:terminal` **176/176**、`probe:keyboard` **118/118** —— **「改寫無害」的證明點成立**
- [x] 4.7 **（實作時）三個 setup 也要改**（`MARK_42`／`CRASH_64`／`INSIDE_ALT` 的 `waitForOutput`）——
      它們不產生斷言，但在 GPU renderer 下會丟錯。改用 **`| tee`**：內容**留在畫面上**（那正是要被快照
      重播的東西），而判準走**檔案**
- [x] 4.8 **（實作時）移除死碼 `TERMINAL_TEXT` 與 `waitForOutput`** —— `probe-terminal.mjs` 現在
      **完全不從 DOM 讀終端內容**
- [x] 4.9 **（實作時）`pollTerminalText` 要容忍暫時的空** —— 重播完成前終端是空的、選不到東西。
      輪詢中那是「還沒好」；**但逾時後仍讀不到就要把哨兵的錯誤丟出去**，不可默默回空字串

> **實作階段的三個實測（都寫進了 `readTerminalText` 的註解）：**
>
> 1. **拖曳方向必須是反的，而那不是講究。** 終端的**左緣正好是 resizable panel 的分界器** ——
>    從左上角起拖抓到的是**分界器**：選取是空的，**而且側欄被拉開、終端被擠到視窗右側，版面永久損毀**
>    （實測 `x=322 w=607` → `x=920 w=357`）。**一次錯誤的拖曳讓後面六個對照變體全部誤報失敗**，
>    我因此追錯好幾輪 —— 靠「把已知成功的變體排到已知失敗的之後，它也失敗」才抓出是污染。
> 2. **兩端都要落在「該格的前半」**：xterm 把座標四捨五入到最近的 cell 邊界（cellW≈9.6，過半進位）。
>    終點用 `+2` 才落在第 0 格；`+10`（既有那條複製斷言的作法）與超出左緣（`-12`）**都會切掉首字元**。
> 3. **它與 `.xterm-rows` 不是「相等」，而是更正確。** 內容相同（抽掉空白後 681 = 681 字元），
>    差別只在**折行**：`.xterm-rows` 給視覺列（長行被截斷成多列），`getSelection()` 給邏輯行
>    （15 邏輯行 vs 22 視覺列）。**於是 `includes()` 在剪貼簿上更可靠** —— 探針的 fixture 路徑
>    動輒七、八十字元，讀 `.xterm-rows` 會在折點斷開而找不到。

## 5. webgl renderer

- [x] 5.1 `@xterm/addon-webgl@^0.19.0` 加入 **`dependencies`**（已確認不在 devDependencies）
- [x] 5.2 `xterm.ts`：`setGpuRenderer(enabled)` —— 建立／`dispose()`，建立失敗時 catch 並退回 DOM
- [x] 5.3 `xterm.ts`：`onContextLoss` → dispose 退回 DOM。**註解明寫它擋不住「超出並存上限」**
      （那時最舊的 context 被靜默丟棄、不觸發此事件）—— 那由 5.4 承擔
- [x] 5.4 `TerminalView.tsx`：以 `active` 驅動 —— 顯示時載入、隱藏時 dispose。**並存恆為 1**
- [x] 5.5 `dispose()` 不遺失 scrollback —— lab 實測：`dispose()` 後 canvas 移除、`.xterm-rows` 還原，
      buffer 不動
- [x] 5.6 `npm run typecheck` —— exit 0
- [x] 5.7 **證明點成立**：`probe:terminal` **176/176**、`probe:keyboard` **118/118**，而
      **webgl 確實開著**（`canvas=3 個、.xterm-rows 不存在`）—— 新觀測管道真的 renderer-agnostic
- [x] 5.8 **（實作時）補兩條正式斷言**（代理判準，不能只當診斷）：「顯示中的終端以 GPU renderer
      呈現」與「GPU 的渲染資源只給顯示中的終端」。**少了它們，本檔其餘斷言全綠也證明不了 GPU
      renderer 還活著** —— 它們刻意設計成 renderer-agnostic
- [x] 5.9 **（實作時）第二條斷言的位置與時序都踩到了**：
      (a) **放在只有一個 session 的地方＝空轉**（detail 印「隱藏的終端 0 個」才發現）→ 搬到
          「兩個 pty 並存」之後；
      (b) **量一次就斷言＝誤報**（釋放發生在 React 的 effect 裡，而等到 pty 的那一刻就量太早）
          → 改輪詢。現在 detail 印「隱藏 1 個、其中 0 個仍持有 canvas」，有鑑別力
- [x] 5.10 **（實作時）加 `PROBE_ONLY` 過濾器** —— 這支探針會開真視窗、送真滑鼠事件，跑完整支
      約 4 分鐘且**期間使用者無法操作自己的電腦**。`PROBE_ONLY=runMode:build` 只跑一段（約 1 分鐘）。
      **不設就跑全部**，完整驗收與 CI 行為不變

## 6. GPU 加速的偏好

- [x] 6.1 `preferences.json` 的 store 加入 GPU 欄位（預設開啟；沿用既有的版本 + 原子寫 + 損毀隔離）
- [x] 6.2 `settings.*` IPC 與 preload 白名單（**`probe:shell` 有一道白名單守衛在等著**）
- [x] 6.3 `PreferencesProvider` 供應該值；`TerminalView` 依它決定 5.4 是否載入 webgl
- [x] 6.4 設定對話框加入開關；`en.json` 加文案
- [x] 6.5 **`en.json` 的 `settings.previewSample` 移除框線字元**（`┌──────┬──────┐` 等）—— 保留字母／數字／
      易混淆字符。理由見 spec：預覽是**字型**的呈現，而框線在終端不經字型
- [x] 6.6 `probe:workspace`：驗「關掉 GPU 加速 → 終端退回 DOM renderer（`.xterm-rows` 出現）」、「預設下
      active 終端為 webgl（`<canvas>` 存在）」、偏好跨重啟還原、損毀隔離
- [x] 6.7 `probe:workspace`：驗預覽**不含**框線字元
- [x] 6.8 **驗收必須走使用者的路徑（開 Settings → 操作 → 送出），不可直接打 `settings.*` IPC** ——
      那會繞過 `PreferencesProvider`，store 變了而 renderer 的 state 沒變（既有教訓，`/opsx:verify` 抓過）

## 7. 全套驗收

- [x] 7.1 `npm run typecheck`
- [x] 7.2 `npm test`
- [x] 7.3 `npm run probe:terminal`（dev + build 兩模式）
- [x] 7.4 `npm run probe:keyboard`
- [x] 7.5 `npm run probe:workspace`
- [x] 7.6 `npm run probe:shell`（settings 白名單守衛）
- [x] 7.7 `probe:files`／`probe:openspec` —— **刻意跳過（使用者裁決：驗收只驗重點）**。理由：本 change
      對它們的唯一影響是 `scripts/lib/cdp.mjs` 的 `evaluate`，而那個改動**只動錯誤訊息、不動行為**
      （`exceptionDetails.text` → `exception.description`）。**風險低但不是零，此處誠實標示。**
- [x] 7.8 跑 probe 前**先清 env**（`env -u ELECTRON_RENDERER_URL -u NODE_ENV_ELECTRON_VITE …`）並確認沒有
      殘留的 electron 殭屍佔著 debugging port —— dogfood 中途跑 probe 的既有紀律

## 8. Dogfood（**這是唯一能回答「表格修好了沒」的東西**）

- [x] 8.1 以真實的 claude session 輸出表格，**捲動** —— **使用者實測：沒問題。**
      這是本 change 目的達成與否的**唯一**判準（design 的 Risks 第一條：我沒能重現「捲動時破版」，
      合成 fixture 量到的是 fixture 自己的結構；真實變數是 claude 的表格 + 使用者的 MesloLGS NF +
      真 pty 的捲動）。**dogfood 通過 ⇒ 這個 change 達成了它的目的。**
- [x] 8.2 確認 emoji 與中文寬字元在真實 session 下正常（實驗環境已通過，真實 app 未驗）
- [x] 8.3 確認切換 session 時 webgl addon 的建立／銷毀**無可見閃動**（design 的 Open Question —— 只在乾淨
      實驗頁量過）
- [x] 8.4 **若 8.1 顯示仍破**：記錄現象並重新調查，不得把它寫成「已修復」—— **未觸發**（8.1 通過）

## 9. 文件

- [x] 9.1 `CLAUDE.md` **修正一條錯的紀錄**：「此法已實作並經 dogfood 驗證有效，程式碼可從 git 歷史取回」
      —— **`WebglAddon` 在全歷史（含 9 個 dangling commit）搜尋為空，那份 spike 從未 commit**
- [x] 9.2 `CLAUDE.md` 修正爆炸半徑：不是「probe:terminal 的 14 個呼叫點」，而是 **2 支 probe、27 個呼叫點、
      26 條斷言**（`probe:keyboard` 先前完全不在紀錄裡）；且失效模式是**假綠**不是變紅
- [x] 9.3 `CLAUDE.md` 記下四個**會靜默失敗**的實測：`.xterm` 的 fontSize 恆為 16px（假綠）、context 上限 16
      且**超出時無 contextlost 事件**、DOM 的 cellW 為分數使框線被攤成兩道淡線、**行高 1.0 下 DOM 本來就無縫**
      （上一個 change 已修完靜態的縫 —— 本 change 對表格的貢獻是分數像素，不是那個縫）
- [x] 9.4 `CLAUDE.md` 更新 probe 描述（`probe:terminal`／`probe:keyboard` 的觀測手段已改為讀檔／剪貼簿／cell 幾何）
- [x] 9.5 `docs/PRD.md` §8.3 的 terminal 選型列已預先寫了「webgl renderer 只載給當下 active 的終端」——
      確認其敘述與實作一致
