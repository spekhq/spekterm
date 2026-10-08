---
title: GitHub Action 與徽章
description: 在 CI 裡為 repository 的 OpenSpec 產出靜態 spek 頁面、部署到 GitHub Pages，並加上狀態徽章。
sidebar:
  order: 3
---

[spek action](https://github.com/marketplace/actions/spek-openspec-static-site) 在你自己的 GitHub Actions 裡，為 repository 的 OpenSpec 產出一個獨立的單一 HTML 頁面 —— 畫面和其他用法相同，內容直接嵌在頁面裡。它也可以產生狀態徽章。

## 基本用法

```yaml
- uses: actions/checkout@v7
  with:
    fetch-depth: 0  # full history, for the changes' dates

- uses: spekhq/spek@v1
  with:
    title: "My Project - OpenSpec"
```

沒有完整的 git 歷史時照樣能建置，只是 change 的日期會無法取得。

## 部署到 GitHub Pages

```yaml
name: Build OpenSpec Site
on:
  push:
    branches: [main]
    paths: ["openspec/**"]

permissions:
  pages: write
  id-token: write

jobs:
  build-and-deploy:
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deploy.outputs.page_url }}
    steps:
      - uses: actions/checkout@v7
        with:
          fetch-depth: 0

      - uses: spekhq/spek@v1
        with:
          title: "My Project - OpenSpec"

      - uses: actions/upload-pages-artifact@v5
        with:
          path: spek-output

      - name: Deploy to GitHub Pages
        id: deploy
        uses: actions/deploy-pages@v5
```

## 輸入與輸出

| 輸入 | 作用 | 預設 |
|---|---|---|
| `repo-path` | 含有 `openspec/` 的目錄 | `.` |
| `output-path` | 頁面的輸出路徑 | `spek-output/spek.html` |
| `title` | 頁面標題 | `OpenSpec Viewer` |
| `spek-version` | 用哪一份 spek 原始碼建置：tag、分支或 commit | `master` |
| `generate-badges` | 一併產生狀態徽章 | `false` |

| 輸出 | |
|---|---|
| `html-path` | 頁面的絕對路徑 |
| `badges-path` | 徽章目錄的絕對路徑 |

`spekhq/spek@v1` 決定用哪個 action；`spek-version` 決定 action 用哪一份 spek 原始碼來建頁面，預設是 spek
的主分支。要固定在某個 release，把 `spek-version` 設成 [spek 的 releases 頁面](https://github.com/spekhq/spek/releases)
上的某個 tag。

## 徽章

設 `generate-badges: true` 時，action 會在頁面旁邊多產生三個 SVG 徽章 —— spec 數量、進行中的 change、task
進度。徽章由 action 自己畫，不會呼叫任何徽章服務。把它們跟頁面一起部署，再從 README 引用：

```markdown
![Specs](https://your-user.github.io/your-repo/badges/specs.svg)
![Open Changes](https://your-user.github.io/your-repo/badges/open_changes.svg)
![Tasks](https://your-user.github.io/your-repo/badges/tasks.svg)
```

## 會執行什麼

action 在你的 workflow 裡執行：在 `spek-version` 取出 spek 的原始碼，從 npm 安裝 spek 的相依套件與 OpenSpec CLI，並在關閉 CLI 使用統計的情況下建置頁面。見 [資料與網路](/zh-tw/spek/docs/reference/data-and-network/)。
