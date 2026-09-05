## 1. 驗收基礎建設（先做 —— 第 2–6 組的每一條都依賴它）

- [x] 1.1 **先驗 `utilityProcess.fork` 能不能載入 asar 內的檔案** —— **通過（2026-09-05）**。以獨立的最小 spike 驗證（自行 `asar pack` 一個含 `main.js` + `scan.js` 的目錄，`xvfb-run electron <app.asar>`），不動 repo 版本、不觸發換版：child 自 `<...>/app.asar/out/scan.js` 正常 spawn（回報 `inAsar: true`）、`postMessage` 往返正常、且讀得到 asar 之外的路徑（掃描器需要讀家目錄）。**不需要 `asarUnpack`**，第 5 組維持原作法。
  > **保留條件**：spike 跑在 `node_modules` 當下的 electron **43.4.1**，而 `package.json` 釘的是 43.1.0（見下方註記）。兩者的 `utilityProcess` 與 asar 支援無已知差異，但 11.5 的 `probe:package` 仍是這條的最終確認。
- [x] 1.2 **fixture 產生器 —— 完成**（`src/main/transcript-fixture.testkit.ts` + `.test.ts`，14 條測試全綠）。涵蓋 `isMeta`（3 種形態）、`isCompactSummary`、`interruptedMessageId`、**內文像中斷但不帶該欄位的反例**、slash 展開、`<bash-input>` / `<bash-stdout>`、純通知、通知夾雜、subagent 子目錄、中途換 `cwd`、跨時段 session、極長訊息、不在 workspace 的專案、跨 UTC 日期的深夜訊息、未知記錄類型。
  - 產生器**自己宣告 `facts`**，測試不得寫死數字；自檢測試**獨立重讀檔案再數一遍**，不重用產生器的計數邏輯（兩邊共用就會一起錯而照樣全綠）。
  - **自檢當場抓到產生器五個錯**：宣告的工具數 8／實際 7、用量列 8／實際 7、最後一個 `cwd` 恰好等於專案根（於是「取最後一個」的錯誤實作也會通過）、極長訊息不夠長（平均只有中位數 4.4 倍，拉不開對照）、以及**時區那一筆沒有鑑別力** —— 固定取當地 23:30 對東半球無效（UTC+8 的 23:30 是同一天的 UTC 15:30），改為依時區方向取凌晨或深夜。
  - `timezoneShape` 於機器跑在 UTC 時回報 `'no-offset'`，該條驗收應**略過而非通過**（比照 `polling-mount.testkit.ts` 的對照組自檢）。
- [x] 1.2b **CJK 守衛豁免 `*.testkit.ts`，並把它的前提變成結構保證** —— 豁免的理由是「不出貨」，而那件事此前沒有被檢查。新增「產品原始碼不得 import testkit」一條（`copy-language.test.mjs`），連同兩個對照組；實測把一支產品原始碼改成 import testkit 後該條確實變紅。少了它，一份中文 UI 文案只要搬進 `*.testkit.ts` 就能繞過整道守衛。
- [ ] 1.3 於 `scripts/lib/ports.mjs` 登記新 probe 的 debugging port；`npm test` 的重複與衍生檢查通過
- [ ] 1.4 新增 `scripts/probe-insights.mjs`（**以 `scripts/lib/sections.mjs` 組織為段落**，宣告段落依賴、支援 `PROBE_ONLY`）與 `npm run probe:insights`，並納入 `scripts/run-probes.mjs`；單獨執行通過
- [ ] 1.5 probe 啟動時斷言它掃的是 fixture 而非開發者本機的真實資料：以 fixture 的**已知數值**斷言（訊息數恰為 N、某 skill 名恰好出現 M 次），而非只斷言視圖存在。缺這條時探針會去掃 490 個真實檔案、把開發者的 prompt 全文寫進探針的 userData，而存在性斷言照樣全綠

## 2. 萃取：把一行 transcript 變成列

純函式，不碰檔案系統，全部以 `npm test` 驗收。

