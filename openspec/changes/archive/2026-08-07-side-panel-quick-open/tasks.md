## 1. 主行程：受邊界約束的遞迴列舉

- [x] 1.1 於 `fs-service.ts` 新增 `listFiles(folder, relPath)`：走**與 `listDir` 相同**的邊界判定，回傳 **folder-relative** 的檔案路徑清單（**不是**相對於 `relPath` —— 見 design D10），只含檔案
- [x] 1.2 主路徑以 `git ls-files --cached --others --exclude-standard **-z**` 列舉；**`-z` 是必要的**（預設 `core.quotePath=true` 會把非 ASCII 檔名 C-quote 成亂碼，且它順帶解決檔名含換行）
- [x] 1.3 以**非同步 `execFile`** 執行，並設 `timeout` 與 `maxBuffer`。**照抄的先例是 `src/main/ipc/settings.ts` 的 `fc-list`，不是 `agent-status.ts`**（後者是 `spawnSync`，正是 design D2 禁止的）；`fc-list` 那處沒設 `maxBuffer`，這一項要自己補
- [x] 1.4 失敗判準定死：**只有**「不在版控之下」（exit 128 且 stderr 指出 not a git repository）退回保守列舉；**逾時與輸出過大一律回報錯誤**（在 git repo 上退回會讓巢狀 worktree 全部湧入，而使用者只看到清單變長）
- [x] 1.5 git 成功但輸出為空 ⇒ 目標整個被版控忽略 ⇒ 改以保守列舉回傳（實測：在被 `.gitignore` 涵蓋的目錄裡 `rc=0` 且無輸出，與「真的沒檔案」在 exit code 上無法區分）
- [x] 1.6 保守列舉（退回路徑）**手寫遞迴，只在 `dirent.isDirectory()` 為真時下鑽** —— **不得用 `readdirSync(dir, { recursive: true })`**，它會走進 symlink 目錄，而 `isWithin` 是字面比較必定放行 ⇒ 邊界外的檔名進入 renderer（與 chokidar `followSymlinks` 是同一道側門）。忽略清單：`.git` / `node_modules` / `out` / `dist` …
- [x] 1.7 git 的輸出**逐筆過邊界判定**後才回傳 —— 邊界保證的來源是我們自己的判定，不是來源程式的性質
- [x] 1.8 `ipc/fs.ts` 新增 `fs:listFiles` handler，回傳既有的 `FsResult<T>` 形狀
- [x] 1.9 `preload/index.ts` 的 `fs` 白名單新增 `listFiles`

## 2. 主行程的單元測試（`src/main/fs-service.test.ts`）

- [x] 2.1 遞迴、座標系與種類：多層子目錄的檔案皆在清單中、**每個項目為 folder-relative 且可直接餵給 `readFile`**、清單不含目錄
- [x] 2.2 symlink：fixture 內含①指向 folder **之外**的 symlink 目錄 ②指向 folder **之內**另一目錄的 symlink。斷言①之下的檔案不在清單中、②之下的每個檔案恰好出現一次
- [x] 2.3 **2.2 的對照組**：把保守列舉改回 `readdirSync(recursive: true)`，2.2 必須變紅（否則這條防線只是註解）
- [x] 2.4 邊界：絕對路徑／`..` 逃逸／越界 symlink 作為 `relPath`／未註冊的 `folderId` 一律拒絕
- [x] 2.5 非 ASCII 檔名以原始形式回傳，且以它呼叫 `readFile` 讀得到內容（**對照組**：拿掉 `-z` 必須變紅）
- [x] 2.6 排除：`git init` 的 fixture，於其**自身之內** `git worktree add`，斷言清單不含該 worktree 之下的檔案；另建被 `.gitignore` 的目錄，斷言其中的檔案不在清單中
- [x] 2.7 **2.6 的對照組**：把實作改回天真的遞迴，2.6 必須變紅 —— 巢狀 worktree 那條若沒有鑑別力，整組排除規則等於沒驗
- [x] 2.8 退回路徑：非 git 目錄仍回傳可用清單且不含 `node_modules`；目標整個被 `.gitignore` 涵蓋時**仍回傳其下的檔案**（不是空清單）
- [x] 2.9 失敗：目標不存在／目標是檔案 → 回報錯誤而非空清單；**逾時 → 回報錯誤，且不得改以保守列舉回傳**
- [x] 2.10 **不阻塞主行程**：呼叫 `listFiles` 前排入一個計時器，斷言它**於列舉完成之前**即被執行。**不得改用「攔截 `child_process` 的同步匯出、斷言未被呼叫」** —— ESM 具名匯入不經屬性查找，攔截攔不到它（實測），那條斷言在同步實作下照樣是綠的
- [x] 2.11 **2.10 的對照組**：把實作換成同步版本，2.10 必須變紅

