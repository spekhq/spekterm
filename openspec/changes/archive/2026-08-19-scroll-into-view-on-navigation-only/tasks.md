## 1. 原語：介面上不得存在「每次渲染都變」的參數

- [x] 1.1 `useScrollIntoView` 改為接收觸發條件 `(key: string | null, resolve: () => Element | null | undefined, axis: 'block' | 'both')`，effect 收進 hook，回傳只剩掛在容器上的 guard。**不做成 hook 回傳物件上的方法** —— 那在 `react-hooks/rules-of-hooks` 下是 error（實測：hook 不得於 callback 內呼叫）。
- [x] 1.2 `resolve` 以 latest-ref 吞掉，**ref 於 effect 內更新，不得於渲染期間指派** —— `react-hooks/refs` 對後者是 error（實測），而 `WorkspaceRail.tsx` 記載本 repo 已為此付過一次學費。
- [x] 1.3 **移除 `scrollIntoView(target, options)` 的匯出**，pointer 判定收為內部實作。改完它零呼叫端（`QuickOpen` 從來不是它的消費點），而它正是新介面要關掉的逃生口。
- [x] 1.4 `axis` 以字面量聯集表達、實際 options 為模組層級常數 —— inline object 每次渲染都是新身分，一旦成為參數，`exhaustive-deps` 會要求把它加進依賴，缺陷即從新入口復活（實測該規則確實發出 missing dependency 警告）。
- [x] 1.5 **首次執行不捲**（sentinel 為 `undefined`，不可用 `null` —— 後者是「當下沒有目標」這個合法的 key 值）。掛載不是「選取、焦點或順序改變」，而 rail 的兩個捲動來源會搶同一個容器：實測 `Shift+↑↓` 時子列那一份重新掛載，在標題列剛捲進視野後又捲一次，把畫面帶到別處（dev 298 → 106 → 238）。
- [x] 1.6 doc comment 記下上述每一條的理由。

## 2. 三個消費點改以「目標的位置」表述觸發條件

- [x] 2.1 `WorkspaceRail` 的 `railScroll`：key ＝ 選中項目的**識別碼值**（全域為 `'global'`）＋ 它在 rail 上的序位。**取值不取 `selection` 物件的身分**（`folderSelection()` 每次都造新物件）。
- [x] 2.2 `RailRow` 的 `rowScroll`：key 含 `selected`、`focusedSessionId` 與該 session 在此 folder 內的序位；序位在 effect 之外算完。
- [x] 2.3 `SessionTabs` 的 `tabScroll`：key 含 `focusedId` 與該分頁的序位。
- [x] 2.4 三處都不再有 `sessions` / `folders` / inline options 進入依賴，`npm run lint` 對 `react-hooks/*` 無 error 亦無 warning。

## 3. 驗收載體（`scripts/probe-keyboard.mjs`）

- [x] 3.1 **新增獨立段落 `checkScrollAnchoring`**（不併進 `runMode`）：它要結束 session、要八個 session，而 `runMode` 的絕對斷言以既有 fixture 狀態為前提；`runMode` 又最重、build/dev 各跑一次。獨立段落也讓它能單獨迭代。
- [x] 3.2 rail：捲離 focused 子列 → 結束一個 session → 斷言 `scrollTop` 不變。
- [x] 3.3 分頁列：捲離 focused 分頁 → 結束一個 session → 斷言 `scrollLeft` 不變。**兩者各用一組已驗證過的視窗尺寸**，不硬湊「同時溢出」。
- [x] 3.4 兩者各自先斷言**前提**：目標元素找得到（找不到回 `null` 讓前提變紅），且確實不完整可見。
- [x] 3.5 兩者各自斷言**那次狀態更新確實發生**（`title` 由 Running 轉為 Exited）—— 捲動位置不變是相對判定，觸發機制整個沒發生時它照樣是綠的。
- [x] 3.6 結束 session 前先點終端再打字（`Input.insertText` 送到焦點元素），且該 session 是剛建立、停在 prompt 的 shell —— 這支探針有五處以 `cat -A > file` 把 shell 留在 `cat` 裡，那樣的 session 打 `exit` 只會把四個字寫進檔案。
- [x] 3.7 補上 `Scenario: 移動 rail 項目後它仍可見` 的載體。**方向由實測決定**：第一版（選第一個 repo、捲到底、`Shift+↓`）在對照組下照樣是綠的 —— scroll anchoring 會補償視野**上方**的內容變動，恰好把目標帶進視野。改為選最後一個 repo、捲到**頂**、`Shift+↑`，變動落在視野下方，anchoring 不介入。
- [x] 3.8 補上 `Scenario: 移動 session 後它仍可見` 的載體（先強制 `scrollLeft` 到最右，再 `Shift+→`）。
- [x] 3.9 新斷言一律走 `pollFor` / `pollUntil`，複合條件皆帶 detail（`wait-source` / `retry-source` / `check-detail` 三道守衛皆綠）。**等的是「目標可見」這個穩定狀態，不是「捲動位置變了」** —— 後者實測會抓到重排與捲動之間的中間值而誤判。

## 4. 對照組 —— 沒跑過對照組的載體不算載體

- [x] 4.1 rowScroll / tabScroll 的 key 換回「每次渲染都變的值」 → 3.2 與 3.3 **雙雙變紅**（`scrollTop 0 → 206`、`scrollLeft 0 → 657`，正是使用者回報的症狀）。已復原。
- [x] 4.2 railScroll 的 key 拿掉序位 → 3.7 **變紅**（`scrollTop 0 → 0`，目標仍不可見）。**第一版的 3.7 在此對照組下是綠的**，正是它讓 anchoring 的假綠被抓出來（見 3.7）。已復原。
- [x] 4.3 tabScroll 的 key 拿掉序位 → 3.8 **變紅**（`scrollLeft 612 → 612`）。已復原。
- [x] 4.4 把結束 session 的輸入換成不會結束 pty 的指令 → 3.5 的兩條活性斷言**變紅**，而 3.2／3.3 **照樣全綠**（`0 → 0`）—— 相對判定沒有活性證明時毫無鑑別力的實證。已復原。

## 5. 回歸與文件

- [x] 5.1 `npm run typecheck`、`npm run lint`、`npm test`（607 pass / 0 fail）全綠。
- [x] 5.2 段落耗時已量測：新段落 15–16 秒、`runMode` 未加料（50 秒），距 `sections.mjs` 的 8 分鐘預設窗口無風險，不需調整 `timeoutMs`。
- [x] 5.3 `npm run probe:keyboard` **248/248 通過**，十個段落（build + dev）全部完整執行。
- [x] 5.4 `npm run probe:terminal` **270/270 通過**（本 change 動到 `SessionTabs`）。
- [x] 5.5 CLAUDE.md「React 的陷阱」補一條：**effect 的依賴陣列就是 requirement 的觸發條件在程式碼裡的載體**；把每次渲染都重建的值放進去，等於把它改寫成「任何重繪」，而型別、探針與 lint 都不會有一句話 —— 反過來，`exhaustive-deps` 還會主動要求你把它加進去。並補「同一個捲動容器有兩個目標時，掛載也算改變就會讓後手贏」與「驗收捲動前先問除了實作還有誰會捲它（scroll anchoring）」。
