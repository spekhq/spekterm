## 1. agent CLI 的補測

- [x] 1.1 以真實的 claude 實測 D0 的五條：以名字跨工作目錄送達、`--name` 可接受的字元與長度、`--name` 與 `--resume` 並用、同名行程仍在執行／名冊殘留時的行為（含「沒有輸出」能否重現）、agent 讀 userData 下的檔案是否觸發權限詢問。結論與版本寫進 `docs/lessons/handoff.md` 新的一節，連同 design Context 已測的四列。驗證：該節存在且每一列註明版本。**第 1 條不成立 ⇒ 停下來與使用者討論，不進第 5、6 組；第 5 條會詢問 ⇒ 先改 `session-lineage` 的 spec 與 design（加 `UserPromptSubmit` 注入）再繼續；其餘任一條與 D5 的假設相反 ⇒ 先改 spec 與 design**

## 2. 共用的判定

- [x] 2.1 `src/shared/session-existence.ts`：「存在」的純函式（D7），輸入為正規化過的狀態。驗證：單元測試表格涵蓋 —— 正常、休眠、已結束、所屬 folder 被移除、全域、暫定且 pty 活著、暫定且 pty 已死
- [x] 2.2 固定名字的純函式（D5）：前綴正規化（非 `[\p{L}\p{N}_-]` 換 `-`、收斂、去首尾、空則 `session`、全域 `global`）、短碼 4 碼起、不分大小寫的相撞延長、總長上限 64、恆以字母或數字開頭；另導出同一套規則的驗證函式。驗證：單元測試 —— `spekterm`、`簡報`、`---`、`a"b $(touch x)`、只差大小寫的兩個名稱、短碼相撞、超長名稱、驗證函式拒絕字元集之外的值

## 3. 來源的攝入（主行程）

- [x] 3.1 `intake-schema.ts`：`DeliveryProvenance`／`IntakeVerified` 加選填的 `source`（D1 的三態聯集）；載入收件匣時逐欄驗證，`sessionId` 以 `isUuid`，不合法只丟 `source`。驗證：`intake-schema.test.ts`／`intake-store.test.ts` 新增 —— 三種歸屬各自往返、不合法的識別碼與形狀錯誤的歸屬於載入時被丟棄而 record 保留
- [x] 3.2 `handoff-service.ts`：`deliverFile()` 以 `isUuid` 驗落點推出的識別碼，組出 `source`（標題經 `normalizeAuthored` 並以 code point 截斷）交給 `buildDelivery()`；`source` 不進 `digestOf`；`index.ts` 的 `sourceOf()` 改回傳足以組出三態的資訊。驗證：`handoff-service.test.ts` 新增 —— folder／全域／已結束三種、全域不含字面名稱、投遞內容自稱的來源不影響它、超長與含控制字元的標題被正規化截斷而交接照常被攝入、標題不同的同一份投遞仍是同一則

## 4. 建立、落盤與名字（主行程）

