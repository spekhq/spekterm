## 0. 先實測那個不在我們掌控中的機制

整個能力的第一步押在「注入的內容確實進入 agent 的脈絡」，而它是 agent CLI 的行為、**在本 repo
內零證據**（`additionalContext` / `hookSpecificOutput` 在整個版控中只命中本 change 自己）。
與 `agent-intake-inbox` 當初對預填時序的處置相同：先量，再依賴。

- [x] 0.1 以**真實** `claude` 實測三件事並記下 CLI 版本：(a) `SessionStart` hook 的 stdout 是否
      進入脈絡、以什麼形式；(b) **同一個事件上兩條命令**的 stdout 如何處置（本 repo 一定有兩條，
      事件橋接已佔了 `SessionStart`）；(c) 輸出不合格式時 agent 的行為。結論寫進 `docs/lessons/`
- [x] 0.2 依 0.1 的結果確認 D1 成立或改走退路（`--append-system-prompt`，文字經環境變數傳遞）；
      若改走退路，回頭修 design D1 與 `agent-handoff-source` 的第一條 requirement 再往下做

## 1. 注入合成器：讓「同一個設定項被兩個貢獻者覆蓋」表達不出來

先做，因為它是既有缺陷（D2），且第 3 節要加的第三個貢獻者會立刻踩到它。

- [x] 1.1 `InjectionContribution` 拆出獨立的 `hooks` 欄位（與 `settings` 並列），`composeInjection()`
      對 `hooks` 逐事件串接；單元測試驗證兩個貢獻者對**同一個** hook 事件各貢獻一條命令時，
      合成結果中該事件有兩條
- [x] 1.2 `composeInjection()` 對 `settings` 的**重複 key 直接失敗**（不變式違反，非靜默覆蓋）；
      單元測試驗證兩個貢獻者貢獻同一個非 hook 設定項時合成以明確失敗結束
- [x] 1.3 `agent-events` 改為貢獻 `hooks` 欄位而非 `settings.hooks`；`npm test` 既有 agent-events
      測試全綠
- [x] 1.4 新增原始碼守衛 `scripts/injection-hooks-source.test.mjs`：任何貢獻者的 `settings` 內出現
      `hooks` 這個 key 即失敗；並附對照組（把 `agent-events` 改回寫 `settings.hooks` 時該守衛變紅）
- [x] 1.5 擴充 `scripts/lib/stub-agent.mjs`：對每個事件跑完 `hooks[event][*].hooks[*].command`
      而非只跑第一條，並把各自的 stdout **分別落盤**（現行實作 `>/dev/null` 丟掉）。
      **少了這一步，1.1 與 3.x 的兩條 requirement 在對照表上只能填「無載體」**
- [x] 1.6a 在 `src/main/terminal.ts` 釘住貢獻者的註冊順序（handoff 排在事件橋接**之後**）並以註解
      寫明理由
- [x] 1.6b **對照組**（**須等 3.2 之後** —— 第三個貢獻者不存在時，狀態列與事件橋接用的是不同的
      key，改回覆蓋也不會衝突，這個對照組在那之前**結構上紅不起來**）：把 `composeInjection` 的
      `hooks` 改回逐鍵覆蓋，確認 `probe:agent-view` 的「注入的 hook 真的被執行」變紅

## 2. 把「被監看的投遞落點」一般化為兩邊共用

- [x] 2.1 從 `intake-source` 抽出可重用的落點處理（先以檔案大小上限拒絕、只採納特定副檔名、
      解析失敗不消費、暫時性拒絕原封留著、先建立監看等 ready 再掃描、分批不阻塞主行程），
      以參數化的 root、**`depth`** 與「如何把一份檔案轉成一次 `deliver()`」注入；單元測試覆蓋
      上述每一條。**`depth` 不參數化的症狀是「即時不進來、重啟才出現」** —— 啟動掃描照常運作，
      只有 watcher 收不到事件
- [x] 2.2 共用投遞落點改用它，`npm test` 既有 intake 測試與 `probe:intake` 全綠（純重構回歸）

## 3. 自我介紹：spekterm 告訴 agent 自己的存在

- [x] 3.1 產生自我介紹檔：內容含「執行於 spekterm」「可交接對象清單（名稱＋絕對路徑）」「投遞位置
      與格式」「**目標欄位可用名稱或絕對路徑**（歧義的脫困路徑）」；**文字為英文**
      （`copy-language.test.mjs` 擋 CJK 字面值），以單元測試驗證形狀與清單內容
- [x] 3.2a 新增注入貢獻者：`SessionStart` 加一條讀取該檔案的命令，並以 env 告知檔案位置；
      單元測試驗證它與事件橋接的 `SessionStart` 命令**並存**（依賴 1.1）