- [x] 2.1 記錄類型白名單：只處理 `user` / `assistant`，未知類型忽略且不拋錯；以 fixture 的未知類型驗收，確認結果不變且無例外
- [x] 2.2 `role: user` 但內容為 `tool_result` 的記錄不產生使用者訊息列；單元測試斷言使用者訊息數不變
- [x] 2.3 `isMeta` 與 `isCompactSummary` 判定：前者不產生使用者訊息列，後者產生一列並標示為脈絡壓縮；單元測試斷言兩個計數各自正確
- [x] 2.4 中斷以頂層 `interruptedMessageId` 判定並標示；**同時斷言「內文像中斷但不帶該欄位」的記錄被計為一般訊息**
- [x] 2.5 `<task-notification>`：**通篇只有通知者不產生任何列**（不得產生空內文的訊息列），夾在真實訊息中者保留其餘內文；兩種形態各自斷言，前者額外斷言使用者訊息數未增加
- [x] 2.6 slash command 還原為斜線字面；`<bash-input>` 視為使用者輸入而 `<bash-stdout>` / `<bash-stderr>` 不是；四種形態各一筆的單元測試
- [x] 2.7 工具呼叫列：工具名 + 單一辨識參數（Bash 取第一個 token、Skill 取 skill 名、Agent 取 subagent 類型）；三種各一筆
- [x] 2.8 用量列：四個 token 欄位自 `message.usage` 取得；單元測試斷言四個欄位都在列上
- [x] 2.9 使用者訊息列保存**完整內文**；單元測試以一則含標點與換行的訊息斷言存檔中的字串與原文逐字相同（不是「長度相同」）
- [x] 2.10 **工具輸出不進存檔**；單元測試以含 `tool_result` 的 fixture 斷言存檔中找不到該工具輸出的任何片段
- [x] 2.11 subagent 歸屬（design D5）：subagent 檔案的工具呼叫計入、其 `role: user` 不計入使用者訊息；以「主檔 + subagents/ 子檔」的 fixture 斷言兩個計數
- [x] 2.12 統計「被判定為非使用者輸入的比例」並輸出於掃描結果；單元測試斷言該比例出現且數值正確（旗標失效的偵測訊號，design 風險項）

> **第 2 組的六個對照組已跑過**（把實作改成被禁止的算法，確認對應斷言變紅再還原）：
> `isMeta` → 文字比對、`interruptedMessageId` → 比對英文文案、純通知 → 產生空列、
> subagent 的 user 記錄 → 計為使用者訊息、內文 → 只存長度、slash → 不還原。
>
> **其中第一個第一次跑是綠的 —— 那是一盞假綠。** fixture 原本三筆 `isMeta` 的內文剛好都認得出來
> （`Base directory` / `Another Claude session` / `[Image:`），於是它分辨不出「看旗標」與
> 「比對內文開頭」兩種實作。補了一筆**內文與一般訊息完全無法區分**的 `isMeta`（「把 C 也順便改一下」）
> 之後，該對照組才紅在 2.3。**真實資料裡 skill 的內文可以長成任何樣子，
> 而看起來正常的那一筆才是會被漏掉的那一筆。**

## 3. 專案識別

- [ ] 3.1 來源目錄名的編碼規則與其反查（design D4）：取編碼後等於目錄名、且最早出現的那個 `cwd`，其 basename 為顯示名稱；以「session 中途換過 `cwd`」的 fixture 斷言不會取到中途那個
- [ ] 3.2 專案識別碼為來源目錄名的不可逆雜湊；basename 撞名時以父層消歧；找不到相符 `cwd` 時回傳「無法命名」而非猜測。三種情形各一條單元測試

## 4. 存檔與增量掃描

- [ ] 4.1 存檔的讀寫：一個來源檔案對應一份 NDJSON，寫入為整檔覆寫，目錄與檔案以僅限擁有者的權限建立；單元測試斷言覆寫後不殘留舊列，並斷言權限位元
- [ ] 4.2 存檔中不得出現任何彙總結果；單元測試掃過存檔內容，斷言其中沒有直方圖、百分位或跨列計數
- [ ] 4.3 digest 索引（**先 `stat` 再讀**，或記錄實際讀到的位元組數 —— design D2）與增量判定；單元測試斷言連續兩次掃描時第二次未讀取任何來源檔案內容
- [ ] 4.4 **被追加內容的檔案其新增部分被萃取且既有列不重複**；單元測試對同一個 fixture 檔追加記錄後重掃，斷言新列出現、舊列未重複。transcript 就是逐輪追加的，這是實務上最常發生的路徑
- [ ] 4.5 增量結果 = 全掃結果；單元測試對同一份 fixture 分別跑多次增量與一次從零全掃，比對兩份存檔完全相同
- [ ] 4.6 來源檔案被刪除後存檔不受影響；單元測試刪掉 fixture 的一個來源檔再掃描，斷言對應存檔仍在
- [ ] 4.7 **事後以新欄位重算**：單元測試對「來源已刪除」的存檔計算一個當初未規劃、但輸入欄位在萃取範圍內的指標，斷言算得出來
- [ ] 4.8 存檔或索引損毀只影響它自己；單元測試弄壞一份存檔後重掃，斷言掃描完成、該來源被重新萃取、其餘不受影響
- [ ] 4.9 來源不可用與個別檔案讀取失敗：兩者皆使掃描正常完成，且「來源不可用」與「來源可用但沒有資料」為可區分狀態；兩種各一條單元測試

