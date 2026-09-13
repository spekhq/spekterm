> **順序由風險決定，不是由模組決定**（design 的 Migration Plan）。第 1–3 組與 Slack 無關，
> 可先落地；第 6 組做完 Slack 已經可用；design 中那條未查證的事實到第 7 組才需要答案。

## 1. 偏好欄位的單一來源

- [x] 1.1 建立偏好欄位的單一來源表，型別為
      `{ [K in keyof Required<TerminalPreferences>]: FieldSpec<Required<TerminalPreferences>[K]> }`
      （**不是 `Record<keyof T, FieldSpec>`** —— 後者會弄丟逐欄位的清理器型別繫結，見 D9），
      每個欄位就三條路徑（怎麼清理／是否屬字型群組／是否送往 renderer）各自作答且**無預設值**；
      驗證方式：`npm run typecheck` 通過
- [x] 1.2 `parsePreferences` 改為自該表推導讀入白名單，移除手寫解構清單；
      驗證方式：`npm test` 既有的 preferences 測試全綠
- [x] 1.3 `setTerminalFont` 改為自該表推導保留清單，移除手寫的 preserve（`:246-258` 三處）；
      驗證方式：同上
- [x] 1.4 **對照組（三個方向，各驗一次）**：(a) 自表移除 `agentStatus`、(b) 某欄位不答
      `toRenderer`、(c) 把 `fontFamily` 的清理器換成 `clampSize` —— 三者都要讓
      `npm run typecheck` 確實失敗；確認後還原。**(c) 是 D9 之所以不用 `Record` 的唯一理由，
      少了它就沒有人會發現那個形狀已經被改回去**
- [x] 1.5 補回歸測試：`agentStatus` 跨一次 `load()` 仍在（載體：
      `terminal-preferences` 的「切換後跨重啟保留」）；驗證方式：`npm test`
- [x] 1.6 補回歸測試：設定 `agentStatus` 後變更字型，該值仍在（載體：「變更字型不影響該開關」）；
      驗證方式：`npm test`
- [x] 1.7 **對照組**：把 1.2 與 1.3 的修正各自退回一次，確認 1.5 與 1.6 分別變紅
      （兩個失效方向要各驗一次 —— 它們是不同的 bug）
- [x] 1.8 預設值語意（「undefined 代表什麼」）**本 change 不做，已轉為 issue #43**。
      實測共 5 處、跨兩個 realm（`index.ts:202`、`ipc/terminal.ts:126,129`、
      `PreferencesProvider.tsx:106,108,110`）；收斂需要一個 `src/shared/` 的新模組，
      是另一個 refactor。裁決已寫進 design 的 D9
- [x] 1.9 更新 `preferences-store.test.ts:189` 已過時的註解（`agentEvents` 已補、只剩
      `agentStatus`），並移除 `preferences-store.ts:137` 指向 issue 的註解

## 2. `settings:get` 的逐欄位投影

- [x] 2.1 `ipc/settings.ts` **五個**處理常式（`get` ＋ 四個 setter）都改為經 `projectPreferences`
      逐欄位投影，保持「未設定即省略」。**比原訂的多了四個** —— setter 同樣把套用後的偏好回傳
      給 renderer，只改 `get` 會留下四個沒有白名單的出口。
      另外把 `preload/index.ts` 的宣告從 `TerminalPreferences` 窄化為 `ProjectedPreferences`：
      **renderer 的型別是自 preload 回推的，preload 寫寬了主行程的白名單就只剩執行期效果**
      （這一條是對照組抓出來的，第一版的註解宣稱了一件假的事）。
      驗證方式：`npm run probe:workspace` 129/129 全通過，含「損毀的偏好以預設啟動（空偏好）：{}」
      那條以鍵數為判準的斷言
- [x] 2.2 renderer 側（`PreferencesProvider`）隨投影後的型別調整；
      驗證方式：`npm run typecheck`
- [x] 2.3 新增原始碼守衛 `scripts/settings-projection.test.mjs`，**兩個方向**：(a) `ipc/settings.ts`
      裡每一個 `store.*()` 的回傳值都必須被 `projectPreferences()` 包住（判準是**父節點**，
      不是「檔案裡有沒有出現那個函式名」）；(b) `preload/index.ts` 不得宣告寬的
      `TerminalPreferences`；驗證方式：`npm test`