- [x] 3.2b 探針以 1.5 擴充後的替身驗證**兩條命令的 stdout 都被寫出**（與 11.1 同一支探針）
- [x] 3.3a 重寫自我介紹檔的機制（`refreshIntros`）＋單元測試：加入一個 folder 之後，活著的
      session 的自我介紹含有它
- [x] 3.3b 把它接上 workspace 清單的變動訊號（`WorkspaceStore.subscribe` → `index.ts`）。
      **探針那一半做不到、也不假裝做得到**：加入一個 folder 要走原生目錄選取對話框，驗收環境
      開不了它。載體是單元測試（3.3a）＋ `docs/lessons/handoff.md` 那條「CLI 於 resume／compact
      重跑 hook」的實測；缺口逐字寫進對照表那一列的 note
- [x] 3.4 自我介紹檔不可用時的降級：hook 命令失敗而 session 照常建立。**對照組必須是「注入失敗時
      讓 spawn 中止」** —— 零實作時這條恆綠

## 4. 投遞落點與來源身分

- [x] 4.1 每個 agent session 建立專屬投遞目錄並以 env 告知；單元測試驗證目錄於 spawn 後存在
- [x] 4.2 落點的清除發生在**其內容處理完之後**；單元測試驗證「投遞後立刻結束 session，該則交接
      仍被處理」，以及處理完畢後目錄不存在
- [x] 4.3 來源解析：由目錄名推出 sessionId，再查 session 歸屬得到 folder，且**歸屬於清除之前
      解析完成**（`TerminalService#sessions` 在 `kill()` 時即被刪除）；單元測試驗證 payload 中
      自稱來源的欄位被丟棄、且來源 session 已結束時仍解析得出
- [x] 4.4 交接識別碼由「sessionId ＋**投遞內容摘要**」推導；單元測試驗證同一份內容讀兩次只得到
      一則、以及同一個 session 用同一個檔名投遞兩份不同內容得到兩則
- [x] 4.5 以 `createWatcher` 監看投遞根目錄（單一 root，`shouldUsePolling` 依該 root 判定），
      接上 2.1 的落點處理並傳入巢狀所需的 depth；單元測試驗證新增與變更皆被處理

## 5. 目標解析

- [x] 5.1 查表解析：先名稱完整相等（不分大小寫）、再絕對路徑；歧義列出候選並拒絕、零命中拒絕；
      單元測試覆蓋命中／前綴不命中／同名歧義／**以絕對路徑化解歧義**／目標等於來源五種
- [x] 5.2 讓自我介紹的清單與查表的定義域**取自同一個來源**（單一函式）；單元測試釘住兩者同源，
      但 spec 只宣稱快照關係 —— **不要寫成「恆等」的斷言**（清單其後可能縮小，零命中是正常結果）

## 6. 已定址的投遞進收件匣

- [x] 6.1 `deliver()` 增加 optional 的第三個參數（已解析的目標 folder、來源 folder），
      既有兩個呼叫端不變；單元測試驗證不傳時行為與現況相同
- [x] 6.2 `Intake` 的 verified 組增加 optional 的目標 folder，`parseIntake()` **丟棄** payload 中
      同名欄位；單元測試驗證放進共用落點的 JSON 無法藉該欄位指定 folder
- [x] 6.3 routing：帶著已解析目標者直接採用、不比對規則、不落 fallback；該 folder 已不在
      workspace 時拒絕並說明；單元測試覆蓋三條 scenario
- [x] 6.4 已定址且來源為內部 producer 者於到達時直接接受：走**與手動接受相同的路徑**建立 session、
      記錄 session 識別碼、不進入待處理計數；單元測試驗證狀態為已接受且待處理計數不變
- [x] 6.5 釐清並實作「到達即接受者與待處理總量上限的關係」：`deliver()` 現有的 `CAPACITY` 閘以
      待處理則數為判準，而交接從不待處理 —— 決定它是否受該上限約束，把結論寫進 design 並以單元
      測試釘住（現況會讓它被一個它永遠不會進入的水位擋下，且檔案留在落點要等下次重啟才重掃）

## 7. 預填的兩條缺陷（獨立於本能力，但本能力把它們搬到了主幹上）

- [x] 7.1 事件回報未啟用時，到達的交接**不建立 session**、可見地說明；單元測試驗證 session 總數
      不變
- [x] 7.2 逾時退回待處理的 intake **保留它已建立的 session 的關聯**，再次處理時對既有那一個重試
      預填而不建第二個；單元測試驗證再次處理後 session 總數不變。**這條同時修掉手動 intake 上
      既有的同一個缺口**

## 8. 上限與降級

- [x] 8.1 **全域**滾動窗口計數（不以來源 session 為單位 —— 落點位置算得出來，輪流寫就繞過了），
      超過上限者降級為**待處理**而非拒絕；**上限與窗長經建構參數注入**（與 `maxPending` 同一個
      姿態，否則「達到上限」這個前提造不出來）；單元測試驗證超過之後為待處理、換一個來源落點
      不會重置、使用者接受它之後 session 正常建立