## 5. 掃描行程

- [ ] 5.1 新增 main 的第二個建置進入點（`electron.vite.config.ts` 的 `rollupOptions.input`），以 `utilityProcess` 建立掃描行程並定義訊息協定（開始／進度／完成／失敗）；`npm run build` 後確認 `out/` 有該檔案
- [ ] 5.2 掃描行程一律回傳**結構化錯誤碼**，不回傳文案（design D14）；單元測試斷言錯誤物件不含自然語言字串
- [ ] 5.3 單一併發與逾時：重複觸發回報「進行中」而非排隊，卡住時回報「掃描失敗」而非永遠進行中；兩者各一條單元測試
- [ ] 5.4 生命週期：關閉視窗、reload、結束 app 三條路徑皆不留孤兒行程；probe 於三條路徑後各斷言行程已消失
- [ ] 5.5 崩潰隔離：probe 令掃描行程異常結束，斷言主行程存活、既有 pty 仍可輸入輸出、掃描狀態為失敗
- [ ] 5.6 掃描期間 renderer 維持可用：probe 於掃描進行中操作 session 與側欄，並斷言終端輸出持續流動

## 6. 聚合與語言分類

- [ ] 6.1 聚合「工作的形狀」八個視圖；單元測試以 fixture 比對輸出的形狀與數值
- [ ] 6.2 聚合「說話的方式」三個視圖；單元測試同上
- [ ] 6.3 時間軸類一律以**本機時區**分組；以 fixture 中本機 23:30（UTC 為前一日）的訊息斷言它落在 23 時
- [ ] 6.4 分布類回傳中位數與高百分位、不回傳平均數作為代表值；以「一批短訊息 + 一則極長訊息」的 fixture 斷言中位數與平均數相差一個數量級
- [ ] 6.5 「一次坐下來」以 30 分鐘間隔切段，活動＝使用者訊息 + 工具呼叫（不含用量列）；以跨時段 fixture 斷言貢獻兩段而非一段，並以「agent 連續跑工具」的 fixture 斷言不被切開
- [ ] 6.6 skill 統計自工具參數取得；以「對應訊息不以斜線開頭」的 Skill 呼叫斷言它被計入
- [ ] 6.7 語氣分類（六類**可複選**）與中英文分類（兩類互斥 + 另計「兩者皆出現」）；規則表與其說明文字放進 `src/shared/i18n/en.json`（design D13）；單元測試每類至少一筆，並斷言中英文兩類相加為 100%
- [ ] 6.8 「我最常說的那幾句」：長度上限 20 字元、次數下限 3 次；單元測試斷言只出現一次的短訊息與超過上限的長訊息都不輸出
- [ ] 6.8b 每個語氣類別輸出至多 9 則、每則 ≤ 46 字元的例句；單元測試斷言數量與長度兩個上限都被遵守，且例句確實屬於該類別（不是隨機取樣）
- [ ] 6.9 **換一組分類規則對同一份存檔重跑**，斷言全部期間（含來源已刪除的期間）都以新規則呈現
- [ ] 6.10 時間範圍的篩選與跨期比較的資料輸出；單元測試斷言指定範圍後只含該範圍的資料，且兩段期間的同一指標可並列取得

## 7. IPC 與主行程整合

