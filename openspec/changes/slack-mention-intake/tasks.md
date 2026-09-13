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
- [x] 4.4 **對照組（八個，各自指名命中哪一條）**。守衛四個：(a) `terminal.ts` import 機密模組 ⇒ ②；
      (b) `preferences-store.ts` import 機密模組 ⇒ ②；(c) 任一模組指派 `process.env` ⇒ ①；
      (d) 非白名單模組呼叫 `reveal()` ⇒ ③。機密模組四個：移除暫存檔 chmod ／移除 `load()` 收緊 ／
      移除 `inspect.custom` ／改成直接寫目標檔 —— 全部變紅。
      **其中三個第一版沒有鑑別力，是對照組抓出來的**（見 4.1 與 4.5 的說明，以及
      `inspect.custom`：`#value` 是真 private field，`util.inspect` 本來就看不見它，
      所以「不含 sentinel」對沒有覆寫的實作照樣成立 —— 斷言改為釘 redaction 標記本身）
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

- [x] 6.1 實作 mention 的判定：**訊息提及使用者本人即算，含他自己發出的**；未提及的不算。
      **第一版排除了「自己發的」，而那條裁決在 dogfood 之前被使用者推翻（D16）** ——
      失效方向不對稱：不收而他想要時，症狀與「功能壞了」完全相同。
      函式一併改名（`isIncomingMention` → `isCapturedMention`：舊名把已被推翻的判準寫進了介面）。
      spec delta、design、對照表都已隨之更新，**不靜默偏離**；
      驗證方式：單元測試以**同一批**三則訊息驗
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

- [x] 9.1 建立替身 Slack（`scripts/lib/stub-slack.mjs`）—— **真的 HTTPS 伺服器**，因為產品的
      端點白名單只認 `https:`，而那條不為驗收放寬。信任錨的解法是實測出來的：
      **`--ignore-certificate-errors` 無效**（錯誤碼 `DEPTH_ZERO_SELF_SIGNED_CERT` 是 **Node** 的
      —— 主行程的 `fetch` 走 undici 而非 Chromium 的堆疊），**`NODE_EXTRA_CA_CERTS` 有效**。
      替身演出：憑證失效、重複取回（含改名 + 水位已清掉）、超長討論串、超長標題、
      回看範圍之外、即時連線連不上。**替身必須真的套用 `oldest`** —— 不套用的話
      「回看範圍之外的提及不出現」會因為替身不篩而假綠。
      **「收件匣已達總量上限」未做**，已轉為 issue #45
- [x] 9.2 新增 `scripts/probe-slack.mjs`，於 `scripts/lib/ports.mjs` 登記其 debugging port；
      驗證方式：`npm test` 的 ports 守衛不報重複
- [x] 9.3 加入 `package.json` 的 `probe:slack` 與 `scripts/run-probes.mjs` 的序列；
      驗證方式：`npm run probe:slack` 可獨立執行
- [x] 9.4 `probe:slack` **24/24**。斷言落在收件匣的結果上（卡片出現、呈現名稱而非識別碼、
      本文帶入提及前的上下文），而「本文逐字元等於 context 檔」那條跨行程斷言由既有的
      `probe:intake` 承擔（它與來源無關）。
      **這支 probe 抓到一個真的產品缺陷**：狀態只在掛載時取一次，主行程的 `onStatusChanged`
      沒有接到任何東西 —— 於是**憑證失效永遠不會出現在畫面上**，而 D10 那條 requirement
      會以一個看起來正常的介面失敗。處置：加 `slack.onChanged` 推送（比照 intake）。
      診斷時把斷言拆成兩層（先讀 IPC payload、再讀畫面），於是「主行程沒記下」與
      「畫面沒更新」是兩條不同的紅燈 —— 它們的處置完全不同
- [x] 9.5 補上 `agentStatus` 設定對話框那條 scenario 的載體 —— 它**今天就是零載體**
      （`agentStatus` 在 `scripts/` 中零命中），而本 change 正在修改那條 requirement 並痛陳
      「有 scenario、零載體」的問題。已加三條斷言（**那條 scenario 有三句 AND，各驗一次** ——
      只驗第一句的話，另兩句被違反時不會有任何東西變紅）：開關存在／預設為啟用／介面說明它
      只影響其後的 session。`probe:workspace` 129 → **132/132**。
      順帶踩到那個檔案自己警告過的坑：**在 template literal 之內的註解裡寫了反引號**，
      它把字串提前關掉