- [x] 2.4 **對照組（三個）**：(a) `get` 退回原樣轉手、(b) **只**退回一個 setter（其餘仍有投影）、
      (c) preload 放寬型別 —— 三者各自命中對應的那條測試。(b) 是「五個都要」那條的鑑別力，
      (c) 是型別窄化真的抵達 renderer 的鑑別力（實測 `TS2339`）
- [x] 2.5 新增單元測試：主行程偏好物件中存在一個未列入投影的欄位時，投影結果不含它
      （載體：「不在白名單中的欄位不被送出」）；驗證方式：`npm test`

## 3. watcher 條文與註解的事實校正

- [x] 3.1 `src/main/watcher.ts` 的檔頭註解改為講**比例**而非數目，並補上實際七個建立點的表格。
      順帶修掉 `watch-service.ts:247` 同樣過時的「其餘三個建立點」，並改為指向 `watcher.ts`
      的檔頭（那裡是唯一該維護那份清單的地方）；驗證方式：清單與 grep 的 7 處逐一對得起來
- [x] 3.2 確認 `watch-service.test.ts` 釘住顯式 `pollingRoot` 的那條測試仍然存在且會紅
      （孤例看起來很像可以順手清掉的殘留）；驗證方式：暫時移除該處的 `pollingRoot`，
      確認測試變紅，確認後還原

## 4. 機密的保管與四道出口

- [x] 4.1 新增 `src/main/secret-store.ts`：落於 userData 自己的檔案、與偏好及連線設定都分家、
      以僅擁有者可讀寫的權限**持有**。單元測試涵蓋新建 / 已存在且權限較寬的目標檔 /
      **已存在且權限較寬的暫存檔** / `load()` 時收緊四種情形。
      **原訂的第三條理由寫錯了**：暫存檔的明確 `chmod` 不是防 umask（umask 只清位元，
      `mode: 0o600` 不可能因此變寬），它防的是「前一次寫入崩潰留下一個寬權限的暫存檔」——
      那時 `mode` 無效，而 `rename` 會把寬權限帶到目標檔上。註解已更正
- [x] 4.2 讓機密的型別無法被直接字串化為明文（不透明包裝，`toString` / `toJSON` 不吐內容）；
      驗證方式：單元測試斷言字串化結果不含機密
      （載體：「憑證失效的回報不含憑證」）
- [x] 4.3 新增原始碼守衛 `scripts/secret-scope.test.mjs`，**三條**：機密讀取入口不得被任何
      建構子行程環境的模組取用（`user-env`、`terminal`、**`report-runner` 的 `delegateEnv`**）；
      機密不得出現在送往 renderer 的投影中；**`process.env[...]` 的指派不得出現在機密模組
      及其呼叫端**。第三條是關鍵 —— `ptyEnv()` 展開 `process.env`，所以洩漏不需要經過
      `terminal.ts`；驗證方式：`npm test`
- [ ] 4.4 **對照組（四個，各自指名要紅的那條）**：(a) 把機密加進 `ptyEnv()` 的路徑 ⇒
      **4.3 的第一條與 4.5 都要紅**；(b) 把一個機密欄位列入投影 ⇒ 4.3 第二條紅；
      (c) 在機密模組寫一行 `process.env.X = …` ⇒ 4.3 第三條紅；
      (d) 把機密移進 `preferences.json` ⇒ 4.1 的測試紅
- [x] 4.5 新增行為測試：pty 環境的任何一個值都不含機密（sentinel 獨特到不會被吞掉）。
      **必須呼叫 `ptyEnv()` 不帶參數** —— 第一版傳了明確的 `source`，於是繞過了 `process.env`
      這個真正的向量。它與 4.3 的守衛**互補而非重複**：守衛豁免 `user-env.ts`（唯一的套用點），
      那個檔案裡的一行洩漏守衛抓不到，這條抓得到。已實測該對照組：守衛仍綠、行為測試變紅
- [x] 4.6 確認 `.gitignore` 涵蓋任何本機機密檔案，且測試 fixture 與替身設定中不含真實憑證；
      驗證方式：`git status --porcelain` 乾淨、`npm test` 全綠

## 5. Slack 連線設定、端點與編輯入口

