## Why

收件匣已經能把一件外部的事變成「在對的 repo 裡、context 備妥、第一則 prompt 已填好的 agent
session」—— 但**只有外部**能發起。使用者在 a repo 的 session 裡做到一半，發現剩下的事該由 b repo
接手時，他得自己切過去、自己開一個 session、自己把前因後果重講一次；而正在跟他對話的那個 agent
**明明已經知道全部的前因後果**，卻沒有任何管道把它交出去 —— 它甚至不知道 spekterm 存在。

**這正是收件匣把 producer 劃在邊界外的那條線所預留的位置。** 第一個 producer 是 Slack（別人交辦
給你），第二個應該是 agent 自己（你的一個 session 交辦給另一個 repo）。下游一個字都不必改。

## What Changes

- **spekterm 對 agent 自我介紹** —— agent session 啟動時，經既有的 `--settings` 接縫注入一個
  `SessionStart` hook，把「你跑在 spekterm 裡、workspace 目前有哪些 repo、要交接就寫一份 JSON 到
  哪裡、格式是什麼」放進 agent 的脈絡。使用者的 repo **不需要**為此寫任何 `CLAUDE.md`。
- **每個 agent session 有一個專屬的投遞目錄**（沿用 `SPEKTERM_EVENT_DIR` 那個模式）。agent 以它
  現成的檔案寫入能力投遞，**不需要任何新工具、不需要 MCP**。
- **來源由接收端判定，不採信投遞內容**。投遞落在**哪個 session 的目錄**就決定了它來自哪個 repo ——
  於是「投遞者自己宣告來源」在結構上表達不出來，而收件匣現有的三組欄位分法不被破壞。
- **目標以 workspace 的 folder 清單查表解析**。agent 送的是一個名字，可達集合受限於使用者自己
  加進 workspace 的東西；**查無即拒絕，不 fallback**。這與工作目錄識別碼的圍堵性同一套論證。
- **收件匣接受「已定址的投遞」** —— adapter 已經解析出目標 folder 時，routing 直接採用、不比對
  規則。理由：routing 規則的判準分「可驗證」與「第三方撰寫」兩類，而交接的目標**既非兩者** ——
  它由接收端查表產生，是可驗證的，但它不是「來源座標」。讓它去擠既有的欄位會把那個分類弄髒。
- **交接直接開 session，不經接受閘** —— 投遞一抵達就在目標 folder 開好 session、寫好 context 檔、
  把第一則 prompt 填進輸入處。收件匣那道「使用者看過本文之後接受」的人類閘門**在這條路徑上不成立**：
  它的前提明寫著「本文為第三方逐字撰寫」，而交接的本文由**使用者自己 session 裡的 agent** 撰寫、
  且由他剛剛親口下的一句「交接給 b repo」觸發。要他再同意一次，是在問一個他兩秒前才回答過的問題。
  - **prompt 仍然填好而不送出** —— 那不是同意步驟，是既有的 `agent-intake` 條款，且它保證的是
    「不會有一個 agent 在你沒看著的時候自己跑起來」。切過去按 Enter 即可。
  - **界線 nonce 與攝入正規化照舊保留** —— agent 撰寫的本文仍可能被它讀過的東西塑形（它可能剛讀完
    一則 Slack intake、一個 issue、一份不受信任的 repo 檔案）。**被移除的是人類閘門，不是標示。**
  - **失敗必須更可見，因為沒有人在那個環節** —— 目標查無、folder 已不在 workspace、預填逾時，
    SHALL 發出通知並在 Handoffs 中留下一則可見的失敗項，SHALL NOT 靜默。
  - **交接的次數有界，且上限為全域** —— 自動化之後，一個跑歪的 agent 可以在每個 repo 開 session。
    **以來源 session 為單位計數沒有效力**：落點的位置算得出來，輪流寫進別人的落點就繞過了。
    超過上限時**降級為需要接受**（而非拒絕）。
  - **預填不可能發生時不建立 session** —— 事件回報關閉是一個可事先偵測的恆定成因；照樣建 session
    會讓「建了 → 等 30 秒逾時 → 退回待處理 → 再處理 → 又建一個」成為主幹，**每處理一次多一個
    空的 session，沒有上界**。順帶修掉那條迴圈本身（逾時退回後再次處理不得建第二個 session）。
  - **不自動把焦點切走** —— 使用者在來源 session 說完話之後，agent 通常還在收尾；搶走畫面很糟。
    新 session 出現在 rail 上、發一則通知，點它才過去。

- **修正注入合成對同一個設定 key 的處置** —— 現行合成器是逐鍵覆蓋，而 `hooks` 這個 key 已被事件
  橋接佔用。再加一個貢獻 `hooks` 的功能會把事件橋接整份蓋掉，**而兩者都會回報自己已啟用**。
  這正是既有合成條款要防的失效，只是它的載體沒有涵蓋「同一個 key」。

**不在本 change 內**：回程（b 做完回報 a）、agent 以工具而非寫檔投遞（MCP）、交接內容的格式規範
（那是使用者自己的事 —— 本能力交付的是**傳輸**，不是內容規格）。

## Capabilities

### New Capabilities

- `agent-handoff-source`: session 裡的 agent 把工作交接給 workspace 中另一個 repo。涵蓋：向 agent
  自我介紹的注入、專屬投遞目錄及其生命週期、來源由落點推導、目標以 folder 清單查表解析、以及經
  **既有的投遞契約**交進收件匣。**本能力是收件匣的一個 producer，不是收件匣的一部分** —— 與
  `slack-intake-source` 同一個分界。

### Modified Capabilities

