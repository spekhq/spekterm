## Why

收件匣實際用起來有三個問題，三個都是 dogfood 時碰到的：

1. **接受之前改不了目標 folder。** routing 只有 fallback、沒有規則時（使用者現在的設定就是這樣），
   每一則都解析到同一個 repo，卡片上的「Opens in X」只能看不能改。規則只看得到 intake 的通用
   欄位，**讀過本文的人**才知道這件事該在哪裡處理，而那個人在按下接受的那一刻沒有工具可用。
   解析不出 folder 的項目更糟：接受鈕直接停用，那一則只能忽略。
2. **已開好 session 的項目永遠留在收件匣裡。** 「Opened in X」那一段沒有離開的條件，
   現在已經累積了 10 則，而且只會越來越多，真正待處理的東西反而被淹沒。
3. **看不出哪一則新、哪一則舊。** 每一則都帶著到達時間（`receivedAt`），但畫面上沒有顯示；
   清單順序是落盤的插入順序（最舊的在最上面）。**而到達時間也不是使用者要的那個時間**：
   dogfood 時第一版顯示相對的到達時間，昨天的 Slack 提及卻寫著「剛剛」—— 它們是應用程式啟動時
   一次回補進來的。投遞格式沒有「這件事何時發生」的欄位，收件匣只知道它何時被收到。

## What Changes

- **待處理項目的目標 folder 可在接受之前改選。** 卡片上的「Opens in X」改為選單，列出
  workspace 中的所有 folder：
  - 可解析的項目**預先選好** routing 的結果，使用者可以改；已經建過 session（預填逾時而退回
    待處理）的項目預選那個 session 所在的 folder。
  - 解析不出的項目（`NO_MATCH` / `FOLDER_GONE`）**不預選任何 folder**，並且照樣說明原因；
    使用者**明確選定**一個 folder 之後才能接受。這不違反「不靜默退回」—— 做決定的是使用者，
    不是系統。
  - 使用者的選擇在收件匣開著的期間保留（切到 Rules 分頁改規則再切回來也不會丟），
    只在按下接受的那一刻生效，**不落盤、也不寫成規則**。
  - 主行程**以查表確認**使用者選的 `folderId` 在 workspace 之中，查無即拒絕；不接受路徑。
  - 選擇的 folder 與「預填逾時退回待處理時留下的舊 session」所在的 folder 不同時，
    **不沿用那個 session**（沿用會讓本文送進錯的 repo）。
- **已開好 session 的項目，在它的使命結束時離開收件匣。** 那一段存在的理由是「按下送出之前
  要看得到本文全文」（到達即建立 session 的交接只在那裡呈現本文）。因此：
  - 預填的 prompt **已送出**、該 session **已不存在**、或它的 folder 已被移出 workspace 時，
    那一則不再呈現。
  - 另外提供逐則的手動清除（處理既有的、沒有「已送出」紀錄的項目）。
  - 紀錄本身**不刪除**：去重鍵永久保留的既有規定不變，只是不再呈現。
- **每一則顯示它發生的時間（完整的日期與時刻），清單依該時間新的在上。** 待處理與已開好的兩段
  都適用。時間經 `src/shared/i18n/locale.ts` 格式化。
  - 投遞格式新增一個**選填**的 `occurredAt`（第三方撰寫的欄位，與標題、本文同一類）；
    不可解析即以欄位型別不符拒絕。沒有它時以到達時間代之。
  - **發生時間不得晚於到達時間**（晚於時以到達時間為準）—— 否則任何投遞都能宣告一個未來的時刻，
    把自己釘在最上面。
  - Slack adapter 以被提及那一則訊息的時間（`ts`）填入。**已經收進來的項目沒有這個欄位**，
    仍顯示到達時間。

**不在範圍內**：

- **到達即建立 session 的交接不受選單影響** —— 它沒有接受這一步，目標是 agent 指名的。
  （它若因預填逾時而退回待處理，就和其他待處理項目一樣可以改選。）
- **「把這次的選擇記成規則」** —— 需要的話另開 change。
- 拒絕痕跡（notices）的內容與上界不動（它的相對時間會順帶隨時鐘更新）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `intake-routing`：「使用者在接受之前看得到將開在哪個 folder」改為**看得到，也能在接受之前
  改選**；「解析不出 folder 時拒絕」增加**使用者明確選定 folder**的例外（仍然不會自動退回）。
- `agent-intake`：「接受一則 intake 於解析出的 folder 建立 agent session」改為**於使用者接受時
  選定的 folder 建立**；已接受項目的呈現增加**離開收件匣的條件**（已送出或 session 已不存在），
  以及逐則清除；預填逾時後改選 folder 時**不沿用舊 session**；收件匣中的每一則**呈現到達時間，
  且新的在上**。
- `agent-handoff-source`：「預填等不到就緒時該則交接回到可重新處理的狀態」的「再次處理不建立
  第二個 session」加上**未改選 folder** 的前提。
- `agent-intake`（續）：欄位分類的第三方撰寫組加入**發生時間**（選填、不可解析即拒絕、不作判斷依據）。
- `slack-intake-source`：新增「投遞宣告被提及那一則訊息的時間」。

## Impact

- **renderer**：`src/renderer/src/shell/intake/IntakeOverlay.tsx`（選單與改選的保存、時間、
  已開好那一段的篩選與清除）、`reuse-session.ts`（沿用舊 session 的判斷要把 folder 納入）、
  `src/renderer/src/shell/files/FilesPanel.tsx`（`useNow` 搬成共用 hook）。
- **主行程**：新模組 `src/main/intake-projection.ts`（投影、篩選、排序搬出 electron 之外）、
  `src/main/ipc/intake.ts`（`accept` 多收一個由使用者確認的 `folderId`，以查表驗證；「已送出」
  收窄為 busy／awaiting-choice 並落盤；新增清除的通道）、`src/main/intake-store.ts`（`settledAt`
  以 optional 欄位加入，**不得 bump `INTAKE_VERSION`**，否則使用者的整個收件匣會被丟掉）。
- **preload**：`window.workspace.intake.accept` 的簽名、新增清除的通道。
- **`package.json`**：`test:unit` 的 glob 擴大到 `src/main/*/*.test.ts` —— `src/main/ipc/` 裡的
  測試從未被執行過，其中一條現在是紅的，要先修到綠。
- **字典**：`en.json` / `zh-TW.json` 新增選單、清除相關文案。
- **投遞格式與 Slack**：`src/main/intake-schema.ts`（`occurredAt` 的解析）、
  `src/main/slack-mention.ts`（以訊息的 `ts` 填入）。
- **驗收**：`scripts/probe-intake.mjs`、`scripts/intake-control-groups.mjs`、
  `scripts/scenario-coverage.test.mjs`（登記 `COVERED_CHANGES`）、`scripts/probe-shell.mjs`
  （preload 白名單；它早已漏登 `dismissNotice`）。
- **文件**：`docs/lessons/intake.md`（若實作中踩到新的靜默失效）。
- 無新依賴。
