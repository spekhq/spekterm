## 1. 先實測：`Ctrl+Tab` 到底抵不抵得了 renderer

> **這一項的結果決定 D1 是否成立，必須排在所有實作之前。** Chromium 在瀏覽器裡把 `Ctrl+Tab` 保留給
> 分頁切換、不送給頁面。Electron 沒有分頁列，理應會送達 —— 但這是**待實測的事實**，不是設計裁決。
> **不可用 CDP 注入的按鍵來驗這一項**：`Input.dispatchKeyEvent` 繞過作業系統與瀏覽器的 accelerator
> 層，它會「成功」，而那個成功什麼都不證明。

- [x] 1.1 於 `npm run dev` 開著的 app 裡，掛一個暫時的 `keydown` listener（capture 階段）印出按鍵，
      **以真實鍵盤**按 `Ctrl+Tab`、`Ctrl+Shift+Tab`、`Ctrl+↑`、`Ctrl+↓`，確認四者皆抵達 renderer
- [x] 1.2 **不適用** —— 實測（使用者以真實鍵盤）四鍵皆抵達 renderer，D1 成立，未動用退路
- [x] 1.3 一併確認 `Ctrl+↑/↓` 在**終端持有焦點**時，未經攔截前確實會被寫進 pty（證明「沒收」是真的
      有代價，也證明後續的攔截確實生效 —— 沒有這個對照組，「pty 沒收到」可能只是因為它本來就收不到）

## 2. 鍵盤導航

- [x] 2.1 新增鍵盤綁定模組：於 `window` 的 **capture 階段**註冊 `keydown`，命中時
      `preventDefault()` + `stopPropagation()`（capture 早於 xterm 綁在 helper textarea 上的 listener，
      也早於 Monaco —— 見 design D1）
- [x] 2.2 `Ctrl+Tab` / `Ctrl+Shift+Tab`：於當前 repo 內依**分頁位置序**切換 focused session，可循環；
      0 或 1 個 session 時為無操作
- [x] 2.3 `Ctrl+↓` / `Ctrl+↑`：依 rail 的呈現順序切換當前 repo，可循環；只有一個 folder 時為無操作
- [x] 2.4 接上既有的 `useWorkspaceFolders.select` 與 `SessionsApi.focus` —— **不新增狀態**
      （per-repo 的焦點記憶已存在於 `focusedIdFor()`，見 design D6）
- [x] 2.5 `Ctrl+C` 不得被挪用（既有要求）；確認新的綁定沒有覆蓋既有的 `Ctrl+Shift+C/V`、`Ctrl+S`、`Esc`

## 3. 對話框開啟時抑制快捷鍵

- [x] 3.1 `files/dialogs.tsx` 的對話框補上 `role="dialog"`（既有的無障礙缺口 —— 目前只有
      `SessionNameDialog`、`TitleConflictDialog`、`VizOverlay` 有）
- [x] 3.2 鍵盤綁定於 `[role="dialog"]` 存在時整體不生效（見 design D5）

## 4. login shell 不採用 pty 宣告的標題

- [x] 4.1 `sessions.tsx` 的 `setTitle()` 對 `spawnTarget === 'shell'` 的 session 直接忽略
      —— 那是 OSC 標題進入狀態的**唯一入口**，擋在這裡，標籤與 `pendingTitle`（確認對話框）**一起**
      失效；擋在顯示層會漏掉後者（見 design D4）
- [x] 4.2 確認 `sessionTitle()` 不需改動：`title` 恆為 `undefined` 時它自然退回本地標籤
- [x] 4.3 確認使用者自己命名 shell session 仍然有效（命名權不因 spawn 目標而異）

## 5. 驗收：`probe:terminal` 的標題測試換載體（不換就是假綠）

> 現有的「pty 宣告標題」「命名權衝突」三條測試全部以 **login shell** session 送 OSC 序列驅動。
> 本 change 生效後它們會**繼續通過** —— 但通過的是「標籤沒變」這個新行為，**而不是它們自稱在測的
> 東西**。88/88 依然是 88/88，看不出它們已經空轉。

- [x] 5.1 探針在 spawn Electron 時，把一個暫存目錄前置到 `PATH`，其中放一支 stub `claude`
      —— 送出指定的 OSC 標題後掛著不結束。產品的 claude 模式是 `$SHELL -l -c claude`（從 PATH 解析），
      pty 又整份繼承 Electron 的 env，因此這條路徑**完全真實**，且動的是環境、不是產品程式碼
      （已實測 PATH 前置在 login shell 下存活，見 design D7）
- [x] 5.2 把「pty 設定標題後標籤更新」「rail 子列同步」「手動命名後 pty 改名須確認」「採用／保留的
      裁決」「命名權交還」「待確認的標題至多一個」移到 **`claude` 目標**的 session 上
- [x] 5.3 **新增**正向斷言：login shell 的 session 送出 OSC 序列後，標籤**維持** `shell N`
      （這才是本 change 真正要保證的行為）
- [x] 5.4 **新增**斷言：已命名的 login shell session，其 pty 送出不同標題時**不跳確認對話框**
- [x] 5.5 「未宣告標題的 session 退回本地標籤」原本靠「第一個 session 有 pty 標題、第二個沒有」來對比
      —— 改以 claude（有標題）＋ shell（無標題）兩個 session 承載同一個對比

## 6. 驗收：鍵盤導航

- [x] 6.1 新增鍵盤導航的探針（`probe:keyboard`，或併入 `probe:terminal`），以 `Input.dispatchKeyEvent`
      送真的按鍵事件