- [ ] 7.1 新增 `insights` preload namespace（**不掛在 `fs` 之下** —— design D16）與取得彙總結果／掃描狀態的 IPC；`npm run probe:files` 的 `filesystem-access` 白名單斷言仍通過
- [ ] 7.2 送往 renderer 的**任何內容**（彙總結果、狀態、錯誤訊息）皆不含絕對路徑、也不含訊息內文的完整清單；單元測試對三種輸出各掃一次
- [ ] 7.3 來源根解析順序為 `getUserEnv()` → `process.env` → `~/.claude`（design D9）；單元測試以「只有 user-env 有該變數」的情形斷言採用了它
- [ ] 7.4 觸發時機：app 啟動後延遲觸發一次增量掃描，開啟 overlay 時再觸發一次；probe 斷言**未開啟 overlay 時掃描仍已發生**

## 8. overlay

- [ ] 8.1 overlay 元件：覆蓋整個視窗、`role="dialog"`、可 `Esc` 關閉、關閉後焦點歸還至開啟它的入口；probe 斷言四者（焦點以 `document.activeElement` 斷言為該入口，不得為 `<body>`）
- [ ] 8.2 **overlay 開啟時導航快捷鍵不生效（絕對狀態斷言）**：probe 先按一次「應當有作用」的 `Ctrl+↓` 確認機制活著並記下選取項，開啟 overlay 後再按，斷言選取項**恰為原來那一個**（不是「未變」的相對判定）
- [ ] 8.3 **overlay 開啟時 `Ctrl+P` 不生效（需先建立可證偽的前提）**：probe 必須先讓 workspace 有 folder、側欄來源已選定、焦點在側欄之內，並先斷言「overlay 未開時 `Ctrl+P` 確實開得起來」；否則這條在任何實作下都會通過（`MainStage.tsx` 的 handler 掛在側欄容器，而 overlay 由活動列開啟，事件根本不行經側欄）。參考 `probe-openspec.mjs` 既有的 `FOCUS_SIDE_PANEL` 前置
- [ ] 8.4 渲染「工作的形狀」八個視圖，全部 DOM／CSS 自繪；probe 逐一以 `role` + `aria-label` 定位並斷言存在
- [ ] 8.5 渲染「說話的方式」三個視圖；probe 同上
- [ ] 8.5b 「我的語氣」每類同時呈現**例句**與**判定規則**；probe 斷言任一類別底下同時找得到例句元素與規則說明。例句是使用者唯一能檢查分類對不對的東西 —— 試作時第一版規則的兩個 bug（multiline 旗標、修正詞表放了單字「別」，後者使該類別膨脹 2.5 倍）都是印出句子才看見的，長條圖上完全看不出來
- [ ] 8.5c **沒有瀏覽全部內文的入口**；probe 斷言 overlay 中不存在可列出全部訊息內文的介面
- [ ] 8.6 **未規劃的視圖不出現**；probe 斷言畫面上沒有 token 用量或成本的視圖
- [ ] 8.7 **畫面上**呈現中位數與高百分位、不呈現平均數；probe 斷言（scenario 的主詞是「畫面上」，聚合層的單元測試不是它的載體）
- [ ] 8.8 每個視圖標示來源欄位；「一次坐下來」標示 30 分鐘門檻與「活動」的定義、「我的語氣」可檢視分類依據且說明百分比不相加為 100%、工具類視圖標示 subagent 口徑；probe 斷言這些說明存在
- [ ] 8.9 時間範圍選擇器與跨期比較的呈現；probe 斷言選定範圍後視圖只含該範圍
- [ ] 8.10 三種狀態（就緒／掃描中／存檔為空，空時再分來源不可用與無資料）；probe 以空 fixture 與不存在的來源各驗一次
- [ ] 8.11 呈現範圍不受 rail 選取影響，且**涵蓋不在 workspace folder 清單裡的專案**；probe 於 overlay 開啟中切換 rail 斷言不變，並斷言 fixture 裡那個不在清單中的專案有出現
- [ ] 8.12 字級全部引用 `--text-*` token、顏色走既有主題 token；`typography.test.mjs` 通過。24×7 熱圖若撞到 `2xs`（13px）的地板，開 `typography-scale` 的 delta，**不得**寫死字級或用 inline `style`

## 9. 活動列與既有探針的回歸

