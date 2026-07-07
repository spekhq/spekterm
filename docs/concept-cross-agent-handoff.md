# Concept：跨 agent、spec 錨定的 Handoff

> 狀態：概念草稿（尚未 spec、尚未實作）
> 建立：2026-07-08
> 定位：這是 spek workspace 的**護城河層**，不是行銷 headline。

---

## 一句話

在一個包住多個異質 agent session 的工作台裡，讓工作能以「**OpenSpec change 錨定 + 磁碟狀態驗證**」的結構化交接產物，在不同 session、不同 agent（Claude / Codex / Gemini …）、不同時間、甚至不同人之間傳遞——每一棒都讀得到「這個 change 做到哪、spec 是什麼、上一棒留了什麼雷」。

## 為什麼是這個，而不是「一個殼包多個 terminal」

競品分析（見 [`competitive-analysis.md`](./competitive-analysis.md)）的結論：

- **cmux**（GPL、macOS 原生、23.8k stars）已經用免費 / 原生 / 開源佔住「一個殼包多個真 terminal agent session」這條路。跟它比「terminal 殼」是打不贏也不該打的仗。
- 但 cmux 是 **agent 中立、卻完全沒有共享上下文層**——它管視窗，不管 agent 之間傳什麼。
- **claude-view** 只服務 Claude、而且只做監看（observability），沒有工作交接的概念。

→ 「**異質 agent 之間、spec 錨定的上下文交換層**」是一個**目前沒有人佔住的品類**。這是 spek 可以定義、且對手抄介面也抄不走語意的地方。

## 關鍵分岔：什麼樣的 handoff 才守得住

| | 商品化（約半年被抄） | 可守護（抄不走） |
|---|---|---|
| 怎麼產生 | 叫 agent 自己總結「我做了什麼」 | **錨定在 change 上**：spec deltas + tasks 打勾狀態 + git diff + 「下一步 / 雷點」 |
| 誠實度 | agent 自述（會說謊、會樂觀） | **用磁碟上的 ground truth 驗證過**：checkbox 真的勾了、diff 真的存在才算數 |
| 誰能做 | cmux 用 socket API 週末拼一個 | 需要懂 OpenSpec 結構 + 跨 session 狀態，對手的資料模型裡沒有這層 |

核心信念（延續 spek「agent 說做完不算，狀態變更才算」的立場）：
**handoff 不是 agent 的自我總結，是對 change 當前真實狀態的結構化快照。**

## 殺手級組合：多 agent × handoff

這也是「不綁死單一 `claude`、之後加其他 agent」這個決定為什麼讓 handoff 更值錢：

```
Claude   做完 proposal / spec  ──handoff──▶
Codex    接手實作              ──handoff──▶
Gemini   跑 review / 測試
```

每一棒交接的不是一段聊天摘要，而是綁在同一個 OpenSpec change 上、狀態驗證過的交接產物。這個故事兩個對手都講不出來。

## Handoff 產物該包含什麼（初步）

以 OpenSpec change 為錨，一份 handoff 至少涵蓋：

- **錨點**：repo / worktree / branch / change slug。
- **意圖**：這個 change 要達成什麼（引用 proposal）。
- **進度（狀態驗證）**：tasks.md 已勾 / 未勾（實際讀檔，非 agent 自述）、目前 diff stat。
- **spec 對齊**：這一棒觸及哪些 spec deltas（ADDED / MODIFIED），有沒有還沒落實的 requirement。
- **交棒內容**：下一步該做什麼、已知的雷 / 卡點 / 決策、需要人類拍板的問題。
- **產生者**：哪個 agent、哪個 session、何時。

格式要 **agent-agnostic**（任何 agent 都能產生 / 消費），可能是帶 frontmatter 的 markdown——參考作者自己在 Funliday 已在用的 handoff protocol（Redmine wiki 上的 frontmatter schema / body 結構 / parent 規則），那套是真實驗證過的 founder-fit 起點，不是憑空設計。

## 定位：moat，不是 headline

- **Headline** 維持簡單好懂：「spec-driven 的多 agent 開發工作台」。
- **Handoff + 多 agent** 是往下證明 moat 的深水區——留給「用了回不去」的體驗，也是對「為什麼 cmux 抄不走我」這個問題的答案。

## 風險 / 開放問題

- **小 TAM 再強化**：只有 spec-driven + 多 agent 重度使用者會用；它是黏著層不是獲客層。
- **價值線性依賴平行度**：一人一次一個 agent 幾乎無感；多 repo 多 agent 交錯跑才救命。
- **誰寫、何時寫**：agent 主動在結束時產生？人類手動觸發？從狀態自動推導？——傾向「自動從 ground truth 推導 + agent 補充意圖」的混合。
- **下一棒怎麼消費**：把 handoff 餵進下一個 agent 的 context 是靠 prompt 注入還是檔案引用？跨異質 agent 的注入方式不同，需要抽象。
- **與 OpenSpec 深綁的代價**：差異化全押 OpenSpec；若 spec-driven 工作流收斂到別的格式，這層要能換錨點。
- **與 handoff protocol 的關係**：作者的 Funliday handoff protocol 是「跨人 / 跨 repo / 跨角色」的文件交接；這裡要的是「跨 agent / 跨 session」的工作交接。兩者 schema 可能共用，但消費端（人 vs agent）不同，需釐清是同一機制還是兩套。

## 下一步（之後展開用）

1. 盤點 Funliday handoff protocol 的 schema，抽出可共用 / 需調整的部分。
2. 定義 handoff 產物的最小 schema（錨點 + 狀態 + 交棒內容）。
3. 決定產生時機與消費方式（跨異質 agent 的 context 注入抽象）。
4. 想清楚它在 mockup 裡怎麼呈現（是 OpenSpec 側欄裡的一個 change 視圖區塊？還是 session 之間的獨立產物？）。
