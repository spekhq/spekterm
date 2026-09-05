## 1. 字面線索的降格（不依賴任何新東西，先做完並保持全綠）

- [x] 1.1 `src/shared/insights/tone-rules.json` 改名為 `cue-rules.json`，六個 key 改為描述字面特徵
      （`questionMark` / `imperativeOpener` / `correctionTerm` / `tentativeTerm` / `politeTerm` /
      `ackOnly`）；驗證 `npm run typecheck` 通過且既有的語氣單元測試以新 key 全綠
- [x] 1.2 `insights-aggregate.ts` 的 `classifyTone` / `ToneCategoryView` / `DEFAULT_TONE_RULES`
      與 `Insights.tone` 欄位隨之更名為 cue 系列；驗證
      `grep -rn 'classifyTone\|ToneCategoryView\|ToneClause\|DEFAULT_TONE_RULES\|insights\.tone' src/`
      不再命中。**不要驗 `grep tone`** —— `tone` 在這個 repo 是顏色變體的 prop
      （`charts.tsx:20` `Bars({ tone = 'accent' })`，另有五個檔案在用），那條驗證只有兩種收場：
      改一個無關的 prop，或沒做就打勾
- [x] 1.3 `src/main/insights.test.ts:84–88` 直接讀 `snapshot.insights.tone`，隨易名更新；
      驗證 `npm test` 全綠
- [x] 1.4 **新增「都沒中」的計數**（現行實作沒有這個量，`insights-aggregate.ts:314–352` 六類各自
      累加、回空陣列時不留痕跡）：納入 `Insights`；驗證新增的單元測試斷言
      **有命中的相異訊息數 ＋ none ＝ 使用者訊息總數**
- [x] 1.5 **對照組**：把 `none` 的累加拿掉，確認 1.4 的測試變紅後再放回；記入 design.md
- [x] 1.6 `src/shared/i18n/en.json` 的第九個視圖標題與說明改為字面線索的措辭
      （標題不得宣稱在呈現語氣），並補上「都沒中」那一列的文案；驗證三道 i18n 守衛全綠
- [x] 1.7 `InsightsOverlay.tsx` 的 `ToneList`（`:366`）與 `ToneRule`（`:404`）隨之更名並呈現
      「都沒中」那一列。**不是 `charts.tsx`** —— 那支只有 `Bars / Histogram / Marks / Heatmap /
      Proportion`；驗證單段 `PROBE_ONLY` 跑 overlay 段落，第九個視圖標題不含語氣字樣且
      「都沒中」可見
- [x] 1.8 **補上「分類規則對使用者可見」的探針斷言** —— 該 scenario 目前**零載體**
      （`ToneRule` 有渲染，但沒有任何探針在看；`insights-aggregate.test.ts:157` 驗的是資料帶著
      詞表，不是畫面上讀得到）；驗證斷言同時要求規則說明的文案與詞表中的某個字面詞出現在畫面上

## 2. 掃描與呈現排除委派留下的紀錄（必須早於第 3 組）

- [x] 2.1 在 `src/main/insights-source.ts`（唯一知道 userData 的模組）新增委派工作目錄的
      **單一來源**：`<userData>/<固定 basename>`；驗證單元測試斷言排除規則由該 basename 推導
- [x] 2.2 排除的判定寫成「專案目錄名的編碼形態**以該固定 basename 結尾**」，
      **不綁單一絕對路徑**；驗證單元測試同時餵入 dev（`spekterm-dev`）與產物（`Spekterm`）
      兩種 userData 推導出的目錄名，斷言**兩者都被排除**
      —— 綁單一路徑的話，在 dev 按一次讀後感會弄髒正式產物的數字，而同一安裝內的驗收必綠
- [x] 2.3 `transcript-archive.ts:244` 的來源迴圈套用排除（`rel.split(path.sep)[0]` 已經是專案
      目錄名）；驗證單元測試以一個該編碼的目錄為輸入，斷言掃描不讀入它
- [x] 2.4 **掃描主動刪除既有存檔中符合排除條件的檔案** —— 只擋來源迴圈不夠，呈現走
      `readArchive()`（`insights.ts:42–43`）而孤兒政策是「什麼都不做」
      （`transcript-archive.ts:310–319`）；驗證單元測試先造一份該編碼的存檔，
      斷言掃描後它消失且 `snapshot.insights.totals.messages` 不含它
- [x] 2.5 排除值送進掃描行程：`ScanRequest` 的型別（`insights-worker.ts:23`）、
      **`handleWorkerMessage` 的逐欄位驗證**（`:41`）、`insights-service.ts` 的型別、
      `insights.ts:69` 組請求處；驗證單元測試斷言少傳該欄位時回 `scanFailed`
      —— **漏掉驗證那一行的後果是靜默的**：`undefined` → 排除整個失效，而掃描照樣回一個
      看起來正常的結果
- [x] 2.6 **對照組**：拿掉排除，確認 2.3／2.4 的測試變紅（`totals.messages` 變多）後再放回；
      記入 design.md
