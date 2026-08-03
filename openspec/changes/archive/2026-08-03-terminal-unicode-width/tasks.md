## 1. 依賴

- [x] 1.1 加入 `@xterm/addon-unicode-graphemes`（宣告 npm 版本，**不得**寫 `file:`／`link:`／`portal:`）。
      放 `dependencies` —— 與既有的 `@xterm/*` 五個套件一致，不另立判斷。

## 2. 實作

- [x] 2.1 把「從可用版本清單中選出要啟用的寬度判定」抽成**純函式**（不吃 `Terminal`、不碰 DOM），
      指名的版本不在清單中時**拋錯**。**理由已縮小**（design D4）：xterm 自己已經守了兩道門
      （`activeVersion` setter 會拋錯、addon 的 `activate()` 自己就設好版本），這個純函式擋的是
      「取陣列最後一個」那種會靜默選錯的寫法，不是本 change 的主要防線。
- [x] 2.2 `xterm.ts` 的 `new Terminal({...})` 加上 `allowProposedApi: true`。
      註解要寫明它是**硬性前提**（未開時 `loadAddon` 當場拋錯，非讀取時才拋）與其代價（design D2）。
- [x] 2.3 於 `createXterm()` 內載入 `UnicodeGraphemesAddon` 並以 2.1 的純函式啟用寬度判定。
      **位置是承重的**：必須在 `new Terminal()` 之後、把手回傳之前 —— 早於 `open()`、早於 `replay()`
      與任何 live 串流（design D5）。

## 3. 單元測試

- [x] 3.1 為 2.1 的純函式加測試：指名的版本存在時回傳它；**不存在時拋錯**。
- [x] 3.2 **對照組**：把 2.1 改成「找不到就回清單最後一個／回內建版本」，確認 3.1 變紅。
- [x] 3.3 **不得**在 node:test 裡以 `@xterm/headless` 驗證字元寬度 —— 那會踩到 upstream #6079 的
      pooled-Buffer trie 損毀，且失效方式是靜默的錯誤寬度（design D8 的 Risk）。寬度驗收一律走
      真實 renderer（第 4 節）。此條為「刻意不做」，實作時確認沒有人順手加了這種測試即可打勾。

## 4. probe:terminal 的寬度驗收

- [x] 4.1 新增量測助手：以**產品自己的路徑**關閉 GPU 加速（既有的 Settings 流程助手）→ DOM renderer
      → 量測 cell 佔用。**在 probe 內註明兩件事**：(a) 為什麼這裡刻意依賴 DOM renderer（cell 佔用是
      core 的資料、兩個 renderer 讀同一份 buffer，spec 已明文此要求可由自動化驗收建立）；
      (b) 驗收在產品自己的 renderer 內進行，**不另建 harness** —— 另建 harness 若放寬
      `webPreferences` 會換掉受測物實際走的程式碼路徑（design D8）。
- [x] 4.2 **主要驗收**：代表性字元集逐類別斷言，涵蓋 spec 明列的八個類別 —— BMP 寬字元、
      **星形平面寬字元（CJK 擴充 B/C/D）**、BMP emoji、星形平面 emoji、**基底＋VS16**、
      **ZWJ 序列**、**膚色修飾**、窄字元對照。（spec：代表性字元集的 cell 佔用逐類別正確）
      **不得縮減類別** —— design D1 記錄了一張只有兩格的表如何一度導出相反的選型結論。
- [x] 4.3 斷言「含 emoji 的行與純 ASCII 的行等寬」（表格形式的可觀察後果）。（spec scenario 2）
- [x] 4.4 斷言「多 code point 組成的 cluster 佔一個字的寬度」：`⚠️`、`👨‍👩‍👧`、`👍🏽` 各佔兩格。
      **這條與 4.2 的 emoji 類別不可合併** —— `addon-unicode11` 在純 emoji 上全過，卻把 ZWJ 家庭
      判成 6 格、膚色修飾判成 4 格；合併等於把 D1 的整個裁決從驗收中移除。（spec scenario 3）
- [x] 4.5 斷言「重播的歷史沿用同一份寬度判定」：在會被快照的 shell session 內寫入含 emoji 的
      對齊輸出，重建後以同一判準確認其對齊。（spec scenario 4）
- [x] 4.6 **對照組甲（存在）**：移除 2.3 的寬度判定設定後重跑，確認 4.2／4.3／4.4／4.5 全部變紅。
- [x] 4.7 **對照組乙（順序）**：把 2.3 的載入位置移到把手回傳之後（即 `replay()` 之後），確認
      **4.5 變紅而 4.2／4.3／4.4 仍綠**。少了這一組，spec 的「生效時機」那條只被「有沒有設」驗過，
      沒有被「設得夠不夠早」驗過 —— 而後者才是那條 scenario 的內容。
- [x] 4.8 新增段落結束時**還原狀態**（重新開啟 GPU 加速、關閉開啟中的對話框），並確認其後既有段落
      仍全綠。新斷言內部用相對數字、不寫死 session 數（既有紀律）。

## 5. 舊快照的相容性