- [x] 9.6 **擴充 `scripts/intake-coverage.test.mjs` 涵蓋本 change 的全部 scenario**（57 列），
      含 `greenIfAbsent` 與 `mutation` 兩欄。`specRoots()` 已一般化為 `COVERED_CHANGES`
      （第一版寫死一個名字，於是那道「每一條 scenario 在表上恰有一列」的守衛**對下一個 change
      完全沉默** —— 那正是這整份表要防的事）。
      **守衛抓到 5 個我憑印象填的載體標籤** —— 那正是上一次 82 列表裡那 4 列的形狀，
      而這次它在 commit 之前就紅了。8 列老實填為無載體並寫理由（全部已轉為 issue #44 / #45）
- [x] 9.7 撰寫 `scripts/slack-control-groups.mjs`，**10 個 mutation**，每個指名哪一條斷言必須變紅。
      第一輪 **6/10 如預期變紅，4 個沒有** —— 而那 4 個全部是真問題：
      (a) 上界那條指名錯了斷言（mutation 讓**更多**訊息進來，而我指名的那條仍然成立）⇒
      probe 補一則「提及之後」的訊息並斷言它不在本文裡；
      (b)(c) 去重與識別碼那兩條：內容相同的重投被收件匣**靜默**吞掉，卡片仍是一張 ⇒
      斷言改讀整個 overlay（拒絕彙整渲染在 notices，**不在 `li` 裡**）；
      (d) 失效合併那條：probe 只觸發一輪失效，畫面顯示「seen once」仍滿足那個 regex ⇒
      改指名單元測試。
      **其中兩條的真正載體是單元測試而不是 probe**，腳本因此支援 `command: 'test'` ——
      **指名錯載體的對照組比沒有對照組更糟，因為它看起來有人管**。
      最終 **10/10 全部如預期變紅**

## 10. 文件與收尾

- [x] 10.1 更新 `docs/PRD.md`：§11 Phase 7 的 Slack 段落改為已落地，移除 `settings:get`
      那筆技術債的敘述（第 648 行起）
- [x] 10.2 更新 `src/main/intake-service.ts:9-13` 的檔頭註解 —— 它目前寫著「強迫 Slack adapter
      寫檔給自己讀是為了介面而繞路」，與 D5 的裁決**方向相反**，交付後會是一段說反話的註解，
      而它就在下一個人最先讀到的位置
- [x] 10.3 在文件中明確指出「把憑證放進 shell 的 rc 檔會使每一個 agent session 都讀得到它」——
      這是 `secret-scope` 的一條**無條件** SHALL，不是「若有需要」
- [x] 10.4 更新 `CLAUDE.md`：收件匣段落補上「Slack 已是第一個 producer」，
      並在踩雷指南加一條觸發器指向新的 lessons（若 10.5 產出）
- [x] 10.5 新增 `docs/lessons/slack.md`（11 節）：去重的權威為何必須是收件匣、`digestOf` 涵蓋
      六個欄位而其中兩個第三方可改、Slack 對業務錯誤回 HTTP 200、**Electron 主行程的 `fetch`
      走 undici**（所以 Chromium 的旗標無效而 `NODE_EXTRA_CA_CERTS` 有效）、單元測試會靜默地
      打到真實服務、機密的四條出口、`Secret` 的隱私來自 private field 而非 `inspect.custom`、
      檔案權限是「持有」而非「建立時設定」、`Record` 與 homomorphic mapped type 的守衛強度、
      preload 寫寬了白名單就只剩執行期效果、`probe:slack` 的兩個陷阱。
      CLAUDE.md 的踩雷指南加一列指向它
- [x] 10.6 關閉 issue #39（已註明其標題涵蓋的 `agentEvents` 已由 `agent-intake-inbox` 補上、
      本 change 補的是 `agentStatus`，以及那兩條 scenario 此前都是零載體）
- [x] 10.7 關閉 issue #42（已說明條文改為講比例、清單移到 `watcher.ts` 檔頭，比單純校正數字多做一步）
- [x] 10.8 `npm run test:all` **全綠**：`npm test` 1172 條、`test:e2e` **13/13**
      （probe:slack 37s、probe:workspace 132/132、probe:terminal 284/284），
      每一支都標示「完整執行」或無段落資訊，沒有中斷的段落