## 3. renderer：模糊比對（純函式）

- [x] 3.1 新增 `src/renderer/src/shell/quick-open/score.ts`：子序列比對（不分大小寫、不要求連續）＋ 評分（檔名段命中權重高於路徑中段、連續命中加分、詞邊界加分、長路徑輕微懲罰），未命中回傳明確的「不命中」值
- [x] 3.2 新增 `score.test.ts`（`test:unit` 的 glob 已涵蓋此路徑）：不連續片段命中、**檔名命中排在路徑中段命中之前**、不分大小寫、不命中的判別
- [x] 3.3 排序與取前 N 的挑選邏輯與評分分離，使兩者可各自測試

## 4. renderer：quick open 的介面

- [x] 4.1 新增 quick open overlay 元件：以 `createPortal` 掛到 `document.body`、`role="dialog"`、錨定於畫面上方中央
- [x] 4.2 查詢輸入欄位、結果清單、當前選取的視覺標示；選取移動時**捲入可視範圍**
- [x] 4.3 **呈現的路徑剝去工作目錄前綴，而項目持有的權威值仍是完整的 folder-relative 路徑**（沿用 `paths.ts` 的既有模式）
- [x] 4.4 鍵盤操作：`↑`／`↓` 移動選取（清單為空時無操作）、`Enter` 開啟、`Esc` 關閉
- [x] 4.5 空查詢時呈現範圍內的檔案（可截斷至前 N）；無相符時呈現說明訊息；列舉失敗時呈現錯誤說明（**三者不得共用一個沒有說明的空白區域**）
- [x] 4.6 開啟時取得清單（每次重取，不快取）；開啟期間清單為靜態
- [x] 4.7 **焦點歸還**：開啟前記住 `document.activeElement`，關閉時還原；該元素已消失則退回側欄容器
- [x] 4.8 **側欄容器加 `tabIndex={-1}`** —— 它目前是一個沒有 `tabIndex` 的 `<section>`，`.focus()` 對它是 **no-op**，於是 4.7 的退路會讓焦點掉到 `<body>`。而「開啟檔案」正是那個記住的元素必然消失的路徑（樹被 `FileViewer` 換掉），退路在最常走的那條路上才會被用到

## 5. renderer：觸發與整合

- [x] 5.1 **把 `worktreeKey` → `rootPrefix` 的解析上提**至兩個身分共同的上游（`MainStage` 或一個共用 hook），`SidePanel` 改為接收解析結果 —— 它目前住在只於 Files 身分渲染的 `FilesPanelForFolder` 裡，而入口在 OpenSpec 身分也要能用；不上提就只能在 `MainStage` 再解析一次，那正好違反「兩者 SHALL NOT 各自解析」
- [x] 5.2 於 side panel 的容器掛上 **capture 階段**的 `keydown` listener 處理 `Ctrl+P`，並 `preventDefault()` ＋ `stopPropagation()`
- [x] 5.3 **document-wide** 存在 `[role="dialog"]` 或 `[role="menu"]` 時不生效，且不 `preventDefault`（按鍵照常抵達對話框）。**作用域不得收窄為「側欄之內」** —— `VizOverlay` portal 到 body 且**不移動焦點**，開啟它的按鈕在側欄裡，於是觸發條件恰好成立；判準與作用域皆與 `KeyboardNavigation.tsx` 相同
- [x] 5.4 沒有可搜的工作目錄（側欄來源未選定）時為無操作；**判準是「有沒有可搜的工作目錄」，不是「rail 選了什麼」**
- [x] 5.5 搜尋範圍取自 5.1 解析出的工作目錄根（與 Files 樹的根**同一個值**）
- [x] 5.6 選取確認後把項目的**完整 folder-relative 路徑**交給既有的 `MainStage.openFileFromOpenSpec`（切身分、展開側欄、解析所屬工作目錄），並關閉入口