- `agent-intake`: 兩處。
  1. 「接收端可驗證」那一組欄位增加**已解析的目標 folder**（可不存在）。現行條款把該組列舉為
     「adapter、來源種類、來源座標的識別碼」三項，而交接的目標不屬於其中任何一項。
  2. **人類閘門成為有條件的**：現行條款寫「待處理的 intake SHALL 在使用者接受它之前呈現本文全文」，
     其理由段明寫前提是「這三者皆為第三方逐字撰寫」。本能力引入一類**本文非第三方撰寫**的投遞，
     它 SHALL 於到達時直接建立 session 並記為已接受。**長度上限、純文字呈現、界線 nonce、
     攝入正規化一律不放寬** —— 被移除的只有「等使用者按一下」。
  3. **通知的效果依項目狀態而分**：現行條款是「觸發通知把視窗帶到前景並打開收件匣」，而一則
     已接受的交接在收件匣裡沒有任何待辦動作 —— 它的通知應聚焦那個新開的 session。
  4. **「通知只有一種效果」**：現行條款寫「其唯一效果 SHALL 是把使用者帶到收件匣」，被上一條
     直接推翻。改為「唯一效果為**導覽**」—— 它要擋的是「在通知上處置一則 intake」，而導覽到
     哪裡不影響那件事。
  5. **「被拒絕的投遞 SHALL NOT 發出作業系統通知」**：交接的失敗**就是**拒絕，而那條路徑上
     沒有人在等著按接受。加一條例外（來源為自身 agent session 者），並明確排除「尚未被消費的
     解析失敗」—— 那種項目每次補寫都會再被讀到，逐次通知沒有上界。
  6. **「接受一則 intake 於解析出的 folder 建立 agent session」**：作用域由「使用者按下接受」
     改為「session 由 intake 觸發」，否則到達即接受的路徑在字面上不受它約束。
  7. **「第一則 prompt 預先填入」**：可事先偵測的成因由「於接受之前告知」改為「於建立 session
     之前告知且不建立 session」，並補上「逾時退回後再次處理不得建立第二個 session」。
- `intake-routing`: 投遞已帶著接收端解析出的目標 folder 時，SHALL 直接採用而不比對規則；該 folder
  已不在 workspace 中時**仍然拒絕**（與既有的 `FOLDER_GONE` 同處置，不退回 fallback）。
- `claude-status-bridge`: 合成條款增加「**同一個設定 key 的多個貢獻 SHALL 合併而非覆蓋**」。
  既有條款只規範「合成為單一份設定」與「啟用狀態彼此獨立」，其 scenario 全部落在**不同 key**
  的兩個功能上 —— 於是同 key 覆蓋這條失效路徑目前沒有任何載體。

## Impact

**新增**
- `src/main/handoff-*.ts` —— 自我介紹的注入貢獻、專屬投遞目錄的建立與清除、投遞的讀取與轉交、
  目標查表。
- `scripts/probe-handoff.mjs`（或併入 `probe:intake`）＋ `scripts/lib/ports.mjs` 登記。
- `scripts/intake-coverage.test.mjs` 的 `COVERED_CHANGES` 增列本 change，並逐條填 scenario → 載體
  對照表（**「既有」一律要把那條斷言找出來，找不到就寫「無載體」＋理由**）。

**修改**
- `src/main/agent-injection.ts` —— `hooks` 拉成獨立欄位；`settings` 重複 key 視為不變式違反。
- `src/main/terminal.ts` —— 多一個注入貢獻者（**註冊順序承重**）；session 結束時清除投遞目錄。
- `src/main/intake-schema.ts` / `intake-routing.ts` / `intake-service.ts` —— 已定址的投遞。
- `src/main/intake-source.ts` —— 一般化為兩邊共用（**`depth` 要一起參數化** —— 共用落點是扁平的，
  handoff 的是巢狀的；漏掉它的症狀是「即時不進來、重啟才出現」，看起來像時序問題）。
- `src/main/intake-prefill.ts` —— 逾時退回後保留既有 session 的關聯。
- `src/main/intake-notify.ts` / `intake-notify-backend.ts` / `intake-notify-electron.ts` /
  `intake-notify-stub.ts` —— **`onActivate(handler: () => void)` 不帶任何識別，通知效果分流是
  一次介面變更而非參數變更**，三個實作都要跟著改。
- `src/main/index.ts` —— 第三個注入貢獻者、新的投遞來源、通知的接線。
- `src/main/preferences-store.ts` ＋ Settings 對話框 —— 新偏好。**新欄位必須經
  `terminal-preferences` 的「白名單由單一來源推導」補齊三條路徑**（漏掉即型別檢查失敗）。
- `src/main/workspace-store.ts` —— 自我介紹的清單來源與其變動訊號。
- renderer 的收件匣 UI —— 已接受項目的來源與它建立的 session 之呈現。
- `scripts/lib/stub-agent.mjs` —— 目前每個事件只跑第一條 hook 命令且丟掉 stdout；不擴充它，
  「兩條命令皆被執行」與「自我介紹取當下的值」就沒有載體。
- `src/shared/i18n/en.json` —— 新增的使用者可見文案（Handoffs 中的來源呈現、拒絕的說明）。

**新增的失效面**
- 沒有人在接受那個環節 ⇒ 失敗（查無目標、folder 已移除、預填逾時）必須自己發聲。
- 自動開 session ⇒ 交接次數必須有界，且降級方向是「退回需要接受」而不是「拒絕」。

**不受影響**
- session 的建立、context 檔的產生、prompt 的預填、通知與計數標示 —— 全部沿用。
- renderer 的檔案系統邊界：agent 走的是 pty，本來就不受 `(folderId, relPath)` 詞彙約束；
  推給 renderer 的仍然只有已解析的 folder 與純文字。
