# spek workspace

商業版 spek —— 一個 agent 開發工作台的獨立 Electron app（私有、專有授權）。

把多個「一個 repo / 資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
加上看得懂 OpenSpec 結構與檔案的輕量瀏覽器。core 邏輯重用開源的
[`@spek/core`](https://github.com/kewang/spek)（MIT）。

## 現況

規劃 / 設計階段，尚未開始實作。

- **`docs/PRD.md`** — **整合定案的產品需求文件（單一權威來源，之後照這份開發）**
  已收斂原本散落的 roadmap／競品分析／handoff 概念與設計，含競品詳細檔案與 SWOT 附錄。
- `docs/workspace-mockup.html` — 定案的多 session layout 互動雛型
  （純 terminal + OpenSpec / Files 同層級並存側欄；OpenSpec 自動跟隨當前 session 的 change）

## 授權

專有，保留所有權利（All rights reserved）。此 repo 為私有，非開源。