## 6. 文案與守衛

- [x] 6.1 新文案入 `src/shared/i18n/en.json`（輸入框的 placeholder、無相符、列舉失敗、入口的 `aria-label`）
- [x] 6.2 元件內所有可見文字與 `aria-label` 皆自字典取用（三道既有守衛：CJK、硬編 `aria-label`、key 的型別安全）
- [x] 6.3 新元件不得寫死字級（`scripts/typography.test.mjs` 掃整個 renderer 的 `.tsx`／`.ts`／`.css`）

## 7. 驗收：`probe:shell`

- [x] 7.1 白名單守衛的 `fs.*` 清單加入 `listFiles` —— 這同時是 `filesystem-access` 那條 **MODIFIED** scenario（介面上的能力清單）的載體

## 8. 驗收：`probe:keyboard`（觸發、鍵盤操作、焦點歸還）

> 選擇器一律自 `scripts/lib/copy.mjs` 取字串，不得硬編文案。

- [x] 8.1 覆蓋「檔案樹持有焦點時開啟入口」與「編輯器持有焦點時開啟入口」。**不要補上「編輯器未插入任何字元」之類的條件** —— 該按鍵在 Monaco/Linux 本就不插入字元，那種斷言在攔與不攔時同樣通過
- [x] 8.2 覆蓋「終端持有焦點時讓路給 pty」：入口未開啟，**且**該按鍵抵達了 pty —— 兩條都要，只驗前者的話一個「攔截但不開啟」的錯誤實作照樣通過
- [x] 8.3 **對照組**：暫時拿掉焦點判定改為無條件攔截，8.2 必須變紅
- [x] 8.4 覆蓋「以方向鍵移動選取並以 `Enter` 開啟」與「以 `Esc` 關閉且不開啟任何檔案」
- [x] 8.5 覆蓋「關閉後可再次以同一顆快捷鍵開啟」與「開啟檔案後可再次以同一顆快捷鍵開啟」—— **必須連開兩次**，只驗一次的話焦點沒還回去也會通過
- [x] 8.6 「側欄來源未選定時無操作」與「全域項目的側欄來源指向某個 repo 時正常運作」**改由 `probe:openspec` 承載**（見 9.8）—— 它的 runMode 尾段本來就在操作全域項目與來源選擇器，那正是這兩條需要的狀態；在 `probe:keyboard` 另寫一套 `PanelSourceBar` 下拉互動是重複投資
- [x] 8.7 聚焦手段為**側欄容器本身**（它帶 `tabIndex={-1}`）—— 該狀態下側欄沒有 treeitem 可聚焦，而點來源選擇器會開一個 `role="menu"`，那本身就會讓快捷鍵讓位、使斷言失去鑑別力
- [x] 8.8 覆蓋「開啟期間再次按下快捷鍵不清空查詢」
- [x] 8.9 新段落插在既有段落**之後**、內部使用**相對數字**（既有紀律：寫死絕對數字會被前面段落的淨變化打破）

## 9. 驗收：`probe:openspec`（範圍、巢狀 worktree、跨身分）