- [x] 4.1 `session-store.ts`：主行程專屬欄位 `lineage`、`peerName`；`RendererSession` 排除兩者；`replace()` 保留並認領暫定紀錄；新增暫定紀錄（`folderId`／`spawnTarget`／`lineage`／`peerName`）與「清除未被認領的暫定紀錄」；`parseSessionEntry` 逐欄驗證（`parentId`、三態歸屬、`peerName` 用 2.2 的驗證函式）；載入時替尚無名字（或名字不合法）的 claude session 決定名字並寫回；新增含暫定紀錄的讀取視圖。驗證：`session-store.test.ts` 新增 —— renderer 送來的兩欄被忽略、沒送時不被清除、暫定紀錄於 `replace()` 認領後合併、未被認領者被清除、不合法的 `parentId`／`peerName` 只丟該欄、載入時補上名字
- [x] 4.2 單次憑證：`ipc/intake.ts` 於送出自動接受推送時、`accept` 成功時簽發，綁定 record 主鍵、folder、claude 目標，記憶體保存、用過即刪、逾時失效；自動接受的推送與 `IntakeAcceptResult` 帶上它；`IntakeAutoAccept.tsx` 與接受路徑把它交給 `create()`。驗證：單元測試 —— 同一張用兩次第二次無效、folder 不符無效、shell 目標無效、逾時無效、了結過的 record 不會再被簽發（除非再次被接受）
- [x] 4.3 `ipc/terminal.ts` 的 create（與 preload）：收選填的憑證；只在建立新識別碼時讀取；**spawn 之前**寫暫定紀錄（`lineage` 取自 record 的 `source`、`peerName` 由 2.2 同步決定）；回傳值帶 `lineage`；renderer dispose 時清除未被認領的暫定紀錄。驗證：單元測試 —— 兩條建立路徑都寫入、帶 `sessionId` 的重建忽略憑證、同一則交接建兩個 session 兩者皆有來源、兩個並行的 create 名字不撞
- [x] 4.4 `terminal.ts`：`spawnArgs()` 成對產生 `SPEKTERM_PEER_NAME` 與 `--name="$SPEKTERM_PEER_NAME"`（不經 `composeInjection`）；shell 目標不帶；`ptyEnv()` 剝除所有 `SPEKTERM_*` 之後再合併本 session 的專屬變數；spawn 之前等同一個 sessionId 前一顆 pty 的 exit（有上限，逾時記錄後仍 spawn —— 依 1.1 第 4 條決定是否保留）。驗證：單元測試 —— 命令字串不含 folder 名稱與名字的值、注入全關時仍帶名字、`#heal()` 帶相同名字、外層的 `SPEKTERM_PEER_NAME`／`SPEKTERM_HANDOFF_DIR` 不進 pty、前一顆 pty 未結束時新的不 spawn；`terminal.test.ts:634-646` 的正規化改為同時替換 `--name=` 的值，並確認既有的「多一個旗標即破壞等價」對照組仍紅；`scripts/secret-scope.test.mjs` 仍綠

## 5. 關係檔與自我介紹

- [x] 5.1 新模組 `handoff-relations.ts`：由含暫定紀錄的 session 視圖、folder 清單與執行中集合，經 2.1 算出某個 session 的關係（D6 的形狀，含 `siblings`；不含識別碼與路徑欄位）。驗證：單元測試 —— 母 session 關閉、pty 自行結束、所屬 folder 被移除三種都呈現為 `closed`；歸屬未知時沒有 `repo`；休眠為 `running: false`；不存在的子 session 不列；兄弟不含自己、母 session 關閉後兄弟仍互列、關閉的兄弟不列；暫定而 pty 已死的不列；跨 folder 與全域的母子
- [x] 5.2 `refreshRelations()` 單一觸發點：接上 `SessionStore` 變動（含暫定紀錄）、pty 誕生（含喚醒與自癒）與結束（含自行結束與 dispose —— 掛在 `reason === 'disposed'` 提早 return 之前）、folder 清單變動、交接偏好變動（關閉時刪除全部）；範圍為所有 TerminalService 持有 pty 的 claude session；只寫有變的檔；原子寫入；`SPEKTERM_HANDOFF_RELATIONS` 隨交接的注入交付。驗證：單元測試 —— 新子 session 建立後（renderer 尚未送來清單）母 session 的檔案即含它且母 session 的 pty 未重建；dispose 之後「是否在執行」被刷新；關閉交接時檔案全部消失
- [x] 5.3 `handoff-intro.ts` 與 `handoff-injection.ts`：`IntroInput` 納入名字與關係檔路徑；新段落（D8，含「使用者送出第一則 prompt 之前不要傳訊息給剛交接出去的 session」）；`refreshIntros()` 改由 store 取名字。驗證：`handoff-intro.test.ts` 新增涵蓋 D8 各點；新增「folder 清單變動後重寫的自我介紹仍含名字與關係檔位置」；`handoff-intro-source` 守衛仍綠

## 6. renderer