- [x] 2.7 `transcript-fixture.testkit.ts` 的 `writeTranscriptFixture` 增一個「委派工作目錄」參數，
      並增加一個該編碼的專案目錄與其紀錄；`facts` 拆成**磁碟上的總則數**與**應被掃到的則數**
      兩個值；驗證 `transcript-fixture.test.ts:87/:92` 的獨立重算仍成立
- [x] 2.8 `probe-insights.mjs:163–165` 改為先 `seedProfile()` 再 `writeFixture()`，
      把 app 的 userData 餵進 fixture；**對照組在探針層也做一次**（拿掉排除，第一段的已知數值
      要變紅）；驗證 `probe-insights.mjs:200` 的專案標籤斷言不因新目錄被排除而誤紅

## 3. 委派與報告的核心（主行程，不 import electron）

- [x] 3.1 語料組裝：依範圍取使用者訊息、**自最舊端截斷**至 600,000 字元、回傳實際涵蓋期間與
      `aggregate()` 的彙總量；驗證單元測試斷言超限時期間隨之縮小，且**不是抽樣**
      （截斷後的最舊一則時間 > 未截斷的最舊一則）
- [x] 3.2 **匯出單一個正規化函式**（收斂連續空白、去頭尾空白），語料與引用兩側套用同一個；
      驗證單元測試以「語料含換行與全形空白、引用是收斂後形式」為正例
      —— 兩側不同函式會讓全部查證失敗，而那會落進「全部論斷被丟棄」這個規格已定義的合理狀態
- [x] 3.3 引用查證：**比對單位為單一則訊息**（不是串接後的語料）、查不到即丟棄並計數、
      查得到則從存檔取日期與專案、**命中多則取最早並記錄則數**；驗證單元測試涵蓋
      「引用不存在→丟棄」「引用存在→保留」「跨越兩則邊界→丟棄」
      「同一句話出現在兩個專案→取最早並呈現則數」「委派回錯日期→採用存檔的值」
- [x] 3.4 **對照組**：拿掉 3.3 的查證，確認「引用不存在」那條變紅（該論斷會出現在報告裡）；
      記入 design.md。**這是本 change 唯一的守衛，沒有這個對照組等於沒做**
- [x] 3.5 上限與順序：引用 ≤ 60 字元、**引用只取自 ≤ 200 字元的訊息**、
      **先查證後截取前 20 條**、丟棄數只計查證失敗；驗證單元測試以「25 條進、8 條查不到」
      的替身斷言丟棄數為 8（而非 20），並斷言長訊息不成為引用來源
- [x] 3.6 報告中的專案以**不可逆識別與顯示名稱**呈現，經 `identifyProjects()` 而非直接用
      `MessageRow.p`；驗證單元測試把報告的 IPC 回傳與落盤內容各 dump 一次，
      斷言不含 fixture 的 `dirName`（比照 `insights.test.ts:66`，但那條只 dump
      `InsightsSnapshot`，涵蓋不到報告）
- [x] 3.7 `ReportRunner`（比照 `ScanRunner`）：注入 `spawn`、單一併發、可注入計時器、
      **逾時 15 分鐘**、狀態 `idle | running | failed`、**只回錯誤碼**；驗證單元測試涵蓋
      重複觸發回報進行中、逾時、行程提前結束三種路徑
- [x] 3.8 回覆解析：容許剝除 markdown 圍籬，解析失敗即整份失敗；驗證單元測試斷言
      解析失敗時**不產生任何報告**（不是半份）
- [x] 3.9 委派紀錄刪除：由回覆的 `session_id` 與設定目錄算出路徑並刪除；
      **刪除結果（已刪除／未能刪除）記入報告**；驗證單元測試在真實暫存目錄先造一個假紀錄，
      斷言成功時它消失且報告記為已刪除，失敗時報告仍產出且記為未能刪除
- [x] 3.10 報告落盤於 userData、歷次並存、目錄與檔案僅限擁有者；驗證單元測試斷言
      產生第二份後第一份仍可讀取，並以 `fs.statSync` 檢查權限位元
- [x] 3.11 六種失敗（CLI 不存在／委派回報失敗／逾時／解析失敗／全部論斷被丟棄／
      **委派嘗試使用工具**）為相異的錯誤碼；驗證單元測試逐一觸發並斷言六者互不相同
- [x] 3.12 錯誤不含外部行程原始輸出；驗證單元測試以帶絕對路徑的替身輸出觸發失敗，
      斷言回傳值中不含該路徑
- [x] 3.13 報告記錄產生時間、實際涵蓋期間、**所請求的模型**、則數與字元數、丟棄數、
      刪除結果、費用；驗證單元測試斷言這些欄位齊備且模型欄位取自請求端而非回覆

## 4. Electron 接縫（唯一需要 electron 的部分）