- [x] 5.1 新增 `slack-settings-store.ts`（回看範圍、端點，**與 token 檔分家**、與終端偏好分家、
      欄位表白名單、形狀不合的單項被忽略）。**「工作區」與「要偵測的身分」改為自憑證推導而非
      設定** —— 填錯的症狀是什麼都不會發生，與「沒人提及我」在畫面上相同，而那正是這個 change
      在對付的失效類。**spec delta 與 design D14 已隨此裁決更新，不靜默偏離**；
      驗證方式：`slack-settings-store.test.ts` 18 條
- [x] 5.2 端點的三條約束（D11）全部落地：scheme 白名單只認 `https:`（單元測試涵蓋 9 種壞值）、
      `usesDefaultEndpoint` 供介面警示、**寫入點由 `secret-scope` 守衛④釘住**
      （定義域限 `src/main/**` —— 威脅是主行程用不受信任的輸入寫它；renderer 的呼叫
      就是那個「使用者明確操作」）。對照組：在主行程無關模組寫端點 ⇒ ④ 變紅
- [x] 5.3 連線設定的投影走逐欄位白名單，且 `scripts/settings-projection.test.mjs` 改為**規則表**
      同時涵蓋兩條路徑。順帶加一道「**守衛自己沒有失效**」的檢查：規則裡列出的方法必須真的存在
      於 store 模組中 —— 少了它，一次方法改名會讓守衛靜默地不再比對到任何東西（全綠而性質已失）。
      對照組：把方法名改錯 ⇒ 該檢查變紅
- [x] 5.4 新增 `SlackSettings.tsx`，住在收件匣 overlay 的**第三個分頁**。
      **先查證過 `agent-intake` 與 `intake-routing` 都沒有列舉那個 overlay 的分頁**，
      所以這不構成對它們的修改（proposal 宣稱「一條都不改」的那個宣稱成立）。
      24 個 i18n key，`aria-label` 一律 `t(...)`；驗證方式：`copy-language` 與
      `aria-label-source` 兩道守衛全綠
- [x] 5.5 UI 呈現「已設定／未設定」，輸入框**唯寫**（送出後清空、重新載入不回填 ——
      值連在 DOM 裡都不存在）。斷言落在**整份 IPC 回傳值的序列化結果**上而非 DOM
      （`slack-state.test.ts`：不含憑證、不含其前綴與末段、不含落盤位置）——
      為此把純邏輯自 `ipc/slack.ts` 搬到 `slack-state.ts`（那個模組 import `electron`，
      `node:test` 載不起來，比照 `report-runner` 的 `delegateEnv`）。
      對照組：把憑證塞進狀態 ⇒ **單元測試與守衛③同時變紅**。
      跨行程的那一層在第 9 組的 probe
- [x] 5.6 設定 Slack 的分頁帶一段提示，指向 Rules 分頁設定 fallback（否則第一批提及全部是
      解析不出的待處理項目）；驗證方式：probe 斷言該提示可見（第 9 組）
- [x] 5.7 **不需要新增任何依賴**（design D15，實測）：Node 22.22 同時具備全域 `fetch` 與全域
      `WebSocket`，回補與 Socket Mode 都不需要 Slack 的官方 SDK。這順帶關掉兩個風險 ——
      放錯 `dependencies` 區塊的 `MODULE_NOT_FOUND`（唯一載體是最貴的 `probe:package`），
      以及**「SDK 讀約定俗成的環境變數」這個正是守衛①所防的向量**。
      Electron 主行程的全域 `WebSocket` 待第 7 組實測

## 6. 回補路徑（主幹）

- [x] 6.1 實作 mention 的判定：他人提及使用者本人才算，使用者自己發出的、未提及的都不算；
      驗證方式：單元測試以**同一批**三則訊息驗（載體：「自己的提及與未提及的訊息都不產生
      intake，而同一批中他人的提及照樣進來」）
- [x] 6.2 實作 intake 識別碼的推導 `slack:<team>:<channel>:<ts>`；驗證方式：單元測試斷言其
      通過 `isValidIntakeId`，且同一討論串的兩次提及產生相異識別碼
      （載體：「同一討論串中的第二次提及是另一則 intake」「識別碼可被收件匣接受」）
- [x] 6.3 實作討論串的取回，**上界固定為被提及的那一則訊息**；驗證方式：單元測試斷言
      提及之後新增的回覆不改變輸出（載體：「提及之後新增的回覆不改變已交付的內容」）