- [x] 6.1 新純函式模組 `session-forest.ts`（D4）：偵測環、建樹（母 session 須存在且同項目，經 2.1）、DFS 攤平帶深度（上限 3）、兄弟群組與整塊範圍、整塊移動換算回單一順序、新子 session 的插入位置（母與其所有子孫中位置最後者之後）。驗證：`session-forest.test.ts` —— 三個以上兄弟帶子樹往下拖與往上拖、深度截斷、互為來源與自指的環皆為根、分頁列次序改變後的投影、母 session 不存在時回到根、子孫被拖到母之前時新子 session 的位置
- [x] 6.2 `sessions.tsx`：state 帶唯讀的 `lineage`（來自 restore 與 `create()` 的回傳，不送回持久化）；新增 `setOrder(folderId, ids)` 並檢查路徑上所有早退條件；依 `lineage` 放置新 session（D3）。驗證：`npm run typecheck`；7.1 的探針段落
- [x] 6.3 `WorkspaceRail.tsx`：session 子列以 `session-forest` 縮排；每個兄弟群組一個 `useDragReorder` 實例、`rectOf` 量整塊；`rowRefs` 與捲動 key 改以 session 識別碼為鍵；子列帶來源與子 session 兩種標示。驗證：`npm run probe:workspace` 與 `npm run probe:keyboard` 既有斷言全綠；7.1、7.2
- [x] 6.4 `SessionTabs.tsx`：分頁帶同樣兩種標示；來源標示觸發跳轉（不存在時為無操作並呈現快照與「已關閉」，歸屬未知時不顯示為全域）；子 session 標示一律以 `ContextMenu` 列出並跳轉；確認圖示字元在系統等寬字型內，否則以 CSS／SVG 繪製。驗證：7.1；`npm run probe:terminal` 與 `npm run probe:files` 全綠
- [x] 6.5 字典：`en.json`／`zh-TW.json` 新增來源標示、子 session 標示（含複數）、已關閉、全域項目名稱（若尚無）、無障礙標籤；探針的選擇器經 `copy.mjs` 取用。驗證：`npm test`（`dictionary-completeness`、`aria-label-source`、`copy-language`）通過

## 7. 驗收

