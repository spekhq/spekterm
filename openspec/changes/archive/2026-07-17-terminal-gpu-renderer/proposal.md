## Why

**表格仍然會破。** `terminal-rendering-and-preferences` 把行高從 1.3 收到 1.0，dogfood 回報「好不少」
—— 但那個 change **明文不宣稱修好表格**：DOM renderer 下框線字元靠**字型自己的 glyph** 去拼，行高只是
讓縫變小，捲動時的重繪仍會破。真正的修復要讓字格渲染**獨立於字型的 glyph 幾何**，那需要 GPU renderer。

上一個 change 把它延後，**真正的理由不是技術風險，是驗收會瞎掉** —— webgl 畫到 `<canvas>`，`.xterm-rows`
隨即消失，而那是 probe 讀終端內容的唯一管道。延後的代價已經付了（調查完整留在 design D2），現在接手。

**重新調查後，延後時的三個判斷有兩個要修正：**

- **「程式碼可從 git 歷史取回」是錯的。** `WebglAddon` 在全歷史（含 9 個 dangling commit）搜尋為空 ——
  那份 spike 從未 commit，webgl 要從頭做。（CLAUDE.md 的這句話一併修掉。）
- **爆炸半徑是紀錄的兩倍，且失效方向是反的。** D2 記「probe:terminal 的 14 個呼叫點、8 條斷言倒」；
  實際是 **2 支 probe、27 個呼叫點、26 條斷言** —— **`probe:keyboard` 也讀 `.xterm-rows`**（10 處），
  紀錄完全沒提到它。而「斷言倒」聽起來像會變紅，真正的失效是 **`TERMINAL_TEXT` 回空字串、不丟錯**，
  於是三條**否定式**斷言（「被攔下的按鍵沒有流進 pty」等）會在終端完全讀不到的情況下**保持綠燈**。

## What Changes

- **終端的 active 視窗改用 webgl renderer**（`@xterm/addon-webgl`）。**xterm 唯一可用的 GPU renderer
  就是它**（canvas addon 已死，見 Impact）—— 底下那些子項都是這一件事的組成，不是並列的另一件事。
  xterm 6 的 `customGlyphs`（預設 true）使 block element 與 box-drawing **程式化繪製、不經字型 glyph**，
  官方文件明載其效果為「continuous lines, **even when line height is used**」，並明說**它對 DOM
  renderer 無效**。
  - **只給當下 active（看得見）的那一個終端**，切走即 dispose、xterm 自動退回 DOM。此 app 同時掛載每個
    session 的終端，而並存的 webgl context **實測上限為 16**；**超出時最舊的是靜默被丟棄的**（實測建 30
    個只有 16 個活著，`webglcontextlost` 一次都沒觸發）—— 終端會直接變空白而沒有任何事件通知。因此
    「只給 active」不是優化，是必要條件。
  - **自動降級**：context 取不到或執行中 loss 時退回 DOM renderer（至少不比現況差）。
  - **附一個關掉它的開關**，在設定介面上叫「**GPU 加速**」（沿用 VS Code `terminal.integrated.
    gpuAcceleration` 的命名）。**「GPU 加速」與 webgl 是同一個 renderer 的兩個名字** —— webgl 是實作，
    「GPU 加速」是使用者看得懂的那個字；關掉它 ＝ dispose 掉 webgl addon ＝ 退回 DOM renderer。
    它補的是**自動降級擋不住的那一格**：webgl 拿得到、但驅動有 bug 畫出爛東西 —— 那種情況不觸發任何
    事件，只能由使用者自己關。（webgl 確實跑在真顯卡上：實測 context 的 renderer 字串為
    `ANGLE (Intel, Mesa Intel(R) Xe Graphics, OpenGL 4.6)`，「GPU 加速」是準確的敘述而非行銷詞。）
- **修好被廢掉的 probe 觀測點**（26 條斷言）。分類後救援路徑不同：
  - **A 類 14 條**（過半）測的是 pty 行為，只是「借畫面文字」當觀測手段 → **改為讀檔**。這是**嚴格更強**
    的判準：它能區分**回顯與執行**，而讀畫面文字本來就分不清（CLAUDE.md 早有這條教訓）。
  - **B 類 12 條**測畫面本身（字級 4、session-restore／scrollback 8）→ 走**產品自己的複製路徑**
    （選取 → 複製 → 讀系統剪貼簿）。D2 把這條列為「未驗證的候選」，而 `probe-terminal.mjs:945-960`
    **已經有一條這樣做的斷言、且完全不讀 DOM** —— xterm 的 `getSelection()` 讀的是 buffer 不是 DOM，
    拿得到 B 類需要的順序與完整性，且它是**產品的公開功能，不是測試鉤子**。
  - **C 類 2 條**（休眠提示的 `elementFromPoint`）測堆疊順序，預期存活。
- **先給 `TERMINAL_TEXT` 加「讀不到就丟錯」的哨兵。** 與 webgl 無關、獨立成立、且必須最先做 —— 沒有它，
  後續每一步都在瞎子摸象（假綠會讓「還是綠的」變成沒有意義的訊號）。
- **偏好設定的即時預覽要重新想。** 預覽的範例文字**含框線**（`┌──────┬──────┐`），而它是純 DOM 渲染。
  webgl 之後真終端的框線程式化繪製、預覽的不是 —— **預覽會開始說謊**（顯示縫，而終端沒有）。這正是
  CLAUDE.md 預言過的反轉：「若日後 GPU renderer 進來，這條就反了」。
- **`ui-monospace` 的 emoji 呈現要實測。** DOM renderer 靠瀏覽器逐字符 fallback；webgl 的 glyph atlas
  路徑不同，彩色 emoji 是否仍正常**未驗證**（dogfood 痛點原話就含「emoji 與框線斷字」）。