- [x] 6.4 實作**交付前的去重確認**：以注入的窄回呼 `alreadyDelivered(id)` 問收件匣
      （`intake-store.get(adapter, id)`），已在就不交付。**取代原訂的「字串快照」** ——
      那個設計保護不了促使它存在的情境（水位遺失時快照一起遺失），而收件匣的紀錄
      **從不被刪除**（實測 `setState()` 只改狀態）。design D3 與 spec 已隨此更新；
      驗證方式：單元測試（載體：「取回位置遺失之後不重複交付，也不產生警示」
      與「已被接受或忽略的項目同樣不再被交付」）
- [x] 6.5 **對照組**：把 6.4 的確認改成只看自己的水位，確認「取回位置遺失之後不重複交付」變紅；
      同時確認「內容真的不同時警示確實出現」那條**仍然是綠的** —— 兩條必須成對，
      否則「警示通道沒接上」會偽裝成成功。另驗「該提及確實被重新取回並考慮過」那條 THEN
      的鑑別力（少了它，「根本沒看見」會讓整條假綠）
- [x] 6.6 實作截斷：**所有受長度上限約束的欄位**（本文與標題／發起者／座標標籤），
      尺度與收件匣相同（正規化後、同一種字元計量），本文保留最接近提及的內容，
      **截斷說明寫在 `body` 字串之內**；驗證方式：單元測試三條
      （載體：截斷的三條 scenario，含「過長的標題不使整則被拒絕」）
- [x] 6.7 實作水位的記錄與其跨重啟保留、有上限的回看範圍；驗證方式：單元測試以**範圍內外
      各一則**驗（載體：「關閉期間發生的提及於啟動後出現」「回看範圍之外的提及不出現，
      而範圍之內的同時出現」）
- [x] 6.8 實作**每輪取回的投遞則數上限**與「還有未交付項目」的呈現；驗證方式：單元測試 +
      probe（載體：「一輪取回不超過上限」「未交付的項目於下一輪續作」）
- [x] 6.9 實作經既有投遞落點的交付（寫 JSON 檔，不走行程內捷徑）；驗證方式：整合測試斷言
      檔案落在落點且被收件匣採納；並驗收件匣達總量上限時走**暫時性拒絕**
      （載體：「收件匣已達總量上限時本能力的投遞受既有處置」）
- [x] 6.10 回補以 `void` 在啟動後 4 秒觸發、不阻塞啟動，且**不得拋錯**（`runSlackRound` 外層
      再包一層 try —— 呼叫端不 await，一個漏出去的 rejection 在主行程裡是致命的）。
      三重夾制：水位 / 有上限的回看範圍 / 每輪 25 則（刻意小於收件匣的 200，於是
      **我們不會是那個把落點塞滿的人**）。
      **「主行程在取回期間仍回應 IPC」這條行為斷言的載體留到第 9 組的 probe**
      —— 單元測試看不見主行程的回應性
- [x] 6.11 確認收件匣與 routing 中沒有任何以「來源是否為 Slack」為條件的分支；
      驗證方式：原始碼檢查 + `npm run probe:intake` 全綠
      （載體：「新增本能力未改變收件匣的判斷」）

## 7. 即時路徑（加速器）

- [x] 7.1 **實測 Electron 主行程的全域 `WebSocket`**：`electron 43.4.1` 回
      `{"node":"24.18.1","WebSocket":"function","constructable":true}`（`typeof` 是 function
      而構造時 throw 的情形存在過，所以分開驗）。順帶更正 D15 寫錯的事實 ——
      Electron 43 內的 Node 是 **24**，不是 22。
      **「user-scope 的事件會不會經 WebSocket 送達」仍未查證** —— 那要真實憑證，
      由 dogfood 認定。D1 讓它不承重：不成立時即時路徑只是永遠沒有事件進來，
      回補照常運作，**其餘模組一個字都不必改**
- [x] 7.2 實作 `slack-realtime.ts`。**它只負責從事件裡挖出一個訊息座標**，其餘一律走
      與回補**共用**的 `deliverCandidate()`。每一種失敗都只是降級（連不上／斷線／格式變了）。
      `ack` 與「我們是否關心那則事件」無關 —— 不 ack 的信封 Slack 會重送。
      驗證方式：`slack-realtime.test.ts` 14 條
