# 競品分析：spek workspace vs claudeview.ai vs cmux

> 研究：2026-07（官網 + GitHub + Show HN 直取，佐以搜尋）
> 主體：spek workspace（商業版 agent 開發工作台）
> 用途：釐清市場態勢，支撐「為什麼賭 spec 錨定 handoff」的戰略判斷（見 [`concept-cross-agent-handoff.md`](./concept-cross-agent-handoff.md)）

---

## 核心發現：這是三個不同的 job

- **claude-view 跟 spek 重疊度低**——它是**監看儀表板**（成本 / token / 行為 / 遠端核准），沒有 pty、不是工作環境。它假設你已有自己的終端機，只是多開一個瀏覽器分頁看數字。
- **cmux 才是真正踩在 spek 腳上的**——「一個殼包多個真 terminal agent session + 側欄組織 + 通知」這段訴求跟 spek workspace **幾乎逐字重疊**，而且它免費、GPL 開源、macOS 原生、約 23.8k stars、YC S24、Show HN #2。spek 唯一它給不了的，就是那塊**懂 OpenSpec 的側欄**。

---

## 各產品定位摘要

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

## 訴求差異對照

| 軸 | claude-view | cmux | spek workspace |
|---|---|---|---|
| **主要用途** | **監看**艦隊 | **駕駛** agent（終端機本體） | **駕駛** + spec 上下文並排 |
| **真 pty terminal** | 無 | 有（libghostty） | 有（跑真 `claude`，吃訂閱不吃 API key） |
| **多 session 模型** | 機器級 fleet 攤平 | 視窗級，worktree 靠使用者自對應 | **repo 級**，一 repo 一 session、多 worktree 多開 |
| **spec / OpenSpec-aware** | 否 | 否 | **是（核心賣點）** |
| **支援 agent** | 僅 Claude Code | **任何 CLI agent（10+）** | 僅 Claude Code（規劃中擴充） |
| **平台** | 本機 + Web / 手機；Linux 未到 | **僅 macOS** | Electron（可跨平台） |
| **開源 / 商業** | MIT + 雲端訂閱 | GPL + 商業授權 | open-core（core MIT + 封閉 app） |
| **定價** | Free / $20 / $100 / $30 人 | 免費，付費是搶先體驗 | 商業授權（私有） |
| **traction** | ~90 stars，早期 | ~23.8k stars，HN #2，YC | — |
| **主要差異化** | 成本可視化 + 手機遠端核准 | 原生效能 + 可程式化 + agent 中立 | spec-driven 工作流的上下文並排 |

**講白**：三者是三個不同的 job。claude-view 是旁路儀表板，重疊度低。**cmux 才是正面對手**——terminal 殼那段訴求幾乎逐字重疊，且免費 / 開源 / 原生 / 聲量大。spek 唯一 cmux 給不了的，是懂 OpenSpec 的側欄。

---

## SWOT（以 spek workspace 為主體）

### Strengths
- **唯一 spec-aware 工作台**：OpenSpec 側欄自動跟隨當前 change（deltas / BDD / tasks / graph），兩對手都沒有、也沒宣示要做。這是 workflow 綁定，不是 feature——用 OpenSpec 的人切換成本高。
- **repo / worktree 是一級組織單位**：cmux 的 worktree 還是「自己寫 script」（官方 HN 親口、issue 未結）。
- **不吃 API key、用使用者自己的訂閱**；刻意不重做 Claude Code 已有的 diff / task。
- **open-core 結構清楚**：`@spek/core`（MIT）有機會成為 OpenSpec 生態的標準解析引擎。

### Weaknesses
- **TAM 最小**：Claude Code ∩ OpenSpec 使用者。cmux 服務所有 CLI agent 使用者，分母大一個數量級。
- **Electron vs 原生**：cmux 把「no Electron」當行銷主軸，在終端機這種效能敏感品類，Electron 天生吃虧敘事。
- **封閉商業 app 對上免費 GPL + 23.8k stars**：開發者對「本地功能免費」的預設期待已被錨定。
- **單 agent 依賴**：目前只包 `claude`（已規劃擴充；未擴充前只覆蓋一半桌面，cmux 全吃）。
- **無聲量基礎**：對手一個 HN #2 + YC、一個迭代極快；spek 尚無社群飛輪。

