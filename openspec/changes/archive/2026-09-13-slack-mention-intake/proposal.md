## Why

使用者實際「接到工作」的地方是 Slack —— 有人在 thread 裡 tag 他，那件事就成了他的待辦。
目前這條路徑完全是人力的：他自己讀、自己判斷該在哪個 repo 處理、自己開 session、自己把上下文
複述給 agent。收件匣（`agent-intake` / `intake-routing`）已經把後半段做完了，**契約是一個目錄加
一份 JSON**，但至今沒有任何 producer —— 能力是空轉的。

本 change 交付第一個 producer，並在此之前清償兩筆會被它踩到的債：

1. **`settings:get` 目前把整個偏好物件原樣轉手給 renderer**（`src/main/ipc/settings.ts:59`）。
   任何日後加進那個物件的欄位都會零改動、零紅燈地送到 renderer —— 而本 change 正是**第一個
   有機密流過**的。這筆債的敘述已寫在 `docs/PRD.md:648`，並指名它必須在 Slack 之前做完。
2. **`agentStatus` 偏好不跨重啟**（issue #39）。它的形狀值得特別指出：`terminal-preferences`
   的規格**已經有**「切換後跨重啟保留」這條 scenario —— 這不是規格缺口，是一條**有 scenario、
   零驗收載體**的條文。成因與第 1 條同源：同一組欄位有兩處各自維護的白名單清單，而型別檢查
   對它們零感知。第 1 條會加上**第三處**；不做結構耦合就是把同一個缺陷複製第三份。

**為什麼三件合一個 change**：前兩件單獨看都是「假設性的」清償 —— 投影要防的機密還不存在，
白名單的第三處也還沒出現。把它們與 Slack 放在一起，那條投影 requirement 的 why 才是具體的。
（issue #42 的事實校正是使用者裁決一併納入的第四件，見下。）

## What Changes

### Slack 作為收件匣的第一個 producer

- 主行程持有一條 Slack 連線，偵測**有人 tag 使用者本人**（不是 tag 一個 bot），把該則訊息
  **所在的整條 thread** 轉成一則 intake，寫進既有的投遞落點。
- **啟動時回補**：Socket Mode 沒有重送佇列，斷線期間（含 app 關著時）的事件就是掉了。回補以
  另一條路徑取得，並以穩定的 intake 識別碼讓重複投遞靜默（收件匣已規定內容相同的重複要靜默）。
- **接受之後的行為完全沿用既有契約** —— 使用者看過本文才開 session，第一則 prompt 已填但
  **不送出**。本 change 不動收件匣那一半的任何判斷。
- Slack 的連線設定（token、workspace、要偵測誰）**由使用者設定而非寫死**，且其編輯入口不寄居在
  終端偏好對話框裡（`intake-routing` 已就規則的入口立下同一條約束）。

### 機密的作用域邊界

- Slack token 落於 userData，SHALL NOT 抵達 renderer、SHALL NOT 進入任何 pty 的環境、
  SHALL NOT 進入版控或診斷輸出。
- **`ptyEnv()` 會把使用者的互動 shell 環境合併進每一個 pty** —— 因此「把 token 放進 shell rc」
  等同讓每一個 agent session 都讀得到。這件事要由條文擋住，不是由紀律擋住。

### 偏好白名單的結構收斂（前置債）

- `settings:get` 改為**逐欄位投影**（白名單），保持「未設定即省略」的語意
  （否則 `probe:workspace` 會紅），並加一道原始碼守衛擋回原樣轉手。
- `agentStatus` 補進 `parsePreferences` 的解構白名單與 `setTerminalFont` 的保留清單，
  並補上那條既有 scenario 缺的驗收載體（跨 `load()`、跨改字型兩個方向都要驗）。
- **三處清單（讀入、保留、送出）結構性耦合** —— 新增一個欄位而漏掉任一處 SHALL 導致編譯失敗，
  而不是靠三個地方各自被記得。

### watcher 建立點的事實校正（issue #42）

`src/main/watcher.ts:24` 與 `watcher-error-reporting` 主 spec 的條文都寫著「**四個**建立點裡有
三個服務單一目標」。實際已是**七個**：`branch-service` ×2、`watch-service`、
`transcript-follow-service` ×2、`openspec-service`、`intake-source`。**這一件與其餘三件無關**，
納入本 change 是使用者的範圍裁決；它小到不值得自己一輪 artifact 審查。
主 spec 不直接編輯 —— 走 Modified Capability + delta。

## Capabilities

### New Capabilities

- `slack-intake-source`: Slack 作為收件匣的外部 producer —— 連線與身分、mention 的偵測範圍、
  thread 的取回與截斷、投遞的產生與識別碼、啟動回補與重複抑制、連線失效時使用者看得見。