- [ ] 9.1 活動列新增入口並開啟 overlay；probe 斷言入口為可用狀態且觸發後 overlay 開啟
- [ ] 9.2 **更新 `scripts/probe-workspace.mjs` 的活動列斷言**：`activity.length === 4` 改為 5，且三條位置索引斷言（`activity[0]` / `slice(1,3)` / `activity[3]`）改為**以 `aria-label` 定位**。不改的話 `probe:workspace` 會紅；而更糟的是若新入口插在 Settings 之前，`activity[3]` 會變成新入口而「Settings 為可用狀態」照樣通過 —— 一條在驗錯元素的綠燈
- [ ] 9.3 `npm run probe:workspace` 完整通過

## 10. i18n

- [ ] 10.1 所有新文案（視圖標題、`aria-label`、狀態說明、分類規則與其說明、門檻的說明文字）進 `src/shared/i18n/en.json`；三道守衛（CJK、硬編 `aria-label`、key 型別安全）通過
- [ ] 10.2 新增的 `aria-label` 不含單引號、雙引號、反引號；probe 的選擇器一律以 `copy.mjs` 自字典取字串

## 11. 收尾驗收

- [ ] 11.1 **對照組**：逐一把實作改成被禁止的算法 —— 文字比對取代 `isMeta`、內文字串取代 `interruptedMessageId`、純通知產生空列、平均數取代中位數、session 首尾差取代切段、訊息開頭斜線取代工具參數、`basename(cwd)` 取代反查、UTC 取代本機時區 —— 確認每一項各自使**對應的那條斷言**變紅（不是任意一條紅就算），然後還原。八項的驗證結果記錄於本 change 的 `design.md` 末尾一節
- [ ] 11.2 `npm run typecheck`、`npm run lint`、`npm test` 全數通過
- [ ] 11.3 檢查沒有引入任何新的執行期依賴（比對 `package.json` 的 `dependencies` 前後差異）—— **`measure:bundle` 不是這件事的守衛**（design D8）；另跑 `npm run measure:bundle` 確認仍為零碼結束
- [ ] 11.4 `npm run test:e2e` 全部完整執行，總結顯示每支皆完整執行
- [ ] 11.5 以 `PROBE_PACKAGE_APPIMAGE` 重用產物跑一次 `npm run probe:package`，確認掃描行程在打包產物中載入得起來（`test:e2e` 不含這一支，而 D15 的失效方式正是「dev 正常、打包後 `MODULE_NOT_FOUND`」）

## 12. 文件

- [ ] 12.1 `docs/PRD.md` 新增一節描述本能力（不屬於任何既有 Phase，比照 `session-restore` 的寫法）
- [ ] 12.2 **`docs/PRD.md` §6 的活動列枚舉補上第五個入口**（目前 L195 明列 `Sessions`／`Handoffs`／搜尋／設定四個）。PRD 是產品需求的單一權威來源，不改的話它與 `workspace-layout` 對「活動列有幾個入口」給出兩個答案
- [ ] 12.3 新增 `docs/lessons/transcript.md`：21 種記錄類型、`isMeta` 與文字比對的差距、`interruptedMessageId`、純通知的實際分布、`cwd` 中途會變、`input_tokens` 的語意、subagent 子目錄、時間戳為 UTC、`CLAUDE_CONFIG_DIR` 會搬 `projects/`；並於 CLAUDE.md 的「踩雷指南」表格補一條觸發器
- [ ] 12.4 CLAUDE.md 的開發指令一節補上 `npm run probe:insights`

---

> **開工時發現的既有問題（不屬於本 change，未處理）**：`node_modules` 的 electron 是 **43.4.1**，
> 而 `package.json` 與 `package-lock.json` 都釘 **43.1.0** —— `npm ls electron` 直接回報
> `invalid`。也就是說「釘死」目前在本機並未生效，dogfood 與探針跑的是 43.4.1，
> 而 `dist:linux` 打出來的產物也會是它。處置（`npm ci`）需要另外裁決，因為它會換掉正在使用的
> Electron。

> **本清單已對 spec 的 scenario 逐條核對過載體**（不是憑印象填「既有」）。第一次核對（56 條）
> 抓到兩條零覆蓋：「使用者訊息的內文被保存」與「工具輸出不進存檔」，已補為 2.9 與 2.10。
> 「我的語氣要呈現例句」這項需求加入後 scenario 增為 58 條，已補 6.8b / 8.5b / 8.5c。
> 若後續有 scenario 增減，**這份核對要重做**，因為它的價值全部來自逐條這件事本身。
