# spek workspace

商業版 spek —— 一個 agent 開發工作台的獨立 Electron app（私有、專有授權）。

把多個「一個 repo / 資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
加上看得懂 OpenSpec 結構與檔案的輕量瀏覽器。core 邏輯重用開源的
[`@spekjs/core`](https://github.com/kewang/spek)（MIT）。

## 現況

**Phase 0（`workspace-foundation-spike`）已完成** —— 骨架已可執行，工作台功能尚未開始。

已驗證可用：

- Electron 43 主行程開視窗、renderer 掛載 React 19 + Tailwind CSS v4
- 信任模型：`contextIsolation` 啟用、`nodeIntegration` 停用，能力只走 preload 白名單
- `node-pty` 在主行程 spawn 出真 pty（Node-API，免 `electron-rebuild`）
- Monaco 編輯器與其 Web Worker 於 dev 與 build 兩種模式皆正常
- 主行程直接 `import` `@spekjs/core` 掃描 OpenSpec 結構，全程不開任何 TCP 埠

尚未開始：多 folder 工作區、檔案樹、terminal UI、OpenSpec 側欄、handoff。

### 文件

- **`docs/PRD.md`** — **整合定案的產品需求文件（單一權威來源，之後照這份開發）**
  已收斂原本散落的 roadmap／競品分析／handoff 概念與設計，含競品詳細檔案與 SWOT 附錄。
- `docs/workspace-mockup.html` — 定案的多 session layout 互動雛型
  （純 terminal + OpenSpec / Files 同層級並存側欄；OpenSpec 自動跟隨當前 session 的 change）
- `openspec/changes/` — 各 Phase 的 OpenSpec change（proposal / design / specs / tasks）

## 開發

需要 Node 22.22.0（見 `.nvmrc`）。

```bash
npm install
npm run dev             # 開發模式
npm run build           # 建置至 out/
npm run typecheck       # 型別檢查
npm run probe:shell     # 驗收：開視窗 + 信任模型
npm run probe:native    # 驗收：主行程載入 node-pty 並 spawn 真 pty
npm run probe:editor    # 驗收：Monaco worker（dev + build 兩模式）
npm run measure:bundle  # renderer bundle 體積報告
```

## 授權

專有，保留所有權利（All rights reserved）。此 repo 為私有，非開源。
