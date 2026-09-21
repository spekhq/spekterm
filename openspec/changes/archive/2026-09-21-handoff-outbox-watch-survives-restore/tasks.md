## 1. 落點的準備

- [x] 1.1 `src/main/handoff-outbox.ts` 的 `prepareOutbox()` **不再移除任何東西**：以 `lstat`
      判定 —— 已存在且是目錄就什麼都不做，不是目錄（或不存在）才移除後建立。
      **`rmSync` 整行從常規路徑消失。** 驗證：`npm run typecheck` 與 `npm run lint` 通過
- [x] 1.2 改掉該處的註解：現行的理由（「上一輪的殘留會讓一則早就處理過的交接在重建之後又被
      投遞一次」）不成立，而清除這個動作本身已被移除；改為寫下**為什麼不清**（design D2 的
      表格：清得到的只有同一 session 上一輪的殘留，而啟動掃描本來就會讀到它）與**為什麼
      「不是目錄」時仍要重建**（`mkdirSync` 對檔案拋 `EEXIST` ⇒ 該 session 靜默失去交接能力）。
      驗證：註解與 D2 的論證一致
- [x] 1.3 `src/main/agent-events.ts` 的 rm+mkdir 加一句註解：該目錄目前無人監看（讀取走
      `readdirSync` 輪詢），若日後改以 watcher 讀取，這個寫法會讓監看靜默失效。
      驗證：該註解指得出「為什麼它今天沒事」

## 2. 主載體：主行程單元測試

- [x] 2.1 新增測試：在暫存目錄上建立一個落點 → 起一個 `depth: 1` 的 `IntakeSource` 並等它就緒
      → 對該 session 呼叫一次 `prepareOutbox()` → 寫入一份合法投遞 → 以**有界輪詢**斷言它被
      處理。**投遞寫入之後不得直接或間接觸發 `scan()`** —— 含 `HandoffService.endSession()`
      那個不明顯的入口（它會先 `await scan()` 再清除落點）。走了掃描，舊實作照樣通過。
      驗證：`npm test` 通過
- [x] 2.2 反向測試：落點中一份**未被消費**的投遞，在重新準備之後仍存在且仍可被處理
      （spec 第四條 scenario）。驗證：`npm test` 通過
- [x] 2.3 結構判準測試（design D5 第三條）：準備之前對落點開一個 fd，準備之後讀
      `/proc/self/fd/<n>`，斷言路徑尾端**沒有** ` (deleted)`。**Linux-only，其餘平台 skip
      而非通過。** 註解要寫明**不可改用 inode 比對**（實測 ext4 rm+mkdir 後 20/20 次 inode
      被重用，那會是一盞永遠亮綠的燈）。驗證：`npm test` 通過
- [x] 2.4 確認 2.1 的失敗訊息分得出「完全沒有收到事件」與「收到了但內容不符」（design R2）。
      驗證：暫時把寫入的投遞內容改成不合法，確認訊息指向後者而非前者

## 3. probe 載體

- [x] 3.1 `scripts/probe-intake.mjs` **新增一個段落**（既有的 `runHandoff` 其來源 session 是
      啟動之後才建立的，屬於不受影響的那一側，塞不進去），並登記進該檔的段落清單。內容：
      啟動前於 profile 種入 `sessions.json` 與對應的 `outbox/<id>/` 目錄 → 啟動 app → 喚醒該
      session（`probe-terminal.mjs` 的 `runDormantHint` 是完整前例）→ 寫入一份合法交接 →
      斷言目標 folder 中出現 session。驗證：`npm run probe:intake` 該段通過
- [x] 3.2 為 3.1 補一條**正面前置**：另種一個沒有對應 session 的孤兒落點，在畫面就緒之後
      （啟動掃描早已結束）往它寫一份目標查無的投遞，斷言出現對應的失敗痕跡 —— 證明監看活著
      且事件路徑通到底。**少了它，`handoffService.start()` 慢一點或拋錯時，3.1 在舊實作下
      照樣全綠。** 驗證：把前置的投遞改成不寫，確認 3.2 變紅