### Opportunities
- **跨平台空窗**：cmux 僅 macOS、claude-view 的 Linux 未到。Windows / Linux 上「多 session agent 工作台」沒有強勢玩家——**Electron 在這裡反而從弱點變武器**。
- **付費意願已被驗證**：$20~$100/月價格帶別人幫忙教育好了。
- **spec-driven development 浪頭**：把自己定位成這個方法論的 reference tooling，而不是「又一個 terminal 管理器」。
- **`@spek/core` 生態槓桿**：MIT 引擎做 VS Code / IntelliJ 甚至 cmux socket API 整合當漏斗，商業 app 收完整工作台的錢。
- **cmux 的 worktree 缺口**：社群正在敲碗、官方還沒做——現在就能拿來打的對比點，但窗口不會永遠開著。

### Threats
- **最大威脅 = cmux 的可程式化 + 社群動能**：有 CLI / socket API + 23.8k stars，任何人週末能拼一個「夠用」的 OpenSpec 側欄 pane。**若差異化只停在「渲染 OpenSpec」，護城河約六個月。**
- **cmux 補上一級 worktree 支援**（需求明確、官方有興趣）→ spek 的組織模型優勢只剩 spec 側欄一條腿。
- **Anthropic 官方向上吃**：Claude Code teams / 官方 session 管理進化（cmux 已在接 teams）；若官方內建多 session + plan/spec 呈現，護城河最薄的先死。
- **claude-view 往 orchestration 爬 + 定義付費天花板**：spek 定價被兩邊夾（cmux 免費、claude-view 錨定天花板）。
- **OpenSpec 普及風險**：差異化全押 OpenSpec；若 spec-driven 收斂到別的格式（或 Anthropic 推自己的 spec 格式），核心賣點陪葬。

---

## 戰略結論

> spek workspace 可守護的差異化**不是**「一個殼包多個 claude session」（那條路 cmux 已用免費 / 原生 / 開源 / 23.8k stars 佔住），而是「**OpenSpec 工作流的語意深度**（懂 change 生命週期，不只是渲染）**× cmux 到不了的 Windows / Linux**」。最該怕的是 cmux 生態讓社群拼出「夠用就好」的 spec 側欄——所以必須把賭注從「會渲染 OpenSpec」推進到「懂 change 生命週期、抄介面抄不走語意」，而且要快。

**兩個由此而生的產品決策：**
1. **不綁死單一 `claude`**（已定）——agent 中立是放大 TAM 的關鍵，也讓「跨異質 agent handoff」成為可能。
2. **跨平台可能是最被低估的優勢**，不是弱點——cmux 鎖 macOS，Windows / Linux 的 agent 工作台市場現在是空的。

由這份分析導出的護城河下注，見 [`concept-cross-agent-handoff.md`](./concept-cross-agent-handoff.md)。

---

## 資料來源與信度

- **高信度（直取）**：[claudeview.ai](https://claudeview.ai/) + [/pricing](https://claudeview.ai/pricing)、[GitHub tombelieber/claude-view](https://github.com/tombelieber/claude-view)（MIT、~90 stars）、[cmux.com/zh-TW](https://cmux.com/zh-TW)、[GitHub manaflow-ai/cmux](https://github.com/manaflow-ai/cmux)（GPL-3.0、~23.8k stars）、[cmux Show HN](https://news.ycombinator.com/item?id=47079718)。
- **中信度（二手佐證）**：cmux worktree issues #156 / #3414、cmux Founders Edition 定價（來自 HN 留言與 GitHub 描述）。
- **未能完全確認**：claude-view 雲端 / 行動功能實際上線程度（有 waitlist 跡象）、其 HN / Product Hunt launch 紀錄（查無）、cmux Founders Edition 正式定價頁。

> 註：star 數 / 版本 / 定價為 2026-07 當下快照，會過時，之後重評需重查。
