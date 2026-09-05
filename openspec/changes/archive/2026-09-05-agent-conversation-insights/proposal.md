## Why

使用者想知道**自己**是怎麼跟 agent 工作的 —— 一次講多長、一段對話幾個來回、什麼時段在跟它講話、
哪個 repo 吃掉最多注意力、什麼時候踩煞車。這些問題的原始資料 Claude Code 一直有寫：每個 session
的 transcript 以 NDJSON 落在 `~/.claude/projects/<cwd-slug>/<session-id>.jsonl`，逐輪追加。

**但那份資料預設只留 30 天，而且正在被刪。** 實測（2026-09-04）：本機 44 個專案目錄、488 個
transcript、1.5 GB，**最舊的一筆是 2026-08-03**。而 spekterm 這個 repo 從 2026-07-07 開始、108 個
commit 全程以 claude 開發 —— **第一個月的對話已經不存在了**。這不是「以後想做再做」的功能：
每多等一天，就多丟一天。

spekterm 是把這件事做好的自然位置，而且它做得到原生 `/insights` 做不到的兩件事：

1. **`/insights` 的範圍是單一 cwd**，而 spekterm 手上有整個 workspace 的 folder 清單 ——
   「我在 acme 跟在 spekterm 的工作方式差在哪」只有這裡答得出來。
2. **`/insights` 產出的是一份 LLM 寫的質性報告**（每次重跑、內容會變、要花 token）。
   使用者要的是**可比較的數字**：同一個指標跨月份放在一起看。

