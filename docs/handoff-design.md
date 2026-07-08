# Handoff 設計：跨 agent、spec 錨定、可自動接棒

> 狀態：設計草稿（決策已定部分標「已定」，未定標「TODO」）
> 建立：2026-07-08
> 上游：[`concept-cross-agent-handoff.md`](./concept-cross-agent-handoff.md)（為什麼賭 handoff）、[`competitive-analysis.md`](./competitive-analysis.md)（市場態勢）

這份講「handoff 要放進 spek workspace 的話，要做哪些事」——架構、pipeline、已定決策、待決問題。

---

## 0. 決策摘要（已定）

1. **auto-spawn 安全邊界**：同使用者 / 同機的 handoff → 自動開 session；**跨人 / 外部來源 → 先通知、要人核准才 spawn**。預設不無條件全自動。
2. **Store 兩層**：信封（envelope）存**本機 daemon inbox**；內容（payload）**儘量連到 repo 內的 OpenSpec change**、不重抄；**跨機 / 跨人靠 relay**。
3. **Freemium**：**本機單人 handoff 免費**（差異化 + 漏斗、且無 infra 成本）；**跨機 / 跨人 / 跨 agent 自動編排 / 稽核 / 遠端核准付費**（會花錢的 + 隨團隊放大的）。

---

## 1. 參考底：Funliday handoff protocol 已經給了什麼

作者在 Funliday 已有一套實戰驗證的 handoff protocol（跨人 / 跨 repo / 跨角色，以 Redmine wiki 為中央 store）。spek 站在它的模式上，不重造。可直接沿用的觀念：

- **frontmatter schema**：`status` / `from` / `to` / `topic` / `created`，其中 `to` 的 type 可以是 **person / group / repo**——「handoff 給一個 repo」這件事協定裡本來就有。
- **payload 可連到 OpenSpec change**（`<repo>/openspec/changes/<name>/`），不重複維護兩份內容。
- **ack 生命週期**：`open → awaiting-ack → done`（只有 done 進歸檔區）。
- **probe = SessionStart 撈 pending**：session 開始時 pull 出還沒處理的 handoff。

spek 要做的，是把這套從「Redmine 中央 + 被動 pull + 人讀」推到「**本機 daemon + 主動 probe + 自動開 session + 跨異質 agent**」。

> 註：Funliday protocol 是內部規格（Redmine），此處只引用其**機制**當設計靈感，不把其內容納入本商業 repo。實際定 schema 時再回去對照。

---

## 2. spek 要補的三件事

| Funliday 協定現況 | spek 要補的 |
|---|---|
| Redmine wiki 當中央 store | **本機 daemon inbox**（免費）+ **relay**（付費）；不依賴 Redmine |
| SessionStart 被動 pull、人讀 | **主動 probe**：背景 router 監看，`to` 命中它管的 repo 就即時路由 |
| 人的 Claude 讀了自己做 | **自動開新 session + 注入 context**，且**跨異質 agent**（Claude / Codex / Gemini） |

---

## 3. Pipeline