### 需要裁決：probe 要不要靠那個開關賴在 DOM renderer 上

**爭點不是「要不要那個開關」** —— 要，它便宜、且補的是自動降級擋不住的那一格。爭點是**驗收要不要用它**。

D2 把「改寫觀測點」與「GPU 做成偏好」列為兩條候選解，但它們其實**不是同一個問題的兩個答案**：開關是
產品功能，改寫觀測點是驗收工程。真正的分叉只有一個 ——

**若讓 probe 用那個開關把 GPU 關掉、繼續在 DOM renderer 上測**：工作量最小（27 個觀測點一行都不用改）。
D2 為它留了一個論證：那批 A 類斷言（pty I/O、cwd、cols、buffer 存活）本來就與 renderer 無關，而 DOM
renderer 是產品**真實支援的降級路徑**，測它不是測虛構的東西。**但代價是出貨的預設路徑（webgl）從此
沒有任何 probe 覆蓋** —— 這與 CLAUDE.md 記過的 `app.isPackaged` 假綠是**同一個形狀**：「未打包但載入
build 產物」誤發 dev 政策，於是 **production 政策永遠測不到**，而 probe 一直是綠的。

**本 proposal 的立場**：開關照做（它有獨立的產品價值），但**不讓驗收靠它** —— 觀測點該修還是要修。
A 類改讀檔是**淨賺**（判準嚴格更強），B 類走剪貼簿管道（產品既有的公開路徑）。代價是工作量顯著較大。
**若你要的是最小路徑，這裡是唯一的取捨點。**

## Capabilities

### New Capabilities

（無。webgl 是「終端如何渲染」，落在既有的 `terminal-sessions` 之內；關閉它的那個開關是終端的一項
偏好，落在既有的 `terminal-preferences` 之內 —— **那兩者是同一個 renderer 的實作與開關，不是兩件事**。
**沒有需要新開一塊能力的東西。**）

### Modified Capabilities

- `terminal-sessions`: 新增「終端的字格渲染獨立於字型的 glyph 幾何」—— 這正是上一個 change **原擬新增、
  因延後而移除**的那一條（「沒交付的東西不寫進 spec」）。含 context 取不到時退回 DOM 的降級行為。
- `terminal-preferences`: 兩條 requirement 的**理由被推翻**，不只是文字調整 ——
  - 「預設行高 SHALL 使框線得以相接」與其 scenario：**行高不再決定框線接不接得起來**（customGlyphs
    使其獨立於 glyph 幾何）。這條的整個論證建立在「框線靠字型 glyph 拼接」上，該前提在 webgl 下不成立。
    **連帶：行高 1.0 這個預設值本身要重新裁決** —— 它當初是為了讓框線相接而付的代價。
  - 「即時預覽」：預覽的框線不再代表終端（見上）。
  - 新增一項偏好：**關閉 GPU 加速**（＝關掉 webgl renderer，退回 DOM）。含落盤與損毀韌性，比照既有的
    family／size／行高。
- `typography-scale`: 待確認是否受影響 —— 「terminal 的字級由 xterm 的 `fontSize`（canvas 設定，非 CSS）
  決定」這條敘述在 webgl 下依然成立（cell 量測走 `CharSizeService`，是 DOM 而非 renderer），但**字級的
  可觀測性**改變了（probe 讀 `getComputedStyle(rows).fontSize` 的 4 條斷言即屬 B 類）。**若僅是觀測手段
  改變、requirement 不動，則不列入。** 由 specs 階段定奪。

## Impact

- **相依**：新增 `@xterm/addon-webgl`（0.19.0 —— 與既有的 fit 0.11／serialize 0.14／web-links 0.12
  **同代**，xterm 6 世代的 addon 皆已不宣告 peer）。**canvas addon 不可用且不再評估**：0.7.0 是唯一
  仍宣告 peer `^5.0.0` 的 addon，2023-11 後未再發佈，官方已 deprecated 改推 webgl。
- **程式碼**：`src/renderer/src/shell/terminal/xterm.ts`（wrapper —— renderer 其他模組不直接 import
  `@xterm/*` 的約束不變）、`TerminalView.tsx`（active 驅動載入／卸載）、終端偏好的 store／IPC／設定
  對話框、`en.json`（GPU 偏好的文案、預覽範例）。
- **驗收**：`probe:terminal` 與 `probe:keyboard` 的 27 個觀測點（26 條斷言）。**`probe:keyboard` 先前
  不在紀錄的爆炸半徑內** —— 它整支測的都是「按鍵有沒有進 pty」，畫面純粹是觀測手段（A 類），但它的三條
  否定式斷言正是假綠的重災區。
- **驗不到、由 code review + design 承擔的部分**（比照 OSC 8 `linkHandler` 的先例）：**像素級的框線對齊**
  —— probe 能斷言的只是「webgl 已啟用」的代理判準（active 終端內存在 `<canvas>`）。表格是否真的不破，
  最終由 dogfood 認定。
- **平台**：webgl 於本機經 ANGLE 取得真 GPU 的 webgl2 context（Mesa Intel Xe，實測）。**macOS／Windows
  未實測**，列入 Phase 6 打包前的確認項（比照既有的 `ui-monospace`／`O_NOFOLLOW` 待確認項）。
- **文件**：`CLAUDE.md` 修正「程式碼可從 git 歷史取回」（**錯的**）與爆炸半徑的數字；`docs/PRD.md` §8.3
  的 terminal 選型列已預先寫了「webgl renderer 只載給當下 active 的終端」，本 change 使其成真。