## 9. 呈現、通知與失敗可見

- [x] 9.1 收件匣中呈現交接的來源（含「來源 session 已結束」）與狀態（已接受者呈現它建立的
      session）；本文沿用既有的純文字呈現與長度上限，不另開一條路徑；以探針驗證已接受的交接
      其本文中的標記語法以字面文字呈現
- [x] 9.2 **`NotifyBackend.onActivate` 的介面變更**：現行簽章 `(handler: () => void)` 帶不了識別，
      「聚焦這則交接建立的 session」表達不出來。三個實作（electron / stub / 測試替身）一起改
- [x] 9.3 通知效果分流：已建立 session 者聚焦該 session 且不開啟收件匣、該 session 已關閉時為
      無操作（**且不改為打開收件匣**）；待處理者（含失敗項）沿用既有行為；**合併後批次中含任何
      待處理項者一律打開收件匣**；以探針驗證三條分流
- [x] 9.4 失敗可見：目標查無／歧義／folder 已移除／預填不可能發生／預填逾時，皆發通知並在收件匣
      留下可見項目，同一來源的重複失敗合併；**尚未被消費的解析失敗不發通知**（每次補寫都會再被
      讀到，逐次通知沒有上界）；以探針驗證「目標查無」有通知與收件匣項目、「內容不完整」無通知
- [x] 9.5 新增的使用者可見文案全部進 `src/shared/i18n/en.json`；`npm test` 的三道 i18n 守衛全綠

## 10. 偏好開關

- [x] 10.1 新增偏好欄位（預設啟用）。**不接 Settings UI，照 `agentEvents` 的先例** ——
      它同樣只是偏好檔裡的一個欄位、沒有對話框開關。加 UI 會動到 `terminal-preferences`
      （它以列舉方式規定對話框內容，且每個開關各有一條 requirement），而那是本 change 的
      Capabilities **沒有宣告**的第五個 delta。spec 要求的是「提供一個開關」，偏好欄位滿足它。
      **新欄位須經「白名單由單一來源推導」補齊三條路徑**（自磁碟讀入／部分更新時保留／
      送往 renderer，漏掉即型別檢查失敗）；驗收須**跨一次重新載入**並涵蓋「變更其他偏好之後
      此欄位仍在」
- [x] 10.2 關閉時不注入自我介紹、不建立投遞落點、既有落點內容不被處理；單元測試 ＋ 探針各驗一次
      「關閉後投遞不被處理」與「關閉它不影響事件回報」

## 11. 驗收

- [x] 11.1 探針：擴充 `scripts/probe-intake.mjs` 或新增 `scripts/probe-handoff.mjs` 覆蓋
      `agent-handoff-source` 的端到端路徑（替身 agent 寫投遞 → session 出現 → prompt 預填未送出 →
      焦點與 rail 選中項未改變）；新增探針須在 `scripts/lib/ports.mjs` 登記且 `npm test` 的重複
      檢查通過
- [x] 11.2 填寫 `scripts/intake-coverage.test.mjs` 的 scenario → 載體對照表並把本 change 登記進
      `COVERED_CHANGES`：**每一條「既有」都必須把那條斷言實際找出來**，找不到就寫「無載體」＋理由；
      守衛要求每個載體標籤真的存在於原始碼中
- [x] 11.3 為對照表中每一條填 `greenIfAbsent` 與 `mutation`。**下列已知為零實作即綠，各自要給一個
      真的改得到東西的 mutation，否則填「無載體」**：共用落點無法指定 folder（既有的未知欄位丟棄
      本來就成立）、焦點不被切走、session 已關閉時通知為無操作、告知不成立時 session 照常建立、
      投遞失敗時來源終端未被寫入
- [x] 11.4 **實際跑過**至少六個 mutation，各自確認指名的斷言變紅：合成改回覆蓋（＋順序）、目標改為
      前綴比對、payload 的目標欄位改為採信、到達即接受改為停在待處理、**焦點改為自動切到新
      session**、**通知效果改為一律打開收件匣**
- [x] 11.5 `npm run typecheck` ＋ `npm run lint` ＋ `npm test` 全綠
- [x] 11.6 `npm run test:e2e` 全套跑一輪，確認 13 支皆**完整執行**（總結中無「未執行」段落）

## 12. 文件

- [x] 12.1 新增 `docs/lessons/handoff.md`（或併入 `docs/lessons/intake.md`）記錄實測結論：
      0.1 的三項、hook 並存的驗證、落點一般化後兩邊共用的邊界與 `depth` 那個坑
- [x] 12.2 CLAUDE.md：「現況」段補一句交接能力，並在「踩雷指南」表格加上本 change 觸及的檔案 →
      對應 lessons 的觸發器
- [x] 12.3 `docs/PRD.md` §11 更新 Phase 7 的狀態（handoff 的第一段已交付，回程與 MCP 仍未做）