- [x] 7.3 驗證兩條路徑對同一則提及產出**逐欄位相同**的投遞（`deepEqual`，涵蓋去重摘要的全部欄位）。
      **這條抓到一個真的缺陷**：即時事件裡沒有頻道名稱，第一版因此把 channel id 寫進投遞 ——
      於是同一則提及**依「哪條路先到」而呈現不同**，那是「卡片顯示識別碼對使用者不構成資訊」
      那個缺陷的另一種形式。處置：`channelNameOf` 查上一輪回補列舉到的清單，查不到才退回 id。
      對照組：把它改回一律用 id ⇒ 該條變紅

## 8. 連線狀態的呈現

- [x] 8.1 `SlackRuntime` 持有狀態，**四種情形各一句而不是一個布林**：還沒設定／設定好了而目前
      沒事／暫時性失敗／憑證失效。「還沒設定」刻意不報成失效（那會讓使用者去找一個不存在的
      問題）；`transient` 刻意不報成 `auth`（後者會讓他去換一份好的憑證，而問題不在那裡）。
      驗證方式：`slack-service.test.ts`；畫面那一層的載體在第 9 組的 probe
- [x] 8.2 同一種（kind + error）失效合併為**恰好一則並累加次數**。驗收驗「恰為一則 ＋ 次數」
      而不是「而非多則」—— 後者在**零則**時也成立，是一條紅不起來的斷言。
      驗證方式：`slack-service.test.ts` 的合併測試（第一輪 count=1、第二輪 count=2）
- [x] 8.3 回看範圍已在 UI 上（含說明它是刻意的缺口）。另外呈現「還有 N 則未交付」與
      即時路徑的三種狀態（`off` / `connected` / `degraded` —— 前者沒開，後者壞了）。
      驗證方式：probe 斷言可見（第 9 組）

## 9. 驗收：替身 Slack 與 probe

- [ ] 9.1 建立替身 Slack（`scripts/lib/stub-slack.mjs`），**接縫為 5.1 的端點設定**；
      **接縫已就位**（`slack.json` 的 `apiBaseUrl`，scheme 限 https）。
      能演出：連線中斷、憑證失效、同一則提及被重複取回（含頻道／成員改名）、
      討論串超過本文上限、標題超過欄位上限、提及落在回看範圍之外、收件匣已達總量上限；
      驗證方式：七種情形各有一支自測
- [ ] 9.2 新增 `scripts/probe-slack.mjs`，於 `scripts/lib/ports.mjs` 登記其 debugging port；
      驗證方式：`npm test` 的 ports 守衛不報重複
- [ ] 9.3 加入 `package.json` 的 `probe:slack` 與 `scripts/run-probes.mjs` 的序列；
      驗證方式：`npm run probe:slack` 可獨立執行
- [ ] 9.4 probe 的斷言**落在收件匣的結果上**（該則 intake 存在、其本文逐字元等於磁碟上的
      context 檔），不得只斷言送出了何種請求；驗證方式：人工覆核每一條斷言
      （載體：「驗收斷言的是收件匣的結果」）
- [ ] 9.5 補上 `agentStatus` 設定對話框那條 scenario 的載體 —— 它**今天就是零載體**
      （`agentStatus` 在 `scripts/` 中零命中），而本 change 正在修改那條 requirement 並痛陳
      「有 scenario、零載體」的問題。`probe:workspace` 已經開著那個對話框
      （`scripts/probe-workspace.mjs:616-702`），加開關的存在 + 預設 checked + hint 文字即可
- [ ] 9.6 **擴充 `scripts/intake-coverage.test.mjs` 涵蓋本 change 的全部 scenario**，
      含 `greenIfAbsent`（若實作完全沒做，這條會不會照樣綠）與 `mutation`（使它變紅的那個
      刻意的錯誤實作）兩欄；`specRoots()`（`:31-37`）目前寫死 `agent-intake-inbox`，一併一般化。
      **不得改用人工對照表** —— 上一次那樣做的 82 列表裡，39 條填「既有」有 4 條是假的，
      而這份檔案的存在就是那次的處置
- [ ] 9.7 撰寫 `scripts/slack-control-groups.mjs`，每個 mutation 指名哪一條斷言必須變紅
      （比照 `scripts/intake-control-groups.mjs`）；至少涵蓋：上界改為「取回當下」、
      快照改為重新查詢、截斷標記搬出 `body`、只截斷本文不截標題、水位不落盤、
      識別碼改為 thread-scoped、端點指向別處

