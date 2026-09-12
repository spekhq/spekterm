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

- [ ] 4.1 新增機密的讀寫模組：落於 userData 自己的檔案、與偏好**及連線設定**都分家、
      以僅擁有者可讀寫的權限**持有**（不只是建立時設定）；驗證方式：單元測試涵蓋三種情形 ——
      新建、**寫入一個已存在且權限較寬的檔案**、**更名前的暫存檔**
      （載體：「機密檔案僅擁有者可讀寫」與其後兩條）
- [ ] 4.2 讓機密的型別無法被直接字串化為明文（不透明包裝，`toString` / `toJSON` 不吐內容）；
      驗證方式：單元測試斷言字串化結果不含機密
      （載體：「憑證失效的回報不含憑證」）
- [ ] 4.3 新增原始碼守衛 `scripts/secret-scope.test.mjs`，**三條**：機密讀取入口不得被任何
      建構子行程環境的模組取用（`user-env`、`terminal`、**`report-runner` 的 `delegateEnv`**）；
      機密不得出現在送往 renderer 的投影中；**`process.env[...]` 的指派不得出現在機密模組
      及其呼叫端**。第三條是關鍵 —— `ptyEnv()` 展開 `process.env`，所以洩漏不需要經過
      `terminal.ts`；驗證方式：`npm test`
- [ ] 4.4 **對照組（四個，各自指名要紅的那條）**：(a) 把機密加進 `ptyEnv()` 的路徑 ⇒
      **4.3 的第一條與 4.5 都要紅**；(b) 把一個機密欄位列入投影 ⇒ 4.3 第二條紅；
      (c) 在機密模組寫一行 `process.env.X = …` ⇒ 4.3 第三條紅；
      (d) 把機密移進 `preferences.json` ⇒ 4.1 的測試紅
- [ ] 4.5 新增行為測試：建立 session 後該 pty 的環境變數不含機密。**機密值用一個獨特的
      sentinel**（不是 `'token'` 之類會被任何東西吞掉的字串）—— 這是一條純否定斷言，
      「整個機制不存在也照樣綠」，它的鑑別力全靠 4.4(a)
- [ ] 4.6 確認 `.gitignore` 涵蓋任何本機機密檔案，且測試 fixture 與替身設定中不含真實憑證；
      驗證方式：`git status --porcelain` 乾淨、`npm test` 全綠

## 5. Slack 連線設定、端點與編輯入口

- [ ] 5.1 新增連線設定的持久化（工作區、要偵測的身分、回看範圍、端點），**與 token 檔分家**、
      與終端偏好分家、以白名單解析、形狀不合的單項被忽略而不使其餘失效；驗證方式：單元測試
      （載體：「設定跨重啟保留」「變更終端偏好不影響本能力的設定」）
- [ ] 5.2 端點的三條約束（D11）：只能由使用者明確操作改動、非預設值時畫面上可見、
      scheme 限 `https:`；驗證方式：單元測試 + probe
      （載體：`secret-scope` 的端點三條 scenario）
- [ ] 5.3 連線設定的投影同樣走逐欄位白名單並加守衛（**它與 `settings:get` 是兩個不同的
      處理常式，2.3 的守衛管不到它**）；驗證方式：單元測試斷言未宣告的欄位不出現在投影中
      （載體：「與機密同源的設定物件其投影為白名單」）
- [ ] 5.4 新增編輯入口的 UI，**不置於終端偏好對話框之內**；文案全數進
      `src/shared/i18n/en.json`，`aria-label` 一律 `t(...)`；
      驗證方式：`npm test` 的 `copy-language` 與 `aria-label-source` 兩道守衛全綠
- [ ] 5.5 UI 呈現「已設定／未設定」而非憑證本身；驗證方式：probe 斷言
      **IPC 回傳值整份**不含 sentinel（`window.workspace.…` 的結果，**不是**
      `document.body.textContent` —— 憑證可以在 payload 裡而畫面上不顯示）
- [ ] 5.6 設定 Slack 時一併提示需要設定 routing 的 fallback（否則第一批 mention 全部是
      解析不出的待處理項目 —— 見 design 的 Risks）；驗證方式：probe 斷言該提示可見
- [ ] 5.7 新增依賴至 **`dependencies`**（非 `devDependencies`）；驗證方式：
      `npm run probe:package` 啟動的 AppImage 不出現 `MODULE_NOT_FOUND`
      （**這是唯一驗得到它的載體** —— dev 模式對放錯區塊完全無感）

## 6. 回補路徑（主幹）

- [ ] 6.1 實作 mention 的判定：他人提及使用者本人才算，使用者自己發出的、未提及的都不算；
      驗證方式：單元測試以**同一批**三則訊息驗（載體：「自己的提及與未提及的訊息都不產生
      intake，而同一批中他人的提及照樣進來」）