- [x] 9.1 覆蓋「切換工作目錄後範圍隨之改變」（fixture 已有 `.claude/worktrees/wt-inside`）
- [x] 9.2 覆蓋「切換側欄來源後範圍隨之改變」
- [x] 9.3 覆蓋「呈現的路徑不含工作目錄前綴」：於 worktree 為根時，斷言項目呈現的路徑不以該 worktree 的前綴開頭，**且**選取後開啟的是該 worktree 之下的那一份（fixture 的 `openspec/specs/auth/spec.md` 在主工作目錄與 `wt-inside` 皆存在，是現成的鑑別對象）
- [x] 9.4 覆蓋「巢狀工作目錄的檔案不重複出現」：以**主**工作目錄為根查詢上述同名檔案，斷言恰好一筆且路徑不在該 worktree 之下。**查詢必須窄到結果不受前 N 截斷影響**，否則一個會產生重複項的實作也會通過
- [x] 9.5 覆蓋「自 OpenSpec 身分開啟檔案」：側欄為 OpenSpec 身分時選取一個檔案，斷言切換至 Files 且呈現該檔內容
- [x] 9.6 覆蓋「全視窗 overlay 開啟時按下快捷鍵」：自側欄開啟 Graph／Timeline overlay 後送 `Ctrl+P`，斷言入口未出現且 overlay 維持開啟（**對照組**：把 5.3 的作用域收窄為側欄子樹，這條必須變紅）
- [x] 9.7 段落結束時還原側欄狀態（身分、工作目錄）—— 不還原會讓後續既有段落整段變紅，看起來像那一段壞了
- [x] 9.8 於既有的全域項目段落覆蓋「側欄來源未選定時無操作」與其**正向對照**「全域項目的來源已指向某個 repo 時正常運作」—— 少了正向那條，一個「永遠無操作」的實作也會通過

## 10. 驗收：`probe:files`（對話框抑制、清單時效、目錄）

- [x] 10.1 覆蓋「命名對話框開啟時按下快捷鍵」：入口未出現、對話框維持開啟（**此缺陷為真** —— 該對話框渲染於側欄子樹之內，觸發條件恰好成立）
- [x] 10.2 覆蓋「無相符項目時呈現說明」
- [x] 10.3 覆蓋「開啟期間新建的檔案不出現，關閉再開啟後出現」
- [x] 10.4 覆蓋「目錄不出現在結果中」

## 11. 收尾

- [x] 11.1 `npm run typecheck`（看 exit code，不要用 `head` 截斷輸出）
- [x] 11.2 `npm run lint`
- [x] 11.3 `npm test`
- [x] 11.4 逐支跑受影響的探針：`probe:shell` 19/19、`probe:keyboard` 200/200、`probe:openspec` 436/436、`probe:files` 111/111
- [x] 11.5 `npm run test:all`（封存前的完整驗收）—— **9/9 全部通過**，1142 條斷言 0 失敗
- [x] 11.6 更新 `CLAUDE.md`：快捷鍵表新增 `Ctrl+P`、路線圖新增本 change 的條目、記下實測踩雷（巢狀 worktree 的列舉、`core.quotePath`、對話框未 portal、`VizOverlay` 不搶焦點、ESM 具名匯入攔不到、`collapsible` 收合時子樹仍掛載）
- [x] 11.7 archive 時確認 `keyboard-navigation` 的 Purpose 是否仍然準確（本 change 判定**不需要改** —— 它描述的是該能力自己的兩組快捷鍵；此條是要求下一個人重新確認，不是要求修改）—— **已確認：Purpose 描述的是該能力自己的兩組快捷鍵，「攔截必須早於 xterm」對它們仍然成立，不需修改**
- [x] 11.8 dogfood：由使用者實際操作確認可用，再行封存 —— **已確認可用**

---

## 驗收對照表

**每一條新增或修改的 scenario 都必須在此有一個載體，或明寫「不覆蓋」與理由。** 這個 repo 已在
同一處栽過四次 —— `openspec validate --strict`、delta 與主 spec 的 header 稽核、探針全綠**三道都
攔不住**「補了 scenario 卻沒有人在看它」。

### `quick-open`（24 條 ADDED）