> 本 change 的資料萃取規則參考 [`tony1223/better-agent-terminal`](https://github.com/tony1223/better-agent-terminal)
> （MIT）的 transcript 分類器所記錄的實測結論 —— 其中數條是「不知道就會靜默做錯」的
> （見 `design.md`）。**不複製其原始碼**。

## What Changes

- **新增 transcript 掃描器（主行程）**：讀 `~/.claude/projects/**/*.jsonl`，萃取**列級**紀錄
  （一則 prompt 一列、一次工具呼叫一列），不在掃描階段聚合。
  - 以 **per-file 快取**（路徑／大小／mtime）做增量：首掃實測 24 秒（488 檔、31 萬行），
    之後只重讀當天動過的少數檔案。
  - **不需要 watcher、不需要資料庫、不需要 tail** —— 這是回顧型的功能，不是即時面板。
- **新增列級存檔（userData）**：`~/.config/Spekterm/` 之下的 append-only 紀錄，**比原始
  transcript 活得久**。這是本 change 真正的產物 —— 圖表可以改，資料補不回來。
  - **顆粒度是列，不是圖表。** 存成 histogram 就等於預先決定了未來只能問這幾個問題；
    存成列，任何新指標都可以回頭重算。
  - `message.usage` 的四個 token 欄位**照存但不呈現**（見下）—— 每列多四個整數，
    是對「將來想看成本」唯一的保險。
  - **使用者訊息的完整內文照存。** 「我都怎麼跟 agent 說話」是本 change 最重要的目的之一，
    而它**只有原文答得出來** —— 只留字數等於對內文做了一次最徹底、最不可逆的彙總，
    與本 change 的第一條 requirement 直接矛盾。內文只寫進本機 userData，不離開這台機器。
- **新增全視窗 overlay 呈現十一張圖**。前八張為工作的形狀（使用者已逐張挑選）：一週的節奏
  （星期 × 小時熱圖）、一次坐下來多久、我一次講多長、一段對話幾個來回、我什麼時候踩煞車、
  哪個 repo 花掉我的話、Bash 裡面在跑什麼、我真正在用的 skill。
  後三張為**說話的方式**：我的語氣（問句／祈使／徵詢／修正／確認／禮貌）、中英文的比例、
  我最常說的那幾句。
  - **時間範圍可選，且同一指標可跨期比較** —— 「我這個月跟上個月差在哪」是「可比較的數字」
    這個賣點的實際內容，少了它，存檔累積兩年也只會呈現一個混在一起的總量。
  - **明確不做**：token／成本視圖、每日總量、thinking 比例、工具總分布 —— 使用者逐張看過真實
    資料後排除。資料照存，圖不畫。
  - 圖表**自繪**（DOM／SVG），不引入圖表函式庫 —— `measure:bundle` 的體積守衛仍須為零碼結束。
- **活動列新增一個入口**。這是**對 `docs/workspace-mockup.html` 的偏離** —— 雛型枚舉了活動列的
  入口（Sessions / Handoffs / Search / Settings），本 change 加第五個。不同於 `rail-pinned-repos`
  （雛型對置頂段沉默，故不構成偏離），**這件事雛型講過**，因此需要一次明示的裁決而非默默加上去。
  替代方案（放進 Settings 對話框）已排除：Settings 是放旋鈕的地方，這是內容。
- **`docs/PRD.md` 新增一節**。本 change 不屬於任何既有 Phase（比照 `session-restore`）。

## Capabilities

### New Capabilities

- **`conversation-archive`** —— 掃描、萃取、落盤。它的契約是「**資料在，而且比來源活得久**」：
  萃取哪些欄位、增量掃描的正確性、存檔的顆粒度與保存承諾、以及 transcript 格式漂移時**只丟資料
  不損毀存檔**。這個能力不知道任何一張圖的存在。
- **`conversation-insights`** —— overlay 的呈現與那十一張圖的口徑。它的契約是「**畫出來的數字是它
  自稱的那個量**」：每張圖用哪個統計量（中位數而非平均）、「一次坐下來」如何切段、空資料與
  掃描中的狀態。

### Modified Capabilities

- **`workspace-layout`** —— 「活動列呈現雛型所定義的全部入口」這條 requirement 目前把入口集合
  釘在雛型上。新增第五個入口必須改這條，並記錄偏離的裁決。

### 明確未改（各有理由，不是遺漏）

- **`filesystem-access`** —— `~/.claude/projects` 在 workspace 邊界之外，但這是**主行程自己的
  檔案存取**，與 `repo-branch` 讀 worktree 的 gitdir 同類：renderer 沒有、也不會取得任何路徑
  詞彙，推給它的只有彙總後的數字。白名單一個位元組都不放寬。
- **`keyboard-navigation`** 與 **`quick-open`** —— 兩者抑制快捷鍵的判定皆為
  `document.querySelector('[role="dialog"], [role="menu"]')`（已於原始碼確認：
  `KeyboardNavigation.tsx:186`、`MainStage.tsx:325`），**作用域是整份文件而非某個子樹**。
  新 overlay 只要帶 `role="dialog"` 即自動被兩者尊重，兩份 spec 一個字都不必改。
  **不改是那條設計生效的證據**，而該條件已寫成 `conversation-insights` 的一條 requirement
  —— 讓它成為明文的義務，而不是一個「希望實作記得」的巧合。

  > 提案初稿曾把 `quick-open` 列為必須修改，理由是它的敘述文字提到 Graph／Timeline。
  > 實際讀過該 requirement 後確認：**規範句本身就禁止逐一列舉特定對話框**，那兩個名字只出現
  > 在說明與 scenario 的舉例中。改它反而會把一條已經正確的通則寫回成列舉。

## Impact

| | |
|---|---|
| 主行程 | 新增掃描器與存檔模組；新增 IPC（renderer 只收得到彙總結果，收不到路徑） |
| renderer | 新 overlay 元件 + 十一張自繪圖表；活動列多一個入口 |
| i18n | 新 key 進 `src/shared/i18n/en.json`（三道守衛照舊適用） |
| 驗收 | 新 probe 入口，其 debugging port 須登記於 `scripts/lib/ports.mjs` |
| 文件 | `docs/PRD.md` 新增一節；`docs/lessons/` 視情況新增 transcript 格式的一份 |
| 依賴 | **無新增**。掃描與圖表皆以既有能力實作 |
| 隱私 | 存檔含使用者 prompt 的**完整內文**與工具名稱，**不含檔案內容、不含工具輸出**；只寫進本機 userData，不離開這台機器。畫面上只呈現彙總結果與「高頻的極短訊息」，不提供全文瀏覽 |