- [ ] 6.2 實作 intake 識別碼的推導 `slack:<team>:<channel>:<ts>`；驗證方式：單元測試斷言其
      通過 `isValidIntakeId`，且同一討論串的兩次提及產生相異識別碼
      （載體：「同一討論串中的第二次提及是另一則 intake」「識別碼可被收件匣接受」）
- [ ] 6.3 實作討論串的取回，**上界固定為被提及的那一則訊息**；驗證方式：單元測試斷言
      提及之後新增的回覆不改變輸出（載體：「提及之後新增的回覆不改變已交付的內容」）
- [ ] 6.4 實作**參與重複判定的第三方字串的快照**（`actor`、`originLabel`、本文中被解析成
      顯示名稱的 mention、以及 unfurl 衍生的內容），與水位一起落盤，重新推導時沿用快照；
      驗證方式：單元測試（載體：「頻道改名或成員改名之後重送仍被判為相同」）
- [ ] 6.5 **對照組**：把 6.4 退回成重新查詢，確認該條變紅；同時確認「內容真的不同時警示確實
      出現」那條**仍然是綠的** —— 兩條必須成對，否則「警示通道沒接上」會偽裝成成功
- [ ] 6.6 實作截斷：**所有受長度上限約束的欄位**（本文與標題／發起者／座標標籤），
      尺度與收件匣相同（正規化後、同一種字元計量），本文保留最接近提及的內容，
      **截斷說明寫在 `body` 字串之內**；驗證方式：單元測試三條
      （載體：截斷的三條 scenario，含「過長的標題不使整則被拒絕」）
- [ ] 6.7 實作水位的記錄與其跨重啟保留、有上限的回看範圍；驗證方式：單元測試以**範圍內外
      各一則**驗（載體：「關閉期間發生的提及於啟動後出現」「回看範圍之外的提及不出現，
      而範圍之內的同時出現」）
- [ ] 6.8 實作**每輪取回的投遞則數上限**與「還有未交付項目」的呈現；驗證方式：單元測試 +
      probe（載體：「一輪取回不超過上限」「未交付的項目於下一輪續作」）
- [ ] 6.9 實作經既有投遞落點的交付（寫 JSON 檔，不走行程內捷徑）；驗證方式：整合測試斷言
      檔案落在落點且被收件匣採納；並驗收件匣達總量上限時走**暫時性拒絕**
      （載體：「收件匣已達總量上限時本能力的投遞受既有處置」）
- [ ] 6.10 確認回補分批進行且不阻塞主行程；驗證方式：以大量頻道的替身跑一次，
      斷言主行程在取回期間仍回應 IPC
- [ ] 6.11 確認收件匣與 routing 中沒有任何以「來源是否為 Slack」為條件的分支；
      驗證方式：原始碼檢查 + `npm run probe:intake` 全綠
      （載體：「新增本能力未改變收件匣的判斷」）

## 7. 即時路徑（加速器）

- [ ] 7.1 **實測 user-scope 的事件是否經 WebSocket 送達**（design 的未查證事實）。
      結果寫進 design 的 Decisions；不成立時本組退化為週期性重跑第 6 組的取回，
      **其餘模組不得因此改動**
- [ ] 7.2 依 7.1 的結果實作即時路徑，其輸出與回補路徑**同型**（吐出 mention 座標，
      內容仍由 6.3／6.4 推導）；驗證方式：替身送出一則事件後收件匣出現對應 intake
- [ ] 7.3 驗證即時與回補對同一則提及產生**相同的 `digestOf` 輸入**（不只是本文 —— 六個欄位
      全部）；驗證方式：單元測試比對兩條路徑的完整 authored + verified 欄位組

## 8. 連線狀態的呈現

- [ ] 8.1 實作連線／授權狀態的呈現，且「失效」與「目前沒有待處理項目」在畫面上可區分；
      驗證方式：probe 斷言兩種狀態的呈現相異（載體：「憑證失效時使用者看得到」）
- [ ] 8.2 實作失效警示的合併：連續多次同種失效後呈現**恰為一則**，且該則**指出涵蓋了多次**；
      驗證方式：probe（載體：「重複的失效合併為恰好一則，且該則指出重複的次數」——
      「而非多則」單獨在零則時成立，所以必須驗恰為一則＋次數）
- [ ] 8.3 呈現當前的回看範圍；驗證方式：probe 斷言該值可見

## 9. 驗收：替身 Slack 與 probe

- [ ] 9.1 建立替身 Slack（`scripts/lib/stub-slack.mjs`），**接縫為 5.1 的端點設定**；
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