- [x] 7.1 `probe-intake.mjs` 新段落 `runLineage`（替身 agent 另回報它每次啟動拿到的 `--name` 值與 `SPEKTERM_PEER_NAME`）：同 folder 與跨 folder 各交接一次 ⇒ 兩者都帶來源、**同 folder 那一則（母 session 尚未被持久化時投遞）的來源仍是那個 folder**、快照是 folder 名稱；每個 claude session 以落盤的名字啟動（argv 與環境變數一致）、前綴取自 rail 項目；母 session 的關係檔含啟動之後才長出的兩個子 session、子 session 查得到母 session 的名字、兄弟互列且不含自己、關係檔無識別碼；rail 上同 folder 縮排、跨 folder 頂層；兩端跳轉（子 → 母、母的選單 → 子）；關閉母 session ⇒ 子 session 回到頂層並標明已關閉、呈現快照、觸發為無操作、關係檔標明已關閉且兄弟仍互列；**以同一個 profile 重新啟動** ⇒ 關係與名字不變、快照仍在、喚醒時帶同一個名字、休眠的兄弟 `running: false`。驗證：`PROBE_ONLY=runLineage npm run probe:intake` 全綠。**改由單元測試承擔的**：同一張憑證用兩次（`session-create.test.ts`）、renderer 夾帶 lineage（`session-store.test.ts`）、未被持久化就失去 pty（`handoff-relations.test.ts`）、已結束與 folder 被移除的母 session（`existence.test.ts`／`handoff-relations.test.ts`）、攝入時已結束的來源（`handoff-service.test.ts`）。**無載體（對照表寫明理由）**：母 session 改名後標示更新、切換語言、全域快照以當下語言呈現
- [x] 7.2 `probe-intake.mjs` 新段落 `runLineageDrag`（種入 `sessions.json`，真滑鼠拖曳）：P（帶子 C）、X、Y 把 P 拖到 Y 之後 ⇒ 分頁列 X、Y、P、C；分頁列以 `Shift+←` 把 C 移到 P 之前 ⇒ rail 上仍縮排於 P 之下；Q 之下三個子 C1、C2、C3 往下拖 C1 ⇒ 分頁列與 rail 皆為 Q、C2、C3、C1；互為來源的兩個 session 皆呈現於 rail。驗證：`PROBE_ONLY=runLineageDrag npm run probe:intake` 全綠。「子孫被拖到母 session 之前時新的子 session 的位置」由 `session-forest.test.ts` 承擔（`placeChild` 的接線無載體，對照表寫明）
- [x] 7.3 名字的邊界由單元測試承擔：自癒沿用名字、shell 不帶名字、注入全關仍帶名字、命令字串不含名字的值且不經 shell 再解析（`terminal.test.ts`）；前一顆 pty 結束之前不啟動新的（`terminal.test.ts`，對照組確認會紅）；字元正規化、相撞延長、不分大小寫（`peer-name.test.ts`）；`簡報` 與含 `"`、`$(...)` 的名稱（同上）。驗證：`npm test` 全綠
- [x] 7.4 `scripts/intake-control-groups.mjs` 新增 mutation，每一條都是**單一檔案、單一處替換**，標明 `command: 'test'` 或 `section: 'runLineage'`，並指名必須變紅的斷言：
  - `ticket-reusable`（憑證用後不刪）
  - `ticket-on-restore`（重建時也讀憑證）
  - `lineage-after-spawn`（暫定紀錄在 spawn 之後才寫，`command: 'test'`，載體為 4.3 的「spawn 時自我介紹已含母 session」）
  - `lineage-from-renderer`（`replace()` 採信 renderer）
  - `snapshot-at-create`（快照改取 create 當下的 store）
  - `origin-null-for-unknown`（未知歸屬寫成全域）
  - `relations-skip-pending`（不含暫定紀錄）
  - `relations-no-exit-refresh`（pty 結束的掛點移到 disposed 之後）
  - `intro-refresh-drops-name`（`refreshIntros` 不帶名字）
  - `name-via-injection`（名字改由 `composeInjection` 交付 ⇒ 注入全關時無名字）
  - `env-not-stripped`（`ptyEnv` 不剝除 `SPEKTERM_*`）
  - `name-at-first-spawn`（名字延後到 spawn 才決定 ⇒ 休眠 session 無名字）
  - `child-appended-last`、`place-after-last-descendant`（以最後一個子孫為準）
  - `drag-single-row`（`rectOf` 只量單列）
  - `cycle-hidden`（不偵測環）
  - `exited-parent-exists`、`siblings-include-self`、`siblings-need-parent`

  跨檔或多點的缺陷各自寫成等價的單點形狀（見 `docs/lessons/intake.md`「跨兩個檔案的缺陷」）。驗證：`node scripts/intake-control-groups.mjs` 每一條如預期變紅，`control-groups-source.test.mjs` 為綠

## 8. 對照表與文件

- [x] 8.1 `scripts/scenario-coverage.test.mjs`：`COVERED_CHANGES` 加 `handoff-lineage`；本 change 每一條 scenario 各一列，逐條找出載體與 `greenIfAbsent`／`mutation`（「降級為待處理後接受，快照是攝入當下的」以 3.2 的單元測試為載體 —— 母 session 存在時畫面上看不到快照）；「真實 agent 依說明讀關係檔並以名字送出訊息」「真實 agent CLI 以指定的名字固定標題」列為無載體並寫明由 dogfood 與 1.1 的實測認定。驗證：`npm test` 通過
- [x] 8.2 文件：`docs/lessons/handoff.md` 補關係檔的時序理由、「關係在 spawn 之前寫入」與單次憑證的理由、`--name` 的依賴與換版重測項、`/rename` 會暫時改掉名字、peer 訊息會被誤判為「已送出」；`docs/lessons/terminal.md` 在「pty 誕生時要做的事」補名字一例，並記下 `SPEKTERM_*` 的外洩與剝除；`CLAUDE.md` 現況的「交接」一段改寫（母子關係與固定名字已交付、回程改以 agent CLI 的訊息功能達成、分頁標題固定為名字）與 `probe:intake` 的段落與 mutation 數；`docs/PRD.md` §11 對應項目。驗證：文件所述的段落名與 mutation 數與腳本一致
- [x] 8.3 `npm run typecheck`、`npm run lint`、`npm test` 全綠；`npm run test:e2e` 全綠且每支完整執行
