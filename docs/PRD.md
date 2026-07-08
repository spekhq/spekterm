# spek workspace — Product Requirements Document

> 狀態：整合定案（consolidated draft）
> 更新：2026-07-08
> 這份 PRD 是後續開發的**單一權威來源**，已整合先前散落的規劃文件（roadmap / 競品分析 / handoff 概念與設計）。
> 唯一並存的補充素材是 [`workspace-mockup.html`](./workspace-mockup.html) — 定案互動雛型（OpenSpec × terminal × Handoff），因為它是互動原型、無法併入 markdown。

---

## 目錄

1. [產品概述](#1-產品概述)
2. [問題與市場定位](#2-問題與市場定位)
3. [目標使用者與範圍](#3-目標使用者與範圍)
4. [產品原則](#4-產品原則)
5. [功能總覽](#5-功能總覽)
6. [使用者介面與體驗](#6-使用者介面與體驗)
7. [護城河：跨 agent、磁碟狀態驗證的 Handoff](#7-護城河跨-agent磁碟狀態驗證的-handoff)
8. [系統架構](#8-系統架構)
9. [與既有 spek 的關係](#9-與既有-spek-的關係)
10. [商業模式（Freemium）](#10-商業模式freemium)
11. [開發路線圖](#11-開發路線圖)
12. [橫切關注點](#12-橫切關注點)
13. [技術風險與緩解](#13-技術風險與緩解)
14. [開放問題](#14-開放問題)
15. [建議的第一步](#15-建議的第一步)
- [附錄 A：競品詳細檔案](#附錄-a競品詳細檔案)
- [附錄 B：資料來源與信度](#附錄-b資料來源與信度)

---

## 1. 產品概述

**spek workspace** 是一個**以 agent 為核心的本地開發工作台**——一個獨立的 Electron 桌面 app（私有、專有授權），把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，並加上一塊**懂 OpenSpec 結構的側欄**，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

core 邏輯重用開源的 [`@spek/core`](https://github.com/kewang/spek)（MIT）；app 本身封閉、商業授權。

**一句話定位（headline）**：spec-driven 的多 agent 開發工作台。

**護城河（moat，非 headline）**：跨異質 agent、以**磁碟狀態驗證**為核心的**結構化工作交接（handoff）**——一級功能、不綁 OpenSpec，任何 repo 都能用；工作對應到 OpenSpec change 時再額外錨定 change 做語意增強。見 §7。

**現況**：規劃／設計階段，尚未開始實作。UI 已有定案雛型（`workspace-mockup.html`）。

---

## 2. 問題與市場定位

### 2.1 要解的問題

開發者同時跑多個 agent session（多 repo、多 worktree）時：
- 視窗與 session 管理散亂，不知道「哪個 agent 在等我」。
- agent 缺乏共享的、可驗證的上下文；工作在 session／agent／人之間交接時只能靠聊天摘要，會失真。
- 現有 IDE 不理解 spec-driven 工作流（OpenSpec 的 change 生命週期），無法把 spec 上下文與終端機並排。

### 2.2 競爭態勢（摘要，詳細競品檔案見 [附錄 A](#附錄-a競品詳細檔案)）

這是三個不同的 job：

| 軸 | claude-view | cmux | **spek workspace** |
|---|---|---|---|
| 主要用途 | **監看**艦隊（observability） | **駕駛** agent（終端機本體） | **駕駛 + spec 上下文並排** |
| 真 pty terminal | 無 | 有（libghostty） | 有（跑真 `claude`，吃訂閱不吃 API key） |
| 多 session 模型 | 機器級 fleet 攤平 | 視窗級，worktree 自對應 | **repo 級**，一 repo 一 session、多 worktree 多開 |
| spec / OpenSpec-aware | 否 | 否 | **是（核心賣點）** |
| 支援 agent | 僅 Claude Code | 任何 CLI agent（10+） | 僅 Claude（規劃擴充為 agent 中立） |
| 平台 | 本機 + Web／手機；Linux 未到 | **僅 macOS** | Electron（可跨平台） |
| 開源／商業 | MIT + 雲端訂閱 | GPL + 商業授權 | open-core（core MIT + 封閉 app） |
| traction | ~90 stars，早期 | **~23.8k stars，HN #2，YC** | — |

- **claude-view**：旁路儀表板，與 spek 重疊度低。
- **cmux**：正面對手——「一個殼包多個真 terminal agent session」訴求幾乎逐字重疊，且免費／開源／原生／聲量大。**spek 唯一它給不了的，是懂 OpenSpec 的側欄。**

### 2.3 戰略結論

> spek 可守護的差異化**不是**「一個殼包多個 session」（cmux 已用免費／原生／開源佔住），而是「**OpenSpec 工作流的語意深度**（懂 change 生命週期，不只是渲染）**× cmux 到不了的 Windows／Linux**」。

由此導出兩個產品決策：
1. **不綁死單一 `claude`**——agent 中立是放大 TAM 的關鍵，也讓「跨異質 agent handoff」成為可能。
2. **跨平台是被低估的優勢**——cmux 鎖 macOS，Windows／Linux 的 agent 工作台市場現在是空的；**Electron 在此從弱點變武器**。

最該怕的：cmux 生態讓社群拼出「夠用就好」的 spec 側欄。**因此必須把賭注從「會渲染 OpenSpec」推進到「懂 change 生命週期、抄介面抄不走語意」，而且要快**——這正是 handoff（§7）存在的理由。

（各競品的完整 feature／平台／商業模式／traction 見 [附錄 A](#附錄-a競品詳細檔案)。）

### 2.4 SWOT（以 spek workspace 為主體）

**Strengths**
- **唯一 spec-aware 工作台**：OpenSpec 側欄自動跟隨當前 change（deltas / BDD / tasks / graph），兩對手都沒有、也沒宣示要做。這是 workflow 綁定，不是 feature——用 OpenSpec 的人切換成本高。
- **repo / worktree 是一級組織單位**：cmux 的 worktree 還是「自己寫 script」（官方 HN 親口、issue 未結）。
- **不吃 API key、用使用者自己的訂閱**；刻意不重做 Claude Code 已有的 diff / task。
- **open-core 結構清楚**：`@spek/core`（MIT）有機會成為 OpenSpec 生態的標準解析引擎。

**Weaknesses**
- **TAM 最小**：Claude Code ∩ OpenSpec 使用者。cmux 服務所有 CLI agent 使用者，分母大一個數量級。
- **Electron vs 原生**：cmux 把「no Electron」當行銷主軸，終端機這種效能敏感品類 Electron 天生吃虧敘事。
- **封閉商業 app 對上免費 GPL + 23.8k stars**：開發者對「本地功能免費」的預設期待已被錨定。
- **單 agent 依賴**：目前只包 `claude`（已規劃擴充；未擴充前只覆蓋一半桌面）。
- **無聲量基礎**：對手一個 HN #2 + YC、一個迭代極快；spek 尚無社群飛輪。

**Opportunities**
- **跨平台空窗**：cmux 僅 macOS、claude-view 的 Linux 未到。Windows / Linux 上「多 session agent 工作台」沒有強勢玩家——Electron 在這裡反而從弱點變武器。
- **付費意願已被驗證**：$20~$100/月價格帶別人幫忙教育好了。
- **spec-driven development 浪頭**：把自己定位成這個方法論的 reference tooling，而不是「又一個 terminal 管理器」。
- **`@spek/core` 生態槓桿**：MIT 引擎做 VS Code / IntelliJ 甚至 cmux socket API 整合當漏斗，商業 app 收完整工作台的錢。
- **cmux 的 worktree 缺口**：社群正在敲碗、官方還沒做——現在能拿來打的對比點，但窗口不會永遠開著。

**Threats**
- **最大威脅 = cmux 的可程式化 + 社群動能**：有 CLI / socket API + 23.8k stars，任何人週末能拼一個「夠用」的 OpenSpec 側欄 pane。**若差異化只停在「渲染 OpenSpec」，護城河約六個月。**
- **cmux 補上一級 worktree 支援**（需求明確、官方有興趣）→ spek 的組織模型優勢只剩 spec 側欄一條腿。
- **Anthropic 官方向上吃**：Claude Code teams / 官方 session 管理進化；若官方內建多 session + plan/spec 呈現，護城河最薄的先死。
- **claude-view 往 orchestration 爬 + 定義付費天花板**：spek 定價被兩邊夾（cmux 免費、claude-view 錨定天花板）。
- **OpenSpec 普及風險**：差異化全押 OpenSpec；若 spec-driven 收斂到別的格式（或 Anthropic 推自己的 spec 格式），核心賣點陪葬。

---

## 3. 目標使用者與範圍

### 3.1 目標使用者

- 採用 **OpenSpec / spec-driven 工作流**、且同時操作**多個 agent session**（多 repo／多 worktree）的重度開發者。
- 首發平台優先補 **cmux 的空窗**：Windows / Linux 使用者。

### 3.2 明確不做（防止範圍蔓延）

- 不取代 Claude Code 已有的 diff / task 呈現——刻意不重做。
- 不重做 VS Code Extension / IntelliJ Plugin / Demo / Web 版的唯讀檢視器角色（維持現狀）。
- 不做 API-key 代理；跑真 `claude`，用使用者自己的訂閱。

### 3.3 平台

Electron，目標產出 macOS / Windows / Linux 三平台安裝檔。

---

## 4. 產品原則

1. **OpenSpec 是語意核心**：workspace 的差異化建立在懂 OpenSpec change 生命週期。版面上，OpenSpec 是 side panel 的**預設身分**（跟隨 focused session 的 change），與 Files 同層互斥切換、與中央 terminal 並存；repo 沒有 `openspec/` 時退為 Files——核心不因缺 OpenSpec 就殘廢。（版面以 §6 / mockup 為準。）
2. **狀態變更才算數**（延續 spek 立場）：「agent 說做完不算，磁碟上的狀態變更才算」——這條原則直接決定 handoff 的誠實度設計（讀 diff / checkbox，而非 agent 自述），也是 handoff 不必綁 OpenSpec 的底氣：git diff 每個 repo 都有。
3. **agent 中立**：目前只包 `claude`，但介面與資料模型從一開始就為多 agent（Claude / Codex / Gemini …）設計。
4. **重用而非重造**：`@spek/core`（MIT）與 spek 前端元件最大化重用；不重做 Claude Code 已有能力。
5. **信任邊界優先**：fs 寫入、terminal cwd、handoff auto-spawn 都受明確信任邊界約束（同機同人 vs 跨人／外部）。

---

## 5. 功能總覽

| # | 功能 | 說明 | 路線圖 |
|---|---|---|---|
| F1 | 多 folder 工作區 | 加入／移除多個 folder，清單與狀態持久化 | Phase 1 |
| F2 | File Explorer | 多 folder 檔案樹、子目錄 lazy load、chokidar 監控外部變更 | Phase 2 |
| F3 | 檔案檢視／編輯 | Monaco 開檔，syntax highlight、dirty 狀態、`Cmd/Ctrl+S` 存檔 | Phase 2–3 |
| F4 | 多 session terminal | 底部 dock，`node-pty` 多 session，跑 agent 主場，預設 cwd = 選中 folder | Phase 4 |
| F5 | OpenSpec 側欄 | Dashboard / Specs / Changes / Graph，透過 `IpcAdapter` 重用 spek 前端；自動跟隨當前 session 的 change | Phase 5 |
| F6 | 交叉導覽 | spec/change ↔ 底層檔案互跳 | Phase 5 |
| F7 | 打包發佈 | electron-builder 三平台安裝檔、主題、持久化 layout | Phase 6 |
| F8 | Handoff（本機免費） | 寫 handoff → daemon probe → 同機自動開 session + context 注入 | Phase 7（moat）|
| F9 | Handoff（跨機/跨人/編排，付費） | relay、跨人核准、自動編排 Claude→Codex→Gemini、稽核、遠端核准 | Phase 8+ |

---

## 6. 使用者介面與體驗

> **本章以 [`workspace-mockup.html`](./workspace-mockup.html) 為準**——它是定案的高保真互動雛型（OpenSpec / Files × Handoff）。以下文字描述雛型呈現的版面與行為；若文字與 mockup 有出入，以 mockup 為權威。

### 6.1 目標 Layout

**組織主軸**：workspace 以 **repo 為一級單位、session 為其下子項**（呼應 §2「repo 級，一 repo 一 session、多 worktree 多開」），不是檔案總管優先的 IDE 版面。**terminal（跑真 `claude` 的 pty）是主舞台中央**，OpenSpec／Files 是它右側可切換的副手。

**版面三塊**：`① 活動列 ｜ ② workspace rail（repos→sessions）｜ ③ 主舞台`；主舞台內部再分成 `repo header + session 分頁 + （左 terminal ／右 side panel）`。

```
┌────┬─────────────────┬───────────────────────────────────────────────────┐
│ ▤  │ WORKSPACE       │ project-a   2 sessions · master, feat/term         │
│Ses │ ▾📁 project-a  2│    [◈ OpenSpec│▤ Files]  ⤳ Handoff  + session   ⟩  │ ← repo header
│    │   ● master        ├───────────────────────────────────────────────────│
│⤳ 2 │   ● feat/term 待ack│ ●master[multi-folder-explorer]│●feat/term[…]     │ ← session 分頁
│Han │ ▸📁 acme… ①1│─────────────────────────┬─────────────────────────│
│    │ ▸📁 spek-web    ↩│ ~/git/project-a $ claude │ project-a/changes/       │
│ 🔍 │                 │ > 幫我把 FolderRow…      │   multi-folder-explorer  │
│    │                 │ ⏺ Edit(fs.ts) +24 -2     │[本ch│Specs│Changes│Graph]│
│ ⚙  │                 │ > ▏                      │ Tasks 3/9 ▓▓▓░░░░░░      │
│    │                 │                          │ ☑ …   ☐ …               │
│    │                 │   ← 左：純 terminal       │ SPEC DELTAS  WHEN…THEN… │
│    │ [+ Add folder]  │     (pty 跑 claude)       │  → 右：side panel        │
├────┴─────────────────┴─────────────────────────┴─────────────────────────┤
│ ◐ 4 sessions   workspace                             UTF-8   spek ws 0.1  │ ← 狀態列
└───────────────────────────────────────────────────────────────────────────┘
 ①活動列 ②workspace rail  ③主舞台(repo header + session 分頁 + 左 terminal│右 side panel)
```

主舞台只屬於**當前選中的 repo**。分界（活動列｜rail、rail｜主舞台、terminal｜side panel）皆可拖動；side panel 可整個收合讓 terminal 佔滿。

### 6.2 各區塊

- **① 活動列**：`Sessions`（工作台，預設）／`Handoffs`（收件匣，帶待處理 badge）／🔍 搜尋（沿用 spek `Cmd+K`）／⚙ 設定。組織軸是 **Sessions 與 Handoffs**，不是檔案總管——點 `Handoffs` 會把主舞台整個換成 workspace 層級的 Handoff 收件匣（見 §6.4），點 `Sessions` 切回工作台。
- **② workspace rail**：跨 repo 導覽。每個 repo 為一列，可展開露出其下的 session 子列；repo／session 上疊加最急迫的狀態燈與 handoff 標記（incoming badge、`↩ 接棒`、`待 ack`）。底部 `[+ Add folder]`（原生對話框、持久化）。沒有 `openspec/` 的 repo 於此標示（如 mockup 的 spek-web），提示它只能用 Files 身分。
- **③ 主舞台 · repo header**：左邊 repo 身分 + session 聚合資訊；右邊是 `[◈ OpenSpec │ ▤ Files]` segmented switch、`⤳ Handoff`（開 compose）、`+ session`、side panel 收合鈕。
- **③ 主舞台 · session 分頁**：當前 repo 底下每個 session 一個分頁（branch + 狀態燈 + 錨定 change 的 badge）。切分頁 = 切 focused session；OpenSpec side panel 隨 focused session 的 change 更新。
- **③ 主舞台 · 左 terminal**：跑 agent 的主場，`node-pty` 真 pty 跑 `claude`。**terminal 保持純淨**——結尾就是 `claude` 自己的 `>` prompt 行，spek **不另外畫輸入框**。`+ session` 開新 pty（預設 cwd = 當前 repo／worktree）。
- **③ 主舞台 · 右 side panel**：一次只顯示一個身分（OpenSpec 或 Files），見 §6.3。

> 註：本版面刻意**不**把 Monaco 檔案編輯器當主編輯區的一級公民。工作台圍繞「terminal 駕駛 agent + side panel 看 spec／檔案上下文」；深度改檔仍走 agent 或使用者自己的 IDE。Monaco 的角色退為 Files／檔案檢視（F3 編輯能力保留，但不是版面主角）。

### 6.3 Side panel：OpenSpec ↔ Files（同層互斥切換）

OpenSpec 與 Files 是 side panel 的**兩個同層級、互斥的身分**，用 repo header 的 segmented switch 切換，一次只顯示一個，與左側 terminal 並存。

| 身分 | 內容 | 條件 |
|------|------|------|
| `◈ OpenSpec`（預設） | 現有 spek app（本 change／Specs／Changes／Graph），透過 `IpcAdapter` 重用；**自動跟隨 focused session 正在做的 change** | 條件式：repo 要有 `openspec/` 且有 active change 才可用；否則此鈕 disabled/dim |
| `▤ Files` | 當前 repo 的檔案樹（子目錄 lazy load、chokidar 監控、git 狀態 tag） | 恆可用 |

- **OpenSpec 是條件式身分**：沒有 `openspec/` 的 repo（如 mockup 的 spek-web），OpenSpec 鈕 disabled，side panel 退為 Files。這正是「spek 以 OpenSpec 為核心，但版面不因缺 OpenSpec 就殘廢」的體現。
- **本 change 視圖**：change 標題／描述 + tasks 打勾進度（讀磁碟）+ spec deltas（BDD 呈現，ADDED／MODIFIED）。
- **交叉導覽**：spec/change ↔ 底層 `.md` 互跳（保留 spek 現有 UX）。

### 6.4 Handoff 相關 UI（Phase 7+）

對齊 mockup 的五個時刻（Handoff 不綁 OpenSpec，見 §7；同機自動接棒／跨人需核准）：

1. **活動列 `Handoffs` 圖示 + badge**：點擊把主舞台換成 workspace 層級的 **Handoff 收件匣 view**；再點 `Sessions` 切回工作台。
2. **Handoff 收件匣 view**：`收件匣／待你 ack／已完成` 三區，每張卡片含狀態 badge、`from→to`、錨定（有 change 顯示 change slug；ad-hoc 顯示「無 change」）、「狀態驗證進度」（讀磁碟，非 agent 自述）、producer、依狀態的動作鈕。
3. **跨人來件通知橫幅**：router probe 到跨人 handoff、等你核准（含核准／檢視／略過）。
4. **workspace rail 標記**：repo 上 incoming handoff badge、session 上 `↩ 接棒`（同機自動接棒開的）、`待 ack`（已交接出去待對方 ack）。
5. **repo header `⤳ Handoff` 鈕 → compose modal**：手動寫 handoff；`To` 選 repo 或人；「錨定 change」在 focused session 有 change 時自動唯讀帶入、ad-hoc 時留空；下方一句提示同機自動接棒／跨人需核准。自動開的 session 於分頁／rail 標示接棒來源。

---

## 7. 護城河：跨 agent、磁碟狀態驗證的 Handoff

> 定位：這是 spek workspace 的**護城河層**，不是行銷 headline。headline 維持簡單好懂（「spec-driven 的多 agent 開發工作台」）；handoff 是往下證明 moat 的深水區，也是對「為什麼 cmux 抄不走我」的答案。

> **Handoff 是一級功能，不綁 OpenSpec。** spek 以 OpenSpec 為核心沒錯，但 handoff 的守護價值來自「**磁碟狀態驗證**」——讀 git diff／檔案這種每個 repo 都有的 ground truth，任何 repo（含沒有 `openspec/` 的）都能收送 handoff。OpenSpec change 錨定是**選配的增強層**：當這一棒的工作剛好對應到一個 change 時，額外綁上 change slug、讀 tasks.md 打勾、對齊 spec deltas，讓上下文更濃。沒有 change（ad-hoc、或非 OpenSpec repo）時，handoff 退為「git diff 快照 + 自由文字意圖」，仍然是一級、仍然誠實。mockup 已同時畫出兩種：OpenSpec 錨定的 H1／H3，與 ad-hoc 的 H2。

### 7.1 一句話

在包住多個異質 agent session 的工作台裡，讓工作以「**磁碟狀態驗證**」的結構化交接產物，在不同 session / agent（Claude / Codex / Gemini）/ 時間 / 甚至不同人之間傳遞——每一棒都讀得到「這個工作做到哪、diff 長怎樣、上一棒留了什麼雷」；**當工作對應到 OpenSpec change 時，再額外錨定 change（spec 是什麼、tasks 打到哪）把上下文加濃。**

### 7.2 為什麼守得住

| | 商品化（約半年被抄） | 可守護（抄不走） |
|---|---|---|
| 怎麼產生 | 叫 agent 自己總結 | 從**磁碟 ground truth 推導**：git diff + 檔案狀態 + 「下一步 / 雷點」；有 OpenSpec change 時再疊上 tasks 打勾 + spec deltas |
| 誠實度 | agent 自述（會樂觀、會說謊） | **磁碟驗證**：diff 真的存在、checkbox 真的勾才算 |
| 誰能做 | cmux 用 socket API 週末拼一個 | 需跨 session／跨 agent 的狀態驗證管線 + 主動 router；懂 OpenSpec 結構讓錨定的那一棒又更濃——對手資料模型裡沒這層 |

核心信念：**handoff 不是 agent 的自我總結，是對工作當前真實狀態的結構化快照**（有 OpenSpec change 時，快照再對齊到那個 change）。

### 7.3 殺手級組合

```
Claude   做完 proposal / spec  ──handoff──▶
Codex    接手實作              ──handoff──▶
Gemini   跑 review / 測試
```

每一棒交接的不是聊天摘要，而是綁在同一個 OpenSpec change 上、狀態驗證過的產物。這個故事兩個對手都講不出來。

### 7.4 Handoff 產物內容（schema，初步）

格式須 **agent-agnostic**（markdown + frontmatter）。frontmatter 帶狀態、來源、目標、主題與時間（目標可為人、群組或 repo），並有確認的生命週期，加上 spek 專屬欄位。分**核心（恆有）**與 **OpenSpec 增強（選配）**兩層：

**核心欄位（每個 handoff 都有，不依賴 OpenSpec）**
- **錨點**：repo / worktree / branch。
- **進度（狀態驗證）**：目前 diff stat、動到哪些檔案——實際讀磁碟。
- **意圖**：這一棒想達成什麼（自由文字）。
- **交棒內容**：下一步、已知雷 / 卡點 / 決策、需人類拍板的問題。
- **產生者**：哪個 agent、哪個 session、何時。

**OpenSpec 增強欄位（僅當這一棒對應到一個 change 時才帶）**
- **change 錨定**：change slug（把上面的錨點連到具體 change）。
- **tasks 進度**：tasks.md 已勾 / 未勾（實際讀檔）。
- **spec 對齊**：觸及哪些 spec deltas（ADDED / MODIFIED），有無未落實的 requirement。

> 狀態部分由 spek 自動從磁碟推導；agent 只補意圖 / 下一步。傾向「自動從 ground truth 推導 + agent 補充意圖」的混合產生模式。ad-hoc（無 change）時，增強欄位整段省略，卡片上顯示「無 change」（見 mockup H2）。

### 7.5 Pipeline

```
session A（repo-A 做完）
  └─ 寫 handoff：to: repo-B、附「狀態驗證過的」進度（有 change 時另錨定 OpenSpec change）
        │
        ▼
spek 背景 router 主動 probe → 比對 to 命中的 repo-B
        │
        ├─ 同使用者 / 同機 ─────────▶ 直接在 repo-B 自動開新 session
        └─ 跨人 / 外部來源 ─▶ 通知 + 等核准 ─▶ 核准後才開
        │
        ▼
新 session 跑目標 agent，把 handoff 當初始 context 注入（每種 agent 注入方式不同）
        │
        ▼
做完回寫「處理紀錄」+ 更新 status → 通知 A 去 ack（open→awaiting-ack→done）
```

### 7.6 已定決策

1. **auto-spawn 安全邊界**：「收到 handoff 就自動跑 agent」≈ 讓來源方在你機器上執行指令，必須有信任邊界。
   - **同使用者 / 同機**：可自動開（頂多一個「已開 session」通知）。
   - **跨人 / 外部來源**：**預設先通知、要人核准才 spawn**。
   - **cascade 護欄**：handoff → session → handoff 的無限接力要有深度上限 / 迴圈偵測（上限與方式 TODO）。
2. **Store 兩層**：
   - **信封（envelope）= 本機 daemon inbox**（`~/.spek/handoffs/`，workspace 範圍）。router 住這，看得到本機所有 repo 的 handoff，`to` 命中就路由。**同機跨 repo 完全本機、零 backend。**
   - **內容（payload）= 磁碟狀態快照（git diff／檔案）為底**；當工作對應到 change 時，再連到 repo 內的 OpenSpec change、不重抄（豐富內容跟著 repo 走 git、天然 spec 錨定）。無 change 時就只有磁碟快照。
   - **跨機 / 跨人 = relay**（spek 自己的中繼）：本機 daemon 把 outbox 同步到 relay，relay 送到別台機 / 別人的 daemon。
   - **不採**「主要存 repo 內用 git 傳」：解不了跨 repo 路由、又會弄髒版控。
3. **Freemium**：本機單人 handoff 免費；跨機 / 跨人 / 自動編排 / 稽核 / 遠端核准付費（見 §10）。

### 7.7 元件（work breakdown）

1. **Handoff schema** — frontmatter + spek 專屬錨點與磁碟狀態快照（§7.4）。
2. **Store + addressing** — 本機 daemon inbox；repo / workspace 定址 registry（沿用 spek 已管的 workspace repo 清單當起點）。
3. **Producer** — `spek handoff` CLI（agent 用 bash 就能叫）或檔案慣例，**不是 SDK**；狀態由 spek 自動推導。
4. **Router / probe daemon** — Electron 主行程背景 watcher：監看 inbox、比對 `to`、依信任邊界路由、repo 沒開時先進 pending。
5. **Spawner + context 注入器** — 開新 pty session + 把 handoff 餵進目標 agent；每種 agent 注入方式不同，需抽象層。
6. **Consumer / ack** — 回寫處理紀錄、狀態流轉、通知發送方 ack。
7. **Relay（付費）** — 跨機 / 跨人中繼 + 身分 / Team registry + 存取控制。
8. **UI** — 見 §6.4。

---

## 8. 系統架構

### 8.1 為什麼選 Electron

| 需求 | Electron 的優勢 |
|------|----------------|
| Terminal（PTY） | 主行程是 Node，可直接 `node-pty` spawn shell，透過 IPC 串流，不需另架 WebSocket server |
| 讀寫任意檔案 | 桌面 app 信任模型本就允許，不需處理沙盒 / CORS / localhost 綁定 |
| 重用 `@spek/core` | core 是純 Node.js，主行程可直接 import，無需 HTTP 中介 |
| 重用 spek 前端 | renderer 是標準 React + Vite，沿用 spek 的 React 19 / Tailwind v4 |

### 8.2 三層結構

```
@spek/workspace
├── main/        # Electron 主行程（Node）
│   ├── window.ts          # 視窗 / 選單 / 生命週期
│   ├── ipc/               # IPC handlers
│   │   ├── fs.ts          # 讀目錄 / 讀檔 / 寫檔 / 監看（重用 @spek/core）
│   │   ├── terminal.ts    # node-pty 管理（多 session）
│   │   └── openspec.ts    # 呼叫 @spek/core scanner / reader
│   ├── handoff/           # (Phase 7) daemon inbox / router / spawner
│   ├── workspace-store.ts # 多 folder 設定持久化（userData JSON）
│   └── watcher.ts         # chokidar 檔案監控 → IPC push
├── preload/     # contextBridge：把 IPC 包成 type-safe API 暴露給 renderer
└── renderer/    # React app（重用 spek 前端）
    ├── shell/             # 活動列 / 三欄 layout / split panes
    ├── explorer/          # 多 folder 檔案樹
    ├── tabs/              # 全域 tab manager（檔案 + spek 視圖共用）
    ├── editor/            # Monaco wrapper
    ├── terminal/          # xterm.js wrapper
    ├── handoff/           # (Phase 7) 收件匣 / 通知 / compose UI
    └── adapter/IpcAdapter # 實作 spek 的 ApiAdapter 介面（走 IPC）
```

### 8.3 技術選型

| 用途 | 選擇 | 備註 |
|------|------|------|
| App framework | **Electron** + **electron-vite** | 與 spek 既有 Vite 建置一致 |
| 打包 | **electron-builder** | 產出 mac / win / linux |
| 編輯器 | **Monaco Editor** | VS Code 同款；需處理 Vite worker 設定。替代：CodeMirror 6（更輕、Vite 整合單純）——先以 Monaco 技術驗證，視打包大小再定 |
| Terminal UI | **@xterm/xterm** | 搭配 fit / web-links addon |
| PTY | **node-pty** | native 模組，需 `electron-rebuild` 對齊 Electron ABI |
| 檔案監控 | **chokidar** | spek 已用，主行程沿用 |
| 設定持久化 | **electron-store** 或 userData JSON | 多 folder、開啟 tab、layout |
| UI 技術棧 | React 19 + Tailwind v4 + react-markdown | 與 spek 完全一致，最大化重用 |

---

## 9. 與既有 spek 的關係

### 9.1 直接重用

- **`@spek/core`**：scanner、tasks、headings、git-cache、worktrees、types — 主行程直接 import。
- **spek 的 `ApiAdapter` 抽象**：spek 前端已把通訊層抽象成 `ApiAdapter`（Fetch / Message / Static）。Workspace 只要新增一個 **`IpcAdapter`**，既有 spek 頁面（Dashboard / SpecDetail / ChangeDetail / GraphView）幾乎可原封不動在 Electron renderer 跑起來。**這是整合既有畫面的關鍵槓桿。**

### 9.2 需要的抽取（Phase 5）

spek 可重用 React 元件目前住在 `@spek/web`、未對外輸出。抽出一個 **`@spek/ui`** package：
- `ApiAdapter` 介面 + 共用型別
- 可重用頁面 / 元件：Dashboard、SpecDetail、ChangeDetail、GraphView、TabView、markdown 渲染 + BDD 高亮
- 讓 `@spek/web` 與 `@spek/workspace` 同時依賴 `@spek/ui`（此步會動到 web，需回歸測試）。

### 9.3 core 的小幅擴充

目前通用檔案操作（`safeReadDir`、`readFileOrNull`）是 scanner.ts 的私有 helper。抽成 core 公開模組，新增 `listDir` / `readFile` / `writeFile` / `stat`，供 workspace 的 fs IPC 重用。

### 9.4 不動

- VS Code Extension、IntelliJ Plugin、Demo、Web 版維持原本唯讀檢視器角色。

---

## 10. 商業模式（Freemium）

原則：按**價值放大的邊界**切，不按「handoff 存不存在」切。若把 handoff 整個鎖付費，免費版只剩「terminal 殼 + OpenSpec viewer」，正面對上 cmux（免費 / 原生 / 開源）會輸、且沒漏斗。

| | 免費（單人、本機） | 付費（跨機 / 團隊 / 編排） |
|---|---|---|
| 工作台 | 多 session 殼、OpenSpec 側欄 | — |
| Handoff | **本機自己 session / repo 之間**：寫 → daemon probe → 自動開 session | **跨人**路由（隊友 probe 你的 repo）、**跨機**（spek relay）、handoff 歷史 / 稽核 |
| 跨 agent | 手動接力 | **自動編排** Claude→Codex→Gemini（旗艦） |
| 遠端 | — | 手機核准來件 handoff |

- 免費送「無 infra 成本、能驚豔拉新」的本機 handoff；付費收「會花錢的 relay + 隨團隊放大」的價值。
- 與 claude-view（$0 本機 → 雲付費）、cmux（本機免費 → 雲付費）已驗證模式一致。
- 防白嫖：本機 handoff 天生受限（一機 / 一人 / 跨 agent 要手動），有隊友、第二台機、或想自動接力就撞牆。

授權：app 專有、保留所有權利（All rights reserved），私有 repo、非開源；`@spek/core` 維持 MIT。

---

## 11. 開發路線圖

每個 Phase 對應一個（或數個）OpenSpec change，依 CLAUDE.md 工作流 proposal → design → tasks → 實作 → verify → archive。Phase 0–6 建立工作台本體，Phase 7+ 建立護城河（handoff）。

### Phase 0 — 基礎建設與技術驗證（spike）
`@spek/workspace` 能開視窗、renderer 跑起來，並驗證高風險相依。
- 建 package 骨架：electron-vite + React + Tailwind v4 + TypeScript。
- 主行程 import `@spek/core` 成功（印出某 repo 掃描結果）。
- **技術驗證**：node-pty（`electron-rebuild`）能 spawn shell；Monaco 能在 renderer 載入並高亮。
- **風險前置**：node-pty native ABI、Monaco worker 打包。

### Phase 1 — 多 folder 工作區骨架
- Workspace 設定（folder 清單）存 userData，重開記得。
- 活動列 + folder 清單 UI；split panes 三欄骨架。
- IPC：`fs.listDir`（重用 core）。原生對話框加 folder。

### Phase 2 — File Explorer + 唯讀檢視
- 遞迴檔案樹（子目錄 lazy load）。IPC：`fs.readFile`。
- **全域 tab manager**：開檔成 tab；markdown 用 spek 渲染、其餘用 Monaco 唯讀。
- chokidar（主行程）→ IPC push → renderer 更新；外部變更提示重載。

### Phase 3 — 編輯能力
- 多語言 syntax highlight、dirty 狀態、`Cmd/Ctrl+S` 存檔、關閉未存提示。
- IPC：`fs.writeFile`（限制在已加入的 workspace folders 內 → 信任模型）。
- 存檔與外部變更衝突處理。

### Phase 4 — Terminal（agent 主場）
- 主行程：`node-pty` 多 session 管理；IPC 雙向串流。
- xterm.js + fit addon；底部 dock 多 tab、可 resize。
- 新 terminal 預設 cwd = 當前選中 folder。
- session 生命週期（視窗關閉時清理子行程）。

### Phase 5 — 整合既有 spek 視圖
- 抽出 **`@spek/ui`**（§9.2），web 與 workspace 共用（動到 web，需回歸）。
- 實作 **`IpcAdapter`**，主行程用 `@spek/core` 回應。
- OpenSpec home tab：Dashboard / Specs / Changes / Graph。
- 交叉導覽：spec/change ↔ 底層檔案互跳。

### Phase 6 — 打包、設定與發佈
- electron-builder 產出三平台安裝檔。
- 沿用 spek 深色主題（#0a0c0f / amber #f59e0b）、圖示、原生選單。
- 持久化開啟的 tab / layout / 最近工作區。
- （可選）自動更新、CHANGELOG 流程。

### Phase 7 — Handoff 免費核心（moat 起步）
- **Handoff schema**（§7.4）：frontmatter + 錨點 + 磁碟狀態快照。
- **本機 daemon inbox** + repo/workspace addressing registry（沿用已管的 repo 清單）。
- **`spek handoff` CLI**（producer）：狀態由磁碟推導、agent 補意圖。
- **Router / probe daemon**（主行程 watcher）：同機 auto-spawn，跨人先 pending。
- **Spawner + context 注入器**（先只接 `claude`）。
- **Consumer / ack** 流轉（open → awaiting-ack → done）。
- **UI**：收件匣、通知、compose、session「picked up from handoff X」標示。

### Phase 8+ — Handoff 付費層與 agent 擴充
- **Relay**：跨機 / 跨人中繼 + 身分 / Team registry + 存取控制 + 跨人核准。
- **多 agent**：擴充 spawner 注入抽象至 Codex / Gemini；**自動編排** Claude→Codex→Gemini。
- handoff 歷史 / 稽核、手機遠端核准。

---

## 12. 橫切關注點

- **狀態持久化**：工作區 folder、開啟 tab、panel 尺寸、最近專案。
- **快捷鍵 / 命令面板**：沿用 spek `Cmd+K`，擴充為開檔 / 切 tab / 開 terminal / 寫 handoff。
- **主題**：沿用 spek dark/light，Monaco 與 xterm 主題同步。
- **安全 / 信任模型**：
  - fs 寫入與 terminal cwd 限制在已加入的 workspace folders。
  - Electron `contextIsolation: true`、停用 `nodeIntegration`，所有能力走 preload 白名單。
  - handoff auto-spawn 受 §7.6 信任邊界約束（同機同人 vs 跨人核准）。
- **效能**：大目錄樹 lazy load；大檔案 Monaco 上限保護。

---

## 13. 技術風險與緩解

| 風險 | 緩解 |
|------|------|
| node-pty native ABI 對不上 Electron | Phase 0 先用 `electron-rebuild` 驗證；鎖 Electron 版本 |
| Monaco + Vite worker 設定繁瑣 | Phase 0 驗證；必要時退守 CodeMirror 6 |
| `@spek/ui` 抽取波及 web | 抽取前先確保 web 有基本回歸；小步搬移 |
| Electron 安全設定不當 | 預設 contextIsolation + preload 白名單，不開 nodeIntegration |
| 打包體積大 | 評估 Monaco 按需載入 / CodeMirror 取捨 |
| **cmux 用 socket API 拼出「夠用」spec 側欄** | 差異化推進到「懂 change 生命週期」的 handoff 語意深度，且要快（Phase 7 前置） |
| **cmux 補上一級 worktree 支援** | 不只靠組織模型，靠 spec + handoff 雙腿 |
| **Anthropic 官方向上吃**（內建多 session + spec 呈現） | 綁 OpenSpec 語意 + 跨異質 agent，非官方單 agent 能覆蓋 |
| **OpenSpec 若收斂到別的格式** | payload 錨點設計成可換；handoff 抽象不硬綁單一 spec 格式 |
| handoff auto-spawn 被濫用執行指令 | 信任邊界（§7.6）+ cascade 護欄 |

---

## 14. 開放問題

### 工作台
- 首個 change 的最小驗收邊界（建議 `workspace-foundation-spike`）。

### Handoff（多屬 TODO）
- **Addressing registry**：repo / workspace 全域命名與解析；跨人時 `to` 指向誰的哪個 repo？
- **跨 agent 注入抽象**：Claude / Codex / Gemini CLI 的 context 注入方式不同（prompt / flag / 初始訊息 / 檔案引用），需一層統一介面。
- **cascade 上限**：自動接力深度上限與迴圈偵測方式。
- **產生時機**：agent 結束主動產生？人手動觸發？狀態自動推導？（傾向混合）
- **relay 信任模型**：跨人核准的身分驗證、handoff 內容完整性 / 來源可信。
- **OpenSpec 增強層**：核心 / 增強兩層已定（§7.4，不綁 OpenSpec）；待決的是增強欄位的自動偵測——如何判定「這一棒對應到哪個 change」以自動帶入（branch↔change 對應、focused session 上下文、或使用者指定）。
- **UI 呈現**：handoff 是 OpenSpec 側欄裡的一個區塊，還是 session 之間的獨立產物 / inbox？（mockup 目前採 workspace 層級收件匣 + rail badge）

---

## 15. 建議的第一步

1. 先做 **Phase 0** 的 OpenSpec change（package 骨架 + node-pty / Monaco 技術驗證），把最大風險前置清掉。建議命名 `workspace-foundation-spike`。
2. 確認可行後，依 Phase 1 → 6 逐步推進工作台本體，每階段獨立成 change、可單獨驗收。
3. 工作台可用後，進 **Phase 7** 做 handoff 免費核心的最小可行：本機 daemon inbox + `spek handoff` CLI + 同機 auto-spawn + context 注入（先只接 `claude`）——把護城河從概念推進到「用了回不去」。

> 開新 change 用 `/openspec-new-change` 或 `/opsx:new`。

---

## 附錄 A：競品詳細檔案

> 研究：2026-07（官網 + GitHub + Show HN 直取，佐以搜尋）。star 數 / 版本 / 定價為 2026-07 當下快照，會過時，之後重評需重查。

### claude-view（claudeview.ai）—「Claude Code 的監控塔台」

- **解決什麼**：同時跑多個 Claude Code session 時「它們在幹嘛、燒多少錢」。定位：Mission Control for AI coding agents。本質是 **observability 層**，不是工作環境。
- **關鍵 feature**：即時多 session 儀表板、成本 / token 追蹤（細到 cache 讀寫）、全 session 搜尋、sub-agent tree、hook 事件時間軸、worktree branch drift 偵測、Kanban 泳道、遠端核准工作流、手機端監控。
- **平台**：本機 binary / npx / Claude Code plugin + Web dashboard（瀏覽器 / 手機）。macOS 為主，Linux 標示後續版本才到。**無 pty、非終端機**。
- **支援 agent**：僅 Claude Code。
- **商業模式**：實質 open-core——GitHub（tombelieber/claude-view）**MIT**、本地監看免費；付費走雲端 Pro $20/月、Max $100/月、Team $30/人/月、Enterprise。
- **traction**：開發活躍但聲量小，GitHub 約 90 stars，雲端 / 行動功能上線程度未能完全確認。

### cmux（manaflow，YC S24）—「為並行 agent 而生的 macOS 原生終端機」

- **解決什麼**：並行跑一堆 Claude Code / Codex session 時的視窗管理與「哪個 agent 在等我」。定位：不取代 agent，做它們周圍的「玻璃與黏著劑（the glass and glue）」。
- **關鍵 feature**：垂直分頁側欄（git 分支 / 工作目錄 / port / 通知）、通知環、分割窗格（subagent 自動變 pane）、**內建可程式化瀏覽器**、CLI + Unix socket API、tmux 整合（beta）、SSH 遠端驅動、session 還原、GPU 加速（libghostty）。
- **平台**：**僅 macOS**，原生 Swift + AppKit，行銷主打「無 Electron」。iOS 伴侶 app（beta）。**本身就是真 pty 終端機**。
- **支援 agent**：**agent-agnostic**——Claude Code、Codex、OpenCode、Gemini CLI、Aider、Goose、Amp、Cline、Cursor Agent…「任何能從命令列啟動的工具」。
- **worktree**：**不是一級公民**，官方建議「一 worktree 一 tab 自己擺」；GitHub issue（#156、#3414）在要求一級支援，官方目前答案是「自己寫 script 包 CLI」。
- **商業模式**：**GPL-3.0 + 商業授權**，本地免費；Founders Edition 約 $30/月（搶先體驗 + 優先支援）。
- **traction**：2026-02 Show HN #2，GitHub 約 23.8k stars，迭代極快，有繁中在地化官網。

---

## 附錄 B：資料來源與信度

- **高信度（直取）**：[claudeview.ai](https://claudeview.ai/) + [/pricing](https://claudeview.ai/pricing)、[GitHub tombelieber/claude-view](https://github.com/tombelieber/claude-view)（MIT、~90 stars）、[cmux.com/zh-TW](https://cmux.com/zh-TW)、[GitHub manaflow-ai/cmux](https://github.com/manaflow-ai/cmux)（GPL-3.0、~23.8k stars）、[cmux Show HN](https://news.ycombinator.com/item?id=47079718)。
- **中信度（二手佐證）**：cmux worktree issues #156 / #3414、cmux Founders Edition 定價（來自 HN 留言與 GitHub 描述）。
- **未能完全確認**：claude-view 雲端 / 行動功能實際上線程度（有 waitlist 跡象）、其 HN / Product Hunt launch 紀錄（查無）、cmux Founders Edition 正式定價頁。