- [x] 4.1 實際的 `spawn`：cwd 為 2.1 的路徑、關閉所有工具、`--output-format json`、
      PATH 取自既有的 `user-env.ts`；驗證斷言寫成**跨兩端的等式**
      `encodeProjectDir(觀察到的 spawn cwd) === 掃描實際使用的排除判定所命中的形態`
      —— 兩端讀同一個常數的斷言在結構上不可能紅
- [x] 4.2 IPC handlers（列出報告／讀取一份／產生一份，帶授權旗標）並於
      `src/main/index.ts:170–190` 接上服務；驗證 `probe:insights` 能經 preload 取得報告清單
- [x] 4.3 preload 的 `insights` 命名空間增加報告相關方法，並**在
      `scripts/probe-shell.mjs` 新增 `surplusInsightsKeys` 逐成員清單**（`fs`／`settings`／`panel`
      都有，`insights` 目前沒有 —— 只在命名空間清單裡登記的話，底下加幾個方法 probe:shell
      都是綠的）；驗證拿掉清單中的一項會讓 `probe:shell` 變紅

## 5. 介面

- [x] 5.1 overlay 分為「數字」與「讀後感」兩個分頁，共用同一入口，切換不觸發委派；
      驗證 `probe:insights` 斷言兩者不同時呈現、且切到報告分頁後未產生新報告
- [x] 5.2 授權對話框：呈現期間／專案數／則數／字元數與「送出的是你打的字」的說明，
      **這些數字取自截斷之後實際將送出的那一份**；驗證 `probe:insights` 斷言其數字與報告上
      記錄的那一組相同，且 fixture 的長訊息原文不出現於該畫面
- [x] 5.3 報告清單與內容：產生時間、實際涵蓋期間、所請求的模型、則數與字元數、
      **被丟棄的條數**、**紀錄刪除結果**、費用；驗證 `probe:insights` 斷言這些欄位存在
- [x] 5.4 六種失敗各自的呈現，且「全部論斷被丟棄」不與「空報告」混淆；
      驗證 `probe:insights` 斷言前者有專屬訊息
- [x] 5.5 儀表板範圍與報告涵蓋期間不同時兩者各自可辨識；驗證 `probe:insights` 斷言
      兩個期間標示同時可讀取
- [x] 5.6 全部新文案進 `src/shared/i18n/en.json`，`aria-label` 避開引號字元；
      **委派的提示詞一律以英文撰寫** —— 它是 `.ts` 的字串字面值，而
      `copy-language.test.mjs` 走 AST 禁止產品原始碼出現 CJK 字面值；驗證三道 i18n 守衛全綠

## 6. 驗收

- [x] 6.1 `scripts/probe-insights.mjs` 新增報告分頁的段落。**前置宣告為「overlay 已關閉」**
      —— `runOverlayContract` 的最後一件事是按 Esc 並斷言關閉（`:236–249`）；
      替身委派以注入方式提供；驗證單段 `PROBE_ONLY` 跑得過
- [x] 6.2 **在報告分頁與授權畫面各重跑一次「沒有瀏覽全部訊息內文的入口」**
      —— 既有那條讀 `dialog.innerText`（`:105–115`），而 `innerText` 不含隱藏元素，
      分頁一做它就從「整個 overlay」縮成「當下這一個分頁」而**照樣全綠**；
      驗證切到報告分頁後該斷言仍執行
- [x] 6.3 逐條核對 design.md 對照表：每一條標「新增」的 scenario 都要指得出實際的斷言，
      **核對方式是開檔案讀那一行的字串**，不是憑印象確認一個看起來合理的行號
      （這張表的第一版就是這樣錯了四條）；指不出來的改寫為「無載體」＋理由
- [x] 6.4 `npm run test:all` 全綠（單元 ＋ 九支探針）；不完整執行的那一輪不算
- [x] 6.5 **dogfood 真實委派**：以實際的 `claude` 跑一份報告，確認報告產得出來、
      引用查得到、丟棄數合理、紀錄刪除成功，且**該趟的紀錄沒有出現在下一次掃描的數字裡**。
      **已執行**（2026-09-06，dev、`claude-sonnet-5`）：3,952 則 / 171,371 字元 / 26 個專案、
      丟棄 0 條、$0.81、委派紀錄已刪除、20 條論斷全部引用得到原句。
      **品質不滿意，缺口轉為 issue #37**（harness 的中斷字樣進了語料；20 條裡 12 條的引用
      只出現過一次）

## 7. 文件

- [x] 7.1 `docs/lessons/transcript.md` 增加一條：`claude -p` 的指令與 stdin 會被串成同一則
      **沒有 `isMeta`** 的 user 記錄，因此委派會污染它自己分析的資料；附實測日期與 CLI 版本
- [x] 7.2 `CLAUDE.md` 的踩雷指南觸發器補上報告相關檔案；驗證 naming 與 copy 守衛全綠
- [x] 7.3 `docs/PRD.md` 更新 /insights 的範圍描述（兩個分頁、質性那半由委派承擔）