## 10. 文件與收尾

- [ ] 10.1 更新 `docs/PRD.md`：§11 Phase 7 的 Slack 段落改為已落地，移除 `settings:get`
      那筆技術債的敘述（第 648 行起）
- [ ] 10.2 更新 `src/main/intake-service.ts:9-13` 的檔頭註解 —— 它目前寫著「強迫 Slack adapter
      寫檔給自己讀是為了介面而繞路」，與 D5 的裁決**方向相反**，交付後會是一段說反話的註解，
      而它就在下一個人最先讀到的位置
- [ ] 10.3 在文件中明確指出「把憑證放進 shell 的 rc 檔會使每一個 agent session 都讀得到它」——
      這是 `secret-scope` 的一條**無條件** SHALL，不是「若有需要」
- [ ] 10.4 更新 `CLAUDE.md`：收件匣段落補上「Slack 已是第一個 producer」，
      並在踩雷指南加一條觸發器指向新的 lessons（若 10.5 產出）
- [ ] 10.5 若本 change 產出「不知道就會踩、而且失敗是靜默的」的新教訓，寫入
      `docs/lessons/`（候選：`digestOf` 涵蓋六個欄位而其中兩個第三方可改、機密的四條出口、
      `Record` 與 homomorphic mapped type 在守衛強度上的差別）
- [ ] 10.6 關閉 issue #39，並在關閉說明中指出其標題涵蓋的 `agentEvents` 已由
      `agent-intake-inbox` 補上、本 change 補的是 `agentStatus`
- [ ] 10.7 關閉 issue #42，並說明條文改為講比例而非寫死數目（比單純校正數字多做了一步）
- [ ] 10.8 `npm run test:all` 全綠（封存前的完整驗收；約十幾分鐘）
- [ ] 10.9 `npm run lint` 與 `npm run typecheck` 全綠
- [ ] 10.10 使用者實際操作驗過（dogfood：真實 Slack 的連線由他認定 —— 自動化驗收刻意不涵蓋）

## 11. 順帶修掉的既有缺陷（實作第 6 組時發現）

- [x] 11.1 `src/main/intake-store.ts:69` 的 cache key 分隔符是一個**字面的 NUL 位元組**，
      改為 `\x00` escape（語意完全等價）。後果不只是難讀 diff：**`grep` / `git grep` /
      `git diff` 對整個檔案瞎掉，而它回空 + exit 1，連「binary file」都不說** ——
      於是「把某個符號 grep 一遍」這種清查技術在這個檔案上有一個沒人發現的盲點。
      這是本 repo 的**第四例**，而它是上一個 change 引入的。發現方式：`grep` 對一個
      225 行的 TS 檔完全沒有輸出
- [x] 11.2 新增 `scripts/nul-byte-source.test.mjs`：版控中的文字檔不得含字面 NUL。
      **四次之後才第一次有東西在守** —— 而 CLAUDE.md 的處置一直只是「記得要小心」。
      守衛讀**原始位元組**，不經任何文字工具：檢查的手段不能與被檢查的缺陷共享盲點
      （不能用 grep 查 grep 看不到的東西）
- [x] 11.3 **對照組**：把 `intake-store.ts` 的字面 NUL 放回去，確認守衛指名該檔案與行號變紅。
      另外守衛**抓到了它自己** —— 我在寫這道守衛的時候往它裡面寫進了兩個字面 NUL，
      正是 CLAUDE.md 那句「寫『不要寫字面 NUL』的時候特別容易寫出一個」的元層級實例
- [x] 11.4 新增 `scripts/slack-test-isolation.test.mjs`：碰到 Slack 用戶端的單元測試必須把端點
      導開（注入 `fetchImpl` 或把 `setApiBaseUrl` 指向本機）。**這是一次實際踩到的坑** ——
      `slack-service.test.ts` 的第一版沒設，於是它用預設端點**真的打了 slack.com**：
      把假憑證送到真實服務、讓測試依賴網路，而且 Slack 正確地回了 `invalid_auth`，
      於是一條斷言以一個完全正確的實作失敗了（症狀看起來像產品的 bug）。
      對照組：拿掉導開 ⇒ 守衛指名該檔案變紅
