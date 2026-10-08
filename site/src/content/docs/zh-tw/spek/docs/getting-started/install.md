---
title: 安裝 spek
description: 在 VS Code 或 JetBrains IDE 裡安裝 spek，或從原始碼啟動網頁版。
sidebar:
  order: 1
---

spek 讀的是含有 `openspec/` 目錄的 repository。下面每一種都呈現同樣的畫面（[瀏覽](/zh-tw/spek/docs/using/browsing/)）；[GitHub Action](/zh-tw/spek/docs/using/github-action/) 則是產出靜態頁面，不在你的電腦上執行。

## VS Code

從 [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=kewang.spek-vscode)
安裝 **spek — OpenSpec Viewer**（[Open VSX](https://open-vsx.org/extension/kewang/spek-vscode) 上也有）。需要 VS Code 1.85 以上。

- workspace 含有 `openspec/config.yaml` 時啟用。
- 活動列的 **spek** 圖示會打開側欄，列出 spec（依資料夾巢狀）與 change；點任何一項就打開完整的檢視面板。
- 指令：**spek: Open spek**、**spek: Search OpenSpec**、**spek: Open Dashboard**。
- 設定：

  | 設定 | 作用 | 預設 |
  |---|---|---|
  | `spek.aggregateWorktrees` | 顯示 repository 所有 git worktree 的 change | `true` |
  | `spek.aggregateJjWorkspaces` | 實驗性：連 jj workspace 一起顯示 | `false` |

  面板上的範圍切換會寫入這兩個設定，改設定也會同步更新切換（[Worktree 聚合](/zh-tw/spek/docs/using/worktrees/)）。

## JetBrains IDE

從 [JetBrains Marketplace](https://plugins.jetbrains.com/plugin/30600-spek--openspec-viewer) 安裝
**spek - OpenSpec Viewer**，或在 **Settings › Plugins › Marketplace** 搜尋「spek」。支援 IntelliJ IDEA、WebStorm、PyCharm、PhpStorm、GoLand、RubyMine、CLion、Rider 等 IntelliJ 系列 IDE，2023.3 以上。

- 專案含有 `openspec/` 目錄時啟用。
- 從右側欄的 **spek** 工具視窗打開，或選 **Tools › Open spek**。
- IDE 有內建瀏覽器（JCEF）時直接在 IDE 裡顯示；沒有的話，改在你的預設瀏覽器打開同一個頁面。
- 這個外掛不做 worktree 聚合。

## 網頁版

網頁版從 spek 的原始碼啟動，沒有發佈成套件。需要 [Node.js](https://nodejs.org/) 22 以上與 git。

```bash
git clone https://github.com/spekhq/spek.git
cd spek
npm install
npm run dev
```

打開 `http://localhost:5173`，輸入含有 `openspec/` 目錄的 repository 路徑，就能開始瀏覽。`npm run dev` 會在本機啟動兩個行程：port 5173 的頁面，以及它讀資料用的 port 3001 的 API（[資料與網路](/zh-tw/spek/docs/reference/data-and-network/)）。

## OpenSpec CLI

spek 自己讀 `openspec/`。如果裝了 [OpenSpec CLI](https://github.com/Fission-AI/OpenSpec)，spek 還會向它查詢 repository 的工作流程 schema；沒裝的話其他功能都正常，只是 spek 能呈現的 schema 資訊比較少。