- [x] 10.9 `npm run lint` 與 `npm run typecheck` 全綠（0 error / 0 warning）
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
- [x] 11.5 **「收件匣已達總量上限」這條 scenario 的 probe 載體未做，已轉為 issue** ——
      要在替身裡先塞滿 200 則待處理項目，那會讓一個段落的時間從 6 秒變成分鐘級。
      該條的主行程側已有單元測試覆蓋（`slack-service.test.ts` 釘住「每輪上限小於收件匣上限」
      這個結構關係），缺的是端到端那一層

## 12. 交付時仍開著的缺口（全部已轉為 issue）

- [x] 12.1 偏好欄位表的**編譯期保證沒有自動化載體** —— 四條性質都是人工實測的，沒有東西會在
      型別被改回 `Record` 時變紅。**已轉為 issue #44**（`terminal-preferences` 的三條 scenario
      在對照表裡記為無載體）
- [x] 12.2 Slack 的三條缺口 —— 「收件匣已達總量上限」的端到端載體、即時路徑「收得到事件」
      那一半、以及「收件匣沒有 Slack 分支」的原始碼守衛。**已轉為 issue #45**
- [x] 12.3 issue #43（偏好的「未設定代表什麼」在兩個 realm 共 5 處）於第 1 組開出，仍開著

## 13. dogfood 前的裁決變更

- [x] 13.1 **使用者自己發出的提及改為也收**（D16）。第一版排除它的理由是「他不需要被自己交辦」，
      而那條理由站不住：**失效方向不對稱** —— 收了而他不想要只是幾則自己造成的項目（忽略一次
      就沒了），**不收而他想要則是「tag 了自己什麼都沒發生」，與功能壞了無法區分**。
      而「tag 自己」是唯一完全可信、完全刻意的一種提及。**不加開關**（沒有證據說它吵；
      日後若確認，那時加會是資訊充分的決定）。
      驗收：`npm test` 1172、`probe:slack` **25/25**、`openspec validate --strict` 通過

## 14. dogfood 當場抓到的兩個缺陷

使用者第一次接上真實 Slack 就同時踩到這兩個，而**兩個都以「收件匣是空的」呈現** ——
與「沒有人提及我」在畫面上完全相同。

- [x] 14.1 **權限不足被報成憑證失效。** `missing_scope` 原本落在 `AUTH_ERRORS`，於是狀態那一行
      說「你的憑證不再有效」，而憑證是完全好的 —— 照那句話做會白換一份 token，而問題原封不動。
      拆出 `{ kind: 'scope', needed, provided }`（`needed` 是 Slack 自己給的，**是這則訊息唯一
      可行動的部分**，第一版把它丟掉了），`#round` 對 `scope` 也早退（不要讓同一個問題以
      `realtime: degraded` 再報一次），畫面改為「Missing Slack permissions: {{needed}}」。
      載體：`slack-api.test.ts` 的「**權限不足是 scope 而不是 auth，且帶出缺哪些**」，
      對照組＝把 `SCOPE_ERRORS` 併回 `AUTH_ERRORS`
- [x] 14.2 **回補只在啟動後跑一次，沒有週期性重試。** design D1 的降級模式寫的是
      「啟動時 **+ 週期輪詢**」而只做了前半。使用者在 app 起來之後才貼上憑證是常態（實測就是
      這樣踩到的），而不重開 app 就永遠不會有第二輪 —— 在 dev 模式下「重開 app」還需要有人
      重跑 `npm run dev`。加 `ROUND_INTERVAL_MS`（5 分鐘）、`start()`（立刻一輪 + `setInterval`
      並 `unref()`）、`#running` 再入保護、`dispose()` 清計時器，以及**存下憑證即觸發一輪**
      （`ipc/slack.ts` 的 `requestRound`）。
      載體：`slack-service.test.ts` 的四條（假時鐘），四個對照組各自指名的斷言都驗過變紅
- [x] 14.3 **文件給錯的 scope 清單已修。** 我原本只叫他加 `:history` 那一組，而
      `users.conversations`（列舉頻道）要的是 `channels:read` / `groups:read` / `mpim:read` /
      `im:read` —— 少了它頻道清單是空的，於是整條回補一則都掃不到。
      `docs/lessons/slack.md` 補上完整清單與「改完必須 Reinstall」