| Scenario | 載體 |
|---|---|
| 檔案樹持有焦點時開啟入口 | 8.1 |
| 編輯器持有焦點時開啟入口 | 8.1 |
| 終端持有焦點時讓路給 pty | 8.2（＋ 8.3 對照組） |
| 呈現的路徑不含工作目錄前綴 | 9.3 |
| 切換工作目錄後範圍隨之改變 | 9.1 |
| 切換側欄來源後範圍隨之改變 | 9.2 |
| 巢狀工作目錄的檔案不重複出現 | 9.4（＋ 2.6／2.7 於單元測試層） |
| 版控忽略的內容不出現 | 2.6（單元測試層。**probe 層不覆蓋** —— 需要一個帶 `.gitignore` 與建置產物的 fixture，成本高於其鑑別力） |
| 目錄不出現在結果中 | 10.4（＋ 2.1） |
| 以不連續的片段命中 | 3.2 |
| 檔名命中排在路徑中段命中之前 | 3.2 |
| 無相符項目時呈現說明 | 10.2 |
| 以方向鍵移動選取並以 Enter 開啟 | 8.4 |
| 以 Esc 關閉且不開啟任何檔案 | 8.4 |
| 自 OpenSpec 身分開啟檔案 | 9.5 |
| 關閉後可再次以同一顆快捷鍵開啟 | 8.5 |
| 開啟檔案後可再次以同一顆快捷鍵開啟 | 8.5 |
| 側欄來源未選定時無操作 | 9.8 |
| 全域項目的側欄來源指向某個 repo 時正常運作 | 9.8（正向對照） |
| 命名對話框開啟時按下快捷鍵 | 10.1 |
| 全視窗 overlay 開啟時按下快捷鍵 | 9.6（＋對照組） |
| 開啟期間新建的檔案不出現，關閉再開啟後出現 | 10.3 |
| 開啟期間再次按下快捷鍵不清空查詢 | 8.8 |
| 列舉失敗時呈現錯誤而非空清單 | **probe 層不覆蓋** —— 要使列舉失敗，得在執行期把 fixture 目錄搬走，而那會污染後續段落（既有紀律：新段落不得留下狀態）。主行程的「回報錯誤而非空清單」由 2.9 承擔；**入口呈現錯誤說明**這一半由 code review ＋ design 承擔（比照 OSC 8 `linkHandler` 的先例） |

### `filesystem-access`（14 條 ADDED ＋ 1 條 MODIFIED）

| Scenario | 載體 |
|---|---|
| 回傳的路徑為 folder-relative | 2.1 |
| 回傳遞迴的檔案清單 | 2.1 |
| 清單不含目錄 | 2.1 |
| 不跟隨指向 folder 之外的 symlink 目錄 | 2.2（＋ 2.3 對照組） |
| 不因 folder 之內的 symlink 目錄而重複 | 2.2 |
| 拒絕逃逸出邊界的路徑 | 2.4 |
| 非 ASCII 檔名以原始形式回傳 | 2.5（＋對照組：拿掉 `-z`） |
| 排除位於自身之內的其他工作目錄 | 2.6（＋ 2.7 對照組） |
| 排除版控忽略的內容 | 2.6 |
| 目標不在版本控制之下時仍可列舉 | 2.8 |
| 目標整個被版控忽略時仍可列舉 | 2.8 |
| 逾時不退回保守列舉 | 2.9 |
| 列舉失敗時回報錯誤 | 2.9 |
| 列舉期間事件迴圈仍在運行 | 2.10（＋ 2.11 對照組） |
| *(MODIFIED)* 介面上只有已定義邊界要求的能力 | 7.1 |

### `keyboard-navigation`（2 條 MODIFIED，5 條 scenario 皆未變更）

本 change 對這兩條 requirement 的修改**只在規範性敘述**（寫明第三組快捷鍵落在哪一邊、要求日後
新增快捷鍵時回到該處交代）—— 沒有新的可執行行為，因此不新增驗收。5 條 scenario 逐字沿用：

| Scenario | 載體 |
|---|---|
| 終端持有焦點時切換 session | 既有 `probe:keyboard` 斷言（未變更） |
| 終端持有焦點時調整順序 | 既有 `probe:keyboard` 斷言（未變更） |
| 被攔截的按鍵不寫入 pty | 既有 `probe:keyboard` 斷言（未變更） |
| 編輯器持有焦點時切換 session | 既有 `probe:keyboard` 斷言（未變更） |
| 編輯器持有焦點時排序快捷鍵讓路 | 既有 `probe:keyboard` 斷言（未變更） |

> **這五列看似冗餘，但它們是機械檢查的一部分。** 用一段散文說「其餘皆為既有內容」，腳本無法
> 判別那是「確實未變更」還是「漏了」—— 而這個 repo 栽在後者上四次。逐條列出，檢查才是機械的。
