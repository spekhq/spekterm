# spek workspace

商業版 spek —— 一個 agent 開發工作台的獨立 Electron app（私有、專有授權）。

把多個「一個 repo / 資料夾各自一個 `claude` session」的 terminal 包在一個殼裡，
加上看得懂 OpenSpec 結構與檔案的輕量瀏覽器。core 邏輯重用開源的
[`@spekjs/core`](https://github.com/kewang/spek)（MIT）。

## 現況

**Phase 2（`file-explorer-readonly-view`）實作中** —— 可以把 repo 加進 workspace、
瀏覽它的檔案樹並開檔檢視了。terminal 與 OpenSpec 側欄的內容尚未開始。

已驗證可用：

- Electron 43 主行程開視窗、renderer 掛載 React 19 + Tailwind CSS v4
- 信任模型：`contextIsolation` 啟用、`nodeIntegration` 停用，能力只走 preload 白名單；
  renderer 無法導航離開 app、無法開新視窗，外部連結交系統瀏覽器（協定於主行程驗證）
- `node-pty` 在主行程 spawn 出真 pty（Node-API，免 `electron-rebuild`）
- 主行程直接 `import` `@spekjs/core` 掃描 OpenSpec 結構，全程不開任何 TCP 埠
- 多 folder 工作區：原生對話框加入、清單持久化於 `userData`、重啟還原；
  設定檔損毀時以空 workspace 啟動並保留原檔，不讓 app 開不起來
- 活動列 + workspace rail + 主舞台三欄版面，分界可拖動與鍵盤操作，side panel 可收合
- side panel 的 `[◈ OpenSpec │ ▤ Files]` 身分切換；repo 沒有 `openspec/` 時 OpenSpec 停用
- 檔案樹：子目錄展開時才載入、相對修改時間、目錄優先排序，並隨磁碟的外部變更即時更新
  （chokidar，監看集合恆等於展開的目錄集合）
- 檔案檢視：markdown 渲染、其餘以 Monaco 唯讀高亮；過大（> 2 MiB）與二進位檔案明確拒絕；
  檢視中的檔案被外部改動時提示重載
- `listDir` / `readFile` / `watch` 皆受 workspace folder 邊界約束：絕對路徑、`..` 逃逸、
  symlink 越界一律拒絕；watcher 不跟隨 symlink，推送的事件不含絕對路徑

尚未開始：寫檔與存檔、terminal UI、OpenSpec 側欄的內容、handoff。

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
npm test                # 單元測試：fs 邊界、workspace store、listDir/readFile、watcher、外部 URL
npm run probe:shell     # 驗收：開視窗 + 信任模型 + preload 白名單
npm run probe:workspace # 驗收：folder 清單持久化、fs 邊界、三欄版面
npm run probe:files     # 驗收：檔案樹、檔案檢視、身分切換、導航防護、編輯器 worker（dev + build）
npm run probe:native    # 驗收：主行程載入 node-pty 並 spawn 真 pty
npm run probe:core      # 驗收：主行程掃描 OpenSpec，且不開 TCP 埠
npm run measure:bundle  # renderer bundle 體積報告（依編輯器核心／worker／語言歸因）
```

## 授權

專有，保留所有權利（All rights reserved）。此 repo 為私有，非開源。