```
session A（repo-A 做完）
  └─ 寫 handoff：to: repo-B、錨定某個 OpenSpec change，
     附「狀態驗證過的」進度（tasks 勾選 / diff 直接讀磁碟，非 agent 自述）
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

---

## 4. 已定決策細節

### 4.1 auto-spawn 安全邊界（已定）

「收到 handoff 就自動跑 agent」本質接近讓來源方在你機器上執行指令，必須有信任邊界：

- **同使用者 / 同機**：可自動開（頂多一個「handoff 到了、已開 session」通知）。
- **跨人 / 外部來源**：**預設先通知、要人按核准才 spawn**，不自動跑。
- **cascade 護欄**：handoff → session → handoff 的無限接力要有深度上限 / 迴圈偵測。（TODO：定上限與偵測方式）

### 4.2 Store 兩層（已定）

關鍵限制：handoff 是「repo-A 寫、給 repo-B 收」，store 必須是**產生方與目標方都搆得到**的地方；純「存 repo-A 內靠 git 同步」解不了跨 repo 路由。

- **信封 = 本機 daemon inbox**（`~/.spek/handoffs/`，workspace 範圍）。router 住在這，看得到本機所有 repo 的 handoff，`to` 命中就路由。**同機跨 repo 完全本機、零 backend。**
- **內容 = 儘量連到 repo 內的 OpenSpec change**，不重抄（沿用 Funliday 建議）。豐富內容跟著 repo 走 git、天然 spec 錨定；handoff 本身只放輕量信封（from / to / status / 錨點指標）。
- **跨機 / 跨人 = relay**（spek 自己的中繼）：本機 daemon 把 outbox 同步到 relay，relay 送到別台機 / 別人的 daemon。
- 旁門（進階、非主線）：單人跨機想省 relay，可把本機 inbox 掛使用者自己的 Dropbox / iCloud / git 同步。

不採「主要存 repo 內用 git 傳」：解不了跨 repo 路由、又會把 `.spek/handoffs/` 塞進版控弄髒 repo。

### 4.3 Freemium 切法（已定）

原則：按**價值放大的邊界**切，不按「handoff 存不存在」切。若把 handoff 整個鎖付費，免費版只剩「terminal 殼 + OpenSpec viewer」，正面對上 cmux（免費 / 原生 / 開源）會輸、沒漏斗。

| | 免費（單人、本機） | 付費（跨機 / 團隊 / 編排） |
|---|---|---|
| 工作台 | 多 session 殼、OpenSpec 側欄 | — |
| Handoff | **本機自己 session / repo 之間**：寫 → daemon probe → 自動開 session | **跨人**路由（隊友 probe 你的 repo）、**跨機**（spek relay）、handoff 歷史 / 稽核 |
| 跨 agent | 手動接力 | **自動編排** Claude→Codex→Gemini（旗艦） |
| 遠端 | — | 手機核准來件 handoff |

理由：免費送的是「無 infra 成本、能驚豔拉新」的本機 handoff；付費收的是「會花錢的 relay + 隨團隊放大的價值」——兩者重疊，付費理由天然站得住。且此線與 claude-view（$0 本機 → 雲付費）、cmux（本機免費 → 雲付費）已驗證的模式一致。防白嫖：本機 handoff 天生受限（一機 / 一人 / 跨 agent 要手動），有隊友、第二台機、或想自動接力就撞牆。

---

## 5. 要做的元件（work breakdown）

1. **Handoff schema** — 沿用 Funliday frontmatter（status / from / to / topic / created），加 spek 專屬：錨點（repo / worktree / branch / change）、產生的 agent + session、**磁碟狀態快照**（tasks 勾選 / diff stat）。格式 agent-agnostic（markdown + frontmatter）。
2. **Store + addressing** — 本機 daemon inbox；repo / workspace 定址 registry（spek 已在管 workspace 的 repo 清單，可當 registry 起點）。
3. **Producer** — 讓任何 agent 寫 handoff 的入口：`spek handoff` CLI（agent 用 bash 就能叫）或檔案慣例，**不是 SDK**。狀態部分由 spek 自動從磁碟推導，agent 只補意圖 / 下一步。
4. **Router / probe daemon** — Electron 主行程背景 watcher：監看 inbox、比對 `to`、依信任邊界路由（自動 / 待核准）、repo 沒開時先進 pending。
5. **Spawner + context 注入器** — 開新 pty session + 把 handoff 餵進目標 agent 的 context；每種 agent 注入方式不同，需抽象層。
6. **Consumer / ack** — 回寫處理紀錄、狀態流轉（open→awaiting-ack→done）、通知發送方 ack。
7. **Relay（付費）** — 跨機 / 跨人的中繼 + 身分 / Team registry + 存取控制。
8. **UI** — handoff inbox、來件通知（跨人的含核准鈕）、自動開的 session 標示「picked up from handoff X」、狀態追蹤。

---

## 6. 開放問題 / TODO

- **Addressing registry**：repo / workspace 全域怎麼命名與解析（Funliday 用 `Team` 頁當 directory；spek 需要等價物）。跨人時 `to` 指向誰的哪個 repo？
- **跨 agent 注入抽象**：Claude / Codex / Gemini CLI 的 context 注入方式不同（prompt / flag / 初始訊息 / 檔案引用），需要一層統一介面。
- **cascade 上限**：自動接力的深度上限與迴圈偵測。
- **產生時機**：agent 結束時主動產生？人手動觸發？從狀態自動推導？——傾向「自動從 ground truth 推導 + agent 補意圖」的混合。
- **schema 共用度**：spek handoff schema 與 Funliday protocol 的共用 / 差異（Funliday 人讀、spek agent 讀 + auto-spawn）。
- **relay 信任模型**：跨人核准的身分驗證、handoff 內容的完整性 / 來源可信。
- **OpenSpec 依賴**：payload 深綁 OpenSpec change；若工作沒有對應 change（ad-hoc）時 handoff 長怎樣。

---

## 7. 下一步

1. 盤點 Funliday handoff protocol 的 frontmatter / body schema，抽出可共用 vs 需調整的部分，定 spek handoff 的最小 schema。
2. 定 addressing registry 的最小模型（先做同機跨 repo，跨人之後）。
3. 做免費核心的最小可行：本機 daemon inbox + `spek handoff` CLI + 同機 auto-spawn + context 注入（先只接 `claude`）。
4. 想清楚 UI 呈現：handoff 是 OpenSpec 側欄裡的一個區塊，還是 session 之間的獨立產物 / inbox。
