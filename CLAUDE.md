# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

spek workspace 是一個以 agent 為核心的本地開發工作台 —— 獨立的 Electron 桌面 app（私有、專有授權），
把多個「一個 repo／資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
並加上一塊懂 OpenSpec 結構的側欄，讓使用者不必另外開 IDE 就能一邊駕駛 agent、一邊看著 spec 上下文。

**現況：規劃／設計階段，尚未開始實作。** 這個 repo 目前只有文件與 OpenSpec 骨架，沒有任何產品程式碼。

### 權威來源

- **`docs/PRD.md`** — 產品需求的**單一權威來源**。任何關於功能範圍、路線圖、架構決策的問題以它為準。
- **`docs/workspace-mockup.html`** — 定案的高保真 UI 互動雛型。**UI 版面與行為以它為權威**；
  PRD §6 的文字若與雛型有出入，以雛型為準。

## Relationship to `spek`

- 開源的 [`spek`](https://github.com/kewang/spek)（MIT）是 OpenSpec 內容檢視器 monorepo，本機 clone 在 `../spek`。
- **本 repo 是獨立的私有 repo**，專有授權（All rights reserved），**不是** spek monorepo 的 npm workspace 成員。
- 計畫重用 `@spek/core`（scanner / tasks / git-cache / worktrees / types）與 spek 的前端元件，
  詳見 `docs/PRD.md` §9。

> **未決事項：`@spek/core` 的取得方式。**
> 它目前在 spek monorepo 裡標記 `"private": true`、沒有 `files` 欄位、且從未發佈到 npm，
> 只能被 spek 自己的 npm workspaces 解析。本 repo 作為獨立 repo，現在無法用任何合法管道 `npm install` 它。
>
> PRD §8.1／§9.1／§11 都預設「主行程可直接 import `@spek/core`」，卻沒有交代跨 repo 怎麼拿到它。
> **這是 Phase 0 的隱藏前置，必須在 `workspace-foundation-spike` 的 design 階段拍板**
> （候選：發佈 `@spek/core` 到 npm public／本機 `file:` 依賴）。

## Tech Stack（規劃中，尚未安裝）

Electron + electron-vite、TypeScript、React 19 + Tailwind CSS v4、node-pty（PTY）、
@xterm/xterm（terminal UI）、chokidar（檔案監控）、electron-builder（打包）。
編輯器選型（Monaco vs CodeMirror 6）未定 —— 見下方「已知的 PRD 內部不一致」。

完整技術選型與理由見 `docs/PRD.md` §8.3。

## Workflow

- **所有變更都必須使用 OpenSpec 工作流程**：每個功能、修復或修改都要先建立 OpenSpec change，
  經過 proposal → design → tasks 流程後再實作。
- 使用 `/openspec-new-change` 或 `/opsx:new` 建立新的 change。
- 實作完成後使用 `/openspec-verify-change` 驗證，再用 `/openspec-archive-change` 封存。
- **Archive 時必須**：更新相關文件（CLAUDE.md、README 等若有影響），並建立 git commit。

### 路線圖與 change 的對應

開發路線圖見 `docs/PRD.md` §11。每個 Phase 對應一個（或數個）OpenSpec change，可單獨驗收。

- **Phase 0** — `workspace-foundation-spike`（尚未建立）：package 骨架 + 高風險相依的技術驗證。
  驗收範圍除了 PRD 列的三項，還必須包含上面「未決事項」的 `@spek/core` 分發方式。
- Phase 1–6 建立工作台本體，Phase 7+ 建立護城河（handoff）。

## Conventions

- 程式碼用英文撰寫
- 註解與文件使用繁體中文（台灣用語）
- 本 repo 的 Node 版本固定在 `.nvmrc`（22.22.0），與 `../spek` 一致

## 已知的 PRD 內部不一致

記錄下來供後續 change 決策時參考，**不要當成已定案的事實**：

- **Monaco 的地位**：PRD §8.3 把 Monaco 列為編輯器首選、§11 把「Monaco 能在 renderer 載入並高亮」
  列為 Phase 0 spike、§13 把「Monaco + Vite worker 設定繁瑣」列為風險。
  但 §6.2 在 mockup 定案後補的註記已將 Monaco 降級為 side panel 的檔案檢視，不再是主編輯區的一級公民。
  Monaco 是否仍值得為它冒 worker 打包風險（CodeMirror 6 同樣能滿足 Phase 3 的 dirty／存檔需求且體積小得多），
  應在 Phase 0 的 design 階段重新評估。