- [x] 5.1 以**尚未載入 addon 的 build** 產生一份含 emoji 對齊輸出的快照，再以新 build 重播並確認
      呈現。**已完成，無退步。** 實作上以同一行程內的兩個終端精確模擬（A 無寬度判定負責序列化、
      B 有負責重播）—— 這比跑兩次 build 更精確，因為快照的往返本來就是無損的字串。結論：
      (a) 快照逐字元攤開**完全無損**、沒有任何為對齊補進的空白；(b) 重播後的呈現與**新 build
      直接寫入**同一份內容**完全一致**（此對照是必要的，少了它任何量測差異都會被誤讀成
      「重播殘留了舊寬度表的影響」）。

## 6. 效能（重做量測）

- [x] 6.1 重做寫入效能量測：**同一個 `Terminal` 實例重建**、每個組態跑 5–10 次取中位數、
      scrollback 設為產品值。design D7 已把初次量測標記為**不具資訊量**（n=1、兩個不對等的實例、
      雜訊量級大於效果），因此這裡不是複驗而是**第一次有效的量測**。
- [x] 6.2 依 6.1 的結果回寫 design D7 的結論。若確認有顯著退步，需回頭論證是否接受。

## 7. 體積與回歸

- [x] 7.1 跑 `npm run measure:bundle`，記錄 renderer bundle 因本 addon 增加的量。
      **實測：39.3 KB**（`index-*.js` 2,039,662 → 2,079,867 bytes，以「完全移除 import 與使用」
      為對照）。遠小於 unpacked 的 618 KB —— 後者含 source map 與未壓縮內容，不是 bundle 的貢獻量。
      歸因報告把它算進「應用程式與其他相依」（2.03 MB / 19.7%），佔比不足 2%。
      **因此不修改 `measure-bundle.mjs`，`workspace-app-shell` 不需要 MODIFIED delta**
      （proposal 的 Impact 記錄的條件未觸發）。
- [x] 7.2 `npm run typecheck`、`npm run lint`、`npm test` 全綠。
      （看 exit code，不要用 `head`／`tail` 過濾輸出 —— 既有紀律。）
- [x] 7.3 `npm run test:all`。**不得因為「這次只改了 renderer 的一個檔案」而跳過任何一支 probe。**
      實測 8/9：`probe:terminal` 251/252，唯一紅燈為「持久化檔案損毀」那條**既有的偶發**
      （issue #8）—— 單獨重跑 `PROBE_ONLY=runRestore:build` 為 16/16 全綠，且症狀與該 issue
      記載一致（完整跑時「分頁=1 隔離檔=無」，單獨跑時隔離檔正常產生）。新段落
      `runUnicodeWidth` 於 build 與 dev **兩模式皆 5/5**。

## 8. 文件

- [x] 8.1 CLAUDE.md：Tech Stack 的 xterm 那一行加入本 addon；路線圖新增本 change 的條目。
- [x] 8.2 CLAUDE.md 新增一節記錄本次的實測與踩雷。**至少涵蓋**：
      - **量測 harness 的 `webPreferences` 必須比照產品**（`nodeIntegration: true` 讓 addon 走
        Buffer 分支而踩到 upstream #6079，整個星形平面靜默判為一格）—— 以及那個坑的形狀：
        **兩次獨立測試若共用同一個環境假設，得到同一個錯誤結果並不構成佐證**。
      - **案例集要涵蓋類別而非實例**：兩格的對照表一度導出相反的選型結論。
      - **複製／選取所得的字串對「少一格」零鑑別力**（作者曾據此宣稱「buffer 是對的」而弄錯方向）。
      - `⚠️`／`👨‍👩‍👧`／`👍🏽` 為什麼升寬度表版本結構上救不了。
      - `allowProposedApi` 未開時 `loadAddon` **當場**拋錯。
      - 效能量測的雜訊量級大於效果時，**唯一誠實的結論是「不具資訊量」**，不是「沒有退步」。

## 9. dogfood 確認（交付的必要條件）

- [x] 9.1 **前置**：確認 `node_modules` 為 pristine —— 調查期間曾對 `@xterm/addon-webgl` 施加
      mipmap patch（design Open Question 1 的 (c)），**已還原並以 `npm pack` 逐位元組比對確認**。
      dogfood 前需重啟 dev 使還原生效，否則 9.2 的結論建立在一個未進版控的本機修改上。
- [x] 9.2 由使用者對**同一份含 emoji 的表格**確認捲動時是否仍破版。
      **已確認：於 pristine build dogfood，「都正常了」。** design Open Question 1 據此結案 ——
      (b)「存在第二個因素」排除（若有，寬度修正後它會留下來）；(c)「觀察受 patch 污染」依時間線
      排除（「resize 後會恢復」是最初回報時給的，而 patch 是其後才施加的）；(a) 為唯一存活的
      解釋，但它是消去法留下的、非直接觀察，已於 design 標明其證據強度。
      **SHALL NOT 因為寬度對齊已修好就宣稱「捲動破版」結案** —— design Open Question 1 列了三種
      可能，其中 (c) 因 9.1 的還原而可被直接檢驗。仍破則 (b)「存在第二個因素」成立，開為獨立
      issue 並在本 change 的紀錄中指明，不得含糊帶過。