- `secret-scope`: 應用程式持有的機密，其作用域邊界 —— 住在主行程、不抵達 renderer、不進入
  子行程環境、不出現在診斷輸出、只送往它所屬的那個服務。這是橫切的：它管的不是
  「Slack token 怎麼存」，而是**任何**機密流經那四條出口時會怎樣。前三條是既有的
  （IPC 投影、子行程環境、log），**第四條（網路）是本 change 新增的** —— 而它是唯一真的會把
  憑證送出本機的那一條。

### Modified Capabilities

- `terminal-preferences`: 新增「偏好經 IPC 送往 renderer 時為逐欄位投影」與「偏好欄位的白名單
  清單結構性耦合」兩條 requirement；既有的 agentStatus 跨重啟 scenario 補上驗收載體。
- `watcher-error-reporting`: 「四個建立點」的事實校正為七個（issue #42）。條文所依賴的論證
  （一對一的多數、顯式傳入的孤例）不受影響，變的只有數字與清單。

### 不修改的能力

- `agent-intake` / `intake-routing`: **一條都不改**。Slack adapter 走既有契約投遞，routing 已
  支援以接收端可驗證的來源座標識別碼（channel id）為判準。**若本 change 發現必須改動它們，
  那就是 adapter 越界了。**

## Impact

**新增依賴**：Slack 的連線用戶端。**必須落在 `dependencies` 而非 `devDependencies`** ——
main 的 build 走 `externalizeDepsPlugin()`（執行期 require），而 electron-builder 只把
`dependencies` 打進 asar；放錯區塊時 dev 完全正常、打包後一啟動就 `MODULE_NOT_FOUND`。

**主行程**：新增 Slack 連線與投遞模組；`src/main/ipc/settings.ts` 的投影；
`src/main/preferences-store.ts` 的兩處白名單與其結構耦合；`src/main/watcher.ts` 的註解。

**renderer**：Slack 連線設定的編輯入口（新，不寄居於既有設定對話框）；
`PreferencesProvider` 隨投影後的型別調整。

**驗收**：`probe:intake` 既有的跨行程斷言不得因本 change 失效；新增 Slack adapter 的載體
（以替身取代真實 Slack —— 真實連線要網路、要憑證、不可重現，比照 `probe:insights` 的委派
與 `probe:agent-view` 的替身 agent，該缺口寫進規格）。新增兩道原始碼守衛（投影、機密）。

**文件**：`docs/PRD.md` §11 Phase 7 的 Slack 段落與那筆技術債；`CLAUDE.md` 的收件匣段落；
`docs/lessons/intake.md`（若 adapter 產出新的教訓）。

**issue**：#39 與 #42 於本 change 交付後關閉。#39 的標題涵蓋 `agentEvents`，而那一半已由
`agent-intake-inbox` 補上 —— 關閉時要指出這件事，`preferences-store.test.ts:189` 的註解也已過時。

## 已知的張力（在 design 中裁決，此處只登記）

1. **接取方式與產品化互斥。** Socket Mode 的 app **上不了 Slack Marketplace**（要上架就得走
   HTTP 端點），且 app-level token 一個 app 只有一份、多條連線之間是**負載平衡而非擴充** ——
   結構上這是單人、單 workspace 的。使用者要求「之後做成產品要能讓大家設定」，而本 change
   **交付不了多租戶**。可交付的是**邊界的位置**：adapter 只是收件匣的一個 producer，換接取層
   時收件匣一個字都不必改。這個張力要攤開寫，不含混。
2. **一條承重的事實尚未查證**：Slack 官方的 Socket Mode 文件通篇只講 bot 事件，**沒有一句話
   說明 user-scope 的事件會不會經 WebSocket 送達**。偵測「有人 tag 使用者本人」需要的正是
   user token 的事件。這條若不成立，整個接取層要換（改以輪詢取得）。
   **design 之前必須有一次實測**，不從語意推論 —— 這個 repo 兩次栽在對 core 的 optional 欄位
   做語意推論上。
3. **整條 thread vs 長度上限。** 收件匣有**兩個**上限：本文 4000、其餘 authored 欄位各 200
   （訂在「一個人會實際讀完」的量級，不是技術極限），超過即**整則被拒絕**。長 thread 會超過
   前者，而 **mention 訊息的第一行拿來當標題很容易超過後者**。截斷是必然的，而**截斷必須
   誠實** —— 使用者讀到的那一份逐字元就是 agent 讀到的那一份，這條是收件匣人類閘門的另一半。
4. **adapter 住在主行程，卻要投給「應用程式之外的 producer」的落點。** 走同一個檔案落點
   （app 投給自己）保住單一路徑，代價是一個看起來多餘的繞路；直接在行程內餵進管線則開出
   第二條路徑。design 要裁決並說明**它實際多拿到了哪些守衛**（不是全部）。
5. **重送的「內容相同」比對的不只是本文。** 收件匣的去重摘要涵蓋六個欄位，其中兩個
   （發話者顯示名稱、頻道名稱）**由第三方隨時可改**。只讓本文穩定是不夠的 —— 一次頻道改名
   就會讓一批重新推導的 mention 落進「識別碼搶佔」的可見警示。design 要給出機制。
