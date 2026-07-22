## 1. 先換判準，在既有環境上驗到綠 —— 順序是承重的

**先改判準、在實體螢幕上驗到全綠，再換執行環境。** 反過來做的話，任何一條紅燈都有兩個嫌疑犯
（判準改壞了 vs. 換環境弄壞了）。這與 `terminal-gpu-renderer` 換觀測管道時的順序是同一條紀律。

- [x] 1.1 把 `probe:terminal` 的 GPU 判準由「數 `<canvas>`」改為「該終端當下走哪條渲染路徑」——
      程式化繪製 ＝ 存在 `canvas.xterm-link-layer` 且不存在 `.xterm-rows`；倚賴 glyph ＝ 反之
      （design D3）。**兩個方向都要斷言**：顯示中的走程式化繪製、隱藏的走 glyph 路徑。
- [x] 1.2 在判準旁留下註解，說明為什麼不能數 canvas：`TextureAtlas._tmpCanvas` 是**跨終端共用**
      且會**遷移**的暫存畫布（同字型設定的終端共用一份 glyph 快取），它停在最近一次光柵化的
      那個終端底下 —— 數 canvas 等於把共用物當成 per-terminal 狀態。
- [x] 1.3 **重現先前的誤判情境並確認新判準是綠的**：構造「切換後顯示中的終端未再光柵化新字元、
      `_tmpCanvas` 停在隱藏終端底下」的狀態，斷言仍判定為未持有（specs 的第三個 scenario）。
      **少了這條，就只是把紅燈改綠而不是改對。**
- [x] 1.4 對照組：暫時讓 `setGpuRenderer` 於終端隱藏時**不釋放**，確認新判準會紅 —— 證明它對
      真正的洩漏仍有鑑別力（改完復原）。
- [x] 1.5 在**實體螢幕**上跑 `npm run probe:terminal`（此時尚未動執行環境）：198/202，
      **GPU 相關斷言全綠**（含新增的兩條）。餘 4 條紅為 `runContinuation` 的既有 flaky
      （baseline 已對照重現，與本 change 無關）—— 於 3.1 在虛擬螢幕上重新量。

## 2. 虛擬螢幕的執行環境

- [x] 2.1 虛擬螢幕解析度定為 **1600x1200x24**（`scripts/lib/display.mjs` 的 `SCREEN`，固定寫死，
      不跟隨實體螢幕）。
- [x] 2.2 讓探針在虛擬螢幕上啟動（`xvfb-run`，design D1）。**探針本身不改**：包裝加在啟動那一層。
- [x] 2.3 傳入啟用軟體 GL 的旗標（design D2；實測可用組合為 `--enable-unsafe-swiftshader`
      `--use-angle=swiftshader`）。缺了它，webgl 取不到 context，GPU 相關斷言會全紅。
- [x] 2.4 `xvfb` 不存在時 **SHALL 明確失敗並說明如何安裝**，SHALL NOT 靜默退回實體螢幕
      （design 的 Risks）。
- [x] 2.5 逃生口定為**環境變數 `PROBE_DISPLAY=physical`**（Open Question 2）—— 與既有的
      `PROBE_ONLY` 同型，可疊加，且不必為 9 支探針各加一條 npm script。走這條時會印一行提示。
- [x] 2.6 `probe:identity` **個別**確認（design D6）—— 它刻意不傳 `--user-data-dir`，且要驗的正是
      userData 實際解析出來的路徑。
- [x] 2.7 `probe:native` **個別**確認（design D6）—— 它自己就是一個 Electron 主行程
      （`electron scripts/probe-native.mjs`），不走其他七支的啟動路徑。

## 3. 驗收

- [x] 3.1 `npm run test:e2e` 於虛擬螢幕上 **9/9 全綠**，**期間螢幕確實未被佔用**
      （含第 5 組修掉的兩個既有 flaky）。
- [x] 3.2 逃生口實測：以它跑至少一支探針，確認確實回到實體螢幕。
- [x] 3.3 對座標敏感的斷言在新解析度下確認：`probe:openspec` 196/196、`probe:keyboard` 118/118、
      `probe:workspace`／`probe:files` 全綠，OSC 標題段亦綠。唯一對座標敏感的紅燈
      （`readTerminalText`）**已排除是解析度造成的**：虛擬 1/3 紅、實體 0/2 紅，兩邊皆 flaky
      且實體螢幕是 3840x1080、虛擬是 1600x1200 —— 樣本上看不出解析度的影響。
- [x] 3.4 `npm test` 268/268、`npm run typecheck`、`npm run lint` 皆綠。

## 4. 文件

- [x] 4.1 CLAUDE.md 的「開發指令」：說明探針預設在虛擬螢幕上執行、逃生口怎麼用、以及新增的
      `xvfb` 系統相依。
- [x] 4.2 **更正** CLAUDE.md 把「GPU 的 canvas 未釋放」記為既有產品缺陷的每一處 —— 那是錯誤的
      紀錄。改為記載真正的教訓：**沒有 class 的 canvas 不只一種**，而數 DOM 元素當作「持有某資源」
      的代理判準，會把跨終端共用且會遷移的暫存物算成 per-terminal 狀態。
- [x] 4.3 記下 D4 的限制：**軟體 GL 驗得到資源的生命週期，驗不到畫素** —— 探針綠了不代表程式化
      繪製畫得對，那一類仍只由 dogfood 認定。

## 5. 收掉 `probe:terminal` 的兩個既有 flaky（實作期間追加，見 design D7）

- [x] 5.1 續寫入口：`makeStubClaude({ logInput })` 由 `exec sh -c 'tee | "$SHELL" -i'` 改為
      `exec cat >> <log>` —— 原本那個 `sh` 的 stdin 是管線而非 tty，撐不住（實測基準 2/4，
      **build 與 dev 皆然**）。
- [x] 5.2 續寫入口：新增「按下前 session 的 pty 已存在」斷言（此前這一段連 marker 都沒傳，
      無從等待）—— 前提被破壞時直接指出是前提壞了。
- [x] 5.3 GPU 內容：切 renderer 前先寫入已知標記（`echo GPUMARK_$((6*7))`，回顯裡不含答案），
      判準由「文字非空」改為「那一段內容還在不在」；新增「切換前終端裡確實有已知內容」斷言。
- [x] 5.4 新增 `pollUntilText()` —— 讀終端內容是一連串真滑鼠動作，量一次就斷言等於賭內容此刻
      已在畫面上（`pollUntil` 只吃 evaluate 的字串表達式，用不了）。
- [x] 5.5 重複量測確認不再 flaky：`PROBE_ONLY=runContinuation` 連三次 8/8、
      `PROBE_ONLY=runMode` 連三次 136/136（皆含 build + dev 兩模式）。
- [x] 5.6 `probe:workspace` 的「順序於重啟後一致」改為輪詢 rail 的列（`app.mounted` 只保證
      `<aside>` 掛上，列本身來自非同步的 `folders.list()`）—— 連跑第二輪 `test:e2e` 才現形，
      且 detail 為空看起來像「順序錯了」。連三次 75/75。