- [x] 6.2 斷言：**終端持有焦點時** `Ctrl+Tab` 仍切換 session
- [x] 6.3 斷言：被攔下的按鍵**沒有抵達 pty** —— 終端畫面上不得出現該按鍵的字元或控制序列
      （對照 1.3 的未攔截行為；只斷言「切換成功」不足以證明沒有垃圾流進 agent）
- [x] 6.4 斷言：`Ctrl+Tab` 依**位置序**而非 MRU —— 先聚焦第三個分頁、再聚焦第一個，然後 `Ctrl+Tab`
      應到**第二個**（少了這條，MRU 的實作也會全綠）
- [x] 6.5 斷言：**編輯器持有焦點時**快捷鍵仍生效
- [x] 6.6 斷言：**每一種**對話框開啟時皆抑制快捷鍵（session 命名、標題衝突、files 的對話框
      —— 不是只驗一種就宣稱涵蓋）
- [x] 6.7 斷言：切 repo 後 focused session 落在該 repo 最後聚焦過的那一個，且**滑鼠與鍵盤落點相同**
- [x] 6.8 dev 與 build 兩模式皆通過
- [x] 6.9 在 `package.json` 加上對應的 `probe:*` script（若獨立成一支）

## 7. 真實鍵盤的人工確認（探針涵蓋不到）

> CDP 注入的按鍵**繞過**作業系統與瀏覽器的 accelerator 層。探針能證明 handler 正確、按鍵沒進 pty，
> **但不能證明一顆真的 `Ctrl+Tab` 會抵達 renderer**。這道缺口只能由真鍵盤補。

- [x] 7.1 `npm run dev`，以**真實鍵盤**確認四個快捷鍵在終端持有焦點時皆有效
- [x] 7.2 以**真實鍵盤**確認終端裡沒有出現多餘的字元或控制序列
- [x] 7.3 開一個 login shell session，確認分頁**穩定為 `shell N`**、且「+ session」按鈕**不再跳動**
- [x] 7.4 開一個 `claude` session，確認它宣告的標題**仍然**被採用（此能力未被本 change 削弱）
- [x] 7.5 以**真實鍵盤**確認 `Ctrl+T` 抵達 renderer 並開出 spawn 選單 —— **`Ctrl+T` 正是 Chromium
      保留給「開新分頁」的鍵**，探針（CDP 注入）繞過 accelerator 層，證明不了這件事。並確認選單能
      全鍵盤操作（`↑↓` 移動、`Enter` 建立、`Esc` 關閉），且終端裡沒有多出一個 `t`

## 9. `Ctrl+T` 開新 session ＋ 選單的鍵盤導覽

> **這兩件事不可分割。** 使用者選了「`Ctrl+T` 跳出 spawn 選單」，而現有的 `ContextMenu` 只處理
> `Esc`、**沒有方向鍵導覽** —— 用快捷鍵叫出一個只能用滑鼠點的選單，等於沒做這個快捷鍵（design D9）。

- [x] 9.1 `Ctrl+T`：觸發 `[aria-label="新增 session"]` 這個既有的建立入口 —— 於是選單的錨定位置與
      滑鼠點擊完全一致，鍵盤的接縫也仍然只有一處。沒有選中的 repo 時為無操作
- [x] 9.2 `ContextMenu`：開啟時焦點落在第一個選項；`↑/↓` 於選項間循環移動；`Enter` 觸發
      （`<button>` 原生即支援，不必自己接）；`Esc` 維持既有行為
- [x] 9.3 導航快捷鍵的抑制範圍由 `[role="dialog"]` 擴為 `[role="dialog"], [role="menu"]`
      —— 否則 `Ctrl+Tab` 會在使用者正用方向鍵選項目時把畫面切走
- [x] 9.4 `probe:keyboard`：`Ctrl+T` 開啟選單，且**位置與滑鼠觸發時相同**
- [x] 9.5 `probe:keyboard`：選單開啟時焦點在第一項；`↓` 到末端會循環；`Enter` 真的建立了 session
- [x] 9.6 `probe:keyboard`：選單開啟時導航快捷鍵不生效
- [x] 9.7 `probe:keyboard`：被攔下的 `Ctrl+T` **沒有流進 pty**（對照組：不帶 Ctrl 的 `t` 會抵達）
- [x] 9.8 既有的右鍵選單（分頁、檔案樹）加上鍵盤導覽後**行為不得退化** —— 跑 `probe:terminal`
      與 `probe:files` 回歸
- [x] 9.9 `CLAUDE.md` 的快捷鍵表補上 `Ctrl+T`，並記下它的代價（`transpose-chars`、以及 claude 若有
      用到 `Ctrl+T` 就一併沒收）—— 與 `Ctrl+Tab`「白撿」的性質**不同**，不要混為一談

## 8. 回歸與文件

- [x] 8.1 `npm test`、`npm run typecheck`
- [x] 8.2 `npm run probe:files`、`npm run probe:openspec`、`npm run probe:workspace`、`npm run probe:shell`
      （攔截 keydown 是全域行為，任何一支都可能被它波及）
- [x] 8.3 `CLAUDE.md`：新增快捷鍵一覽；記下 **capture 階段**這個洞察（`Ctrl+S` 之所以被迫寫進 Monaco，
      是因為它註冊在 bubble 階段，不是因為 window listener 沒用）；記下 login shell 不採用 OSC 標題
      及其理由（分頁寬度突變把建立入口推走 150px）
- [x] 8.4 `docs/PRD.md`：若快捷鍵影響 §6 的 UI 描述則回寫
- [x] 8.5 `docs/workspace-mockup.html` 是 UI 的權威來源 —— 若雛型對快捷鍵沉默，於 CLAUDE.md 註明
      「快捷鍵由本 change 定義，雛型對此沉默」，避免日後被當成偏離雛型