## 4. 對照組

- [x] 4.1 `scripts/intake-control-groups.mjs` 增一條 `command: 'test'` 的 mutation：把
      `prepareOutbox` 退回「刪掉再重建」，`expectRed` 指名 2.1 那條。`from` 的錨點要**恰好
      命中一次**（`clearOutbox` 也有一處 `rmSync`，把註解一起帶進錨點最穩）。
      驗證：`node scripts/intake-control-groups.mjs <name>` 確認它真的變紅
- [x] 4.2 同一個 mutation 再登記一條走 probe 的，填上 3.1 的 `section`，`expectRed` 指名
      該段的斷言 —— **兩個載體各要一條**，只登記其中一條的話另一個從來沒有被證明有鑑別力。
      驗證：同 4.1
- [x] 4.3 ~~第三條 mutation（「rm → 讓出一個 tick → mkdir」）~~ —— **實作時發現它寫不出來**：
      `prepareOutbox` 是同步函式，同步函式裡讓不出 event loop tick，而把它改成非同步會連帶
      改掉呼叫端（那就不是一個 mutation 了）。處置：2.3 與 2.1／2.2 共用 4.1 的 mutation
      （已實測三條同時變紅），並在 2.3 的註解寫明它獨立的價值是**與時序無關**（日後這支函式
      若變成非同步、或 chokidar 改以路徑重新掛上，2.1／2.2 會變綠而 2.3 照樣紅）。
      驗證：該註解說得出「為什麼沒有專屬的 mutation」
- [x] 4.4 R4 的警告寫進這三條 mutation 的 `why` 欄位：chokidar 升級若讓它們不再變紅，那是
      重新論證 D2 的訊號，不是把對照組刪掉的理由。驗證：對照組跑起來時該段文字被印出

## 5. 覆蓋對照表與教訓

- [x] 5.1 `scripts/scenario-coverage.test.mjs`：四條新 scenario **逐條**登記載體、
      `greenIfAbsent` 與 `mutation`，並把本 change 登記進 `COVERED_CHANGES`。
      第二條 scenario 與第一條是同一條斷言，填表時要老實寫明，不要當成兩條覆蓋。
      填「既有」時要真的把那條斷言找出來（CLAUDE.md 的第五次教訓）。驗證：`npm test` 通過
- [x] 5.2 教訓的**一般形式**寫進 `src/main/watcher.ts` 的檔頭（它是建立監看的唯一入口，
      下一個往被監看目錄寫 `rmSync` 的人一定會經過那裡）：任何被監看的目錄被刪除後重建，
      監看即靜默失效，**且不發出任何目錄事件**；chokidar 對**檔案**的 rename 撐得住
      （`.git/HEAD` 的先例已記載），**目錄不撐** —— 這個不對稱本身就是該被寫下來的一句。
      驗證：該段講得出「檔案撐得住、目錄不撐」
- [x] 5.3 `docs/lessons/handoff.md` 新增一節，寫現場細節與**鑑別診斷**：§二已經用一模一樣的
      症狀（「即時不進來、重啟才出現」）描述了另一個成因（`depth` 沒參數化），新的一節必須
      寫明兩者怎麼分辨；並寫下「**看到事件不代表監看還活著**」（清殘留時會發 `unlink`，
      只是不發目錄事件），以及 inode 判準為何不可用。
      驗證：該節寫出了失效的**症狀**（投遞石沉大海、來源 agent 回報已交出），不只寫機制

## 6. 收尾驗證

- [x] 6.1 `npm test`、`npm run typecheck`、`npm run lint` 全綠
- [x] 6.2 `npm run probe:intake` 全段通過（不只新增的那一段）
- [x] 6.3 dogfood：在真實 app 裡對一個**被還原的** session 投遞一份交接，確認目標 repo 出現
      一個 prompt 已填好的 session。驗證：使用者實際操作過
