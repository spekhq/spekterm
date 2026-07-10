## 1. workspace store（主行程）

- [ ] 1.1 建立 `src/main/workspace-store.ts`：載入、儲存、加入、移除 folder；`path` 一律以解析 symlink 後的真實路徑保存
- [ ] 1.2 去重以真實路徑為準：同一目錄經由 symlink 路徑再次加入時，清單中只出現一次
- [ ] 1.3 設定檔位於使用者資料目錄，帶有標示結構版本的欄位
- [ ] 1.4 寫入為原子操作：先寫暫存檔再更名，使中途失敗只留下舊內容或新內容
- [ ] 1.5 讀取失敗（JSON 無效、版本不認得、結構不符）時將原檔改名保留、以空 workspace 啟動、輸出一行說明，且**不得**讓啟動失敗
- [ ] 1.6 載入時路徑已不存在或不再是目錄的 folder，標示為失效並保留於清單，不靜默移除
- [ ] 1.7 `hasOpenSpec` 於加入與每次載入時重算，**不寫入設定檔**；判定為單次檔案系統查詢（`openspec/` 存在且為目錄），不執行完整掃描、不呼叫外部程式

## 2. 檔案系統邊界與 `listDir`

- [ ] 2.1 建立純函式（如 `resolveWithinRoot(root, relPath)`）：`relPath` 為絕對路徑即拒絕；對 root 與目標皆解析 symlink 後判定包含關係
- [ ] 2.2 包含關係以 `path.relative(root, target)` 判定（結果不以 `..` 開頭且非絕對路徑）；**不得**以 `startsWith` 字串前綴實作 —— 那會把 `/a/bc` 誤判為位於 `/a/b` 之內
- [ ] 2.3 建立 `src/main/ipc/fs.ts`：`listDir(folderId, relPath)`；`folderId` 向 store 查詢，查無或其 root 已失效即拒絕
- [ ] 2.4 `listDir` 回傳直接子項目的名稱與種類（檔案／目錄／符號連結／其他），不遞迴
- [ ] 2.5 目標不是目錄或不存在時回報錯誤，而非回傳空清單
- [ ] 2.6 邊界檢查全部在主行程執行；preload 與 renderer 不做任何等效檢查

## 3. preload 白名單

- [ ] 3.1 preload 以 `contextBridge` 暴露 `listDir`，介面上不含 `readFile`、`writeFile` 或其他未經本 change 規格定義的能力
- [ ] 3.2 移除 Phase 0 的示範 API `workspace:ping` 及其主行程 handler
- [ ] 3.3 同步更新 `src/preload/index.d.ts` 的型別宣告

## 4. renderer 版面骨架

- [ ] 4.1 加入 `react-resizable-panels` 依賴
- [ ] 4.2 建立 `src/renderer/src/shell/`：活動列、workspace rail、主舞台三個區域，各自可被程式化識別
- [ ] 4.3 三處分界可拖動；每個區域有最小寬度，拖過下限時夾制而不歸零
- [ ] 4.4 分界可由鍵盤方向鍵操作，並具備可被輔助技術辨識的角色語意
- [ ] 4.5 side panel 可收合使主舞台其餘部分佔滿；再次展開時還原收合前的寬度
- [ ] 4.6 活動列呈現雛型的全部入口；`Sessions` 可用且預設選取，其餘呈現為停用並附「尚未可用」提示
- [ ] 4.7 `App.tsx` 的 Phase 0 診斷內容退場：移除信任模型與 worker 的畫面輸出，以及專為驗收而存在的 `data-*` 屬性
- [ ] 4.8 確認 renderer 已無任何模組引用 `monaco-editor` 或 `editor/` wrapper；`src/renderer/src/editor/` 保留於原處供 Phase 2／3 使用

## 5. rail 與 folder 操作

- [ ] 5.1 rail 為每個 folder 呈現一列並顯示名稱；底部提供加入 folder 的入口
- [ ] 5.2 加入入口觸發原生目錄選擇對話框；取消時 workspace 清單不變
- [ ] 5.3 對話框選定路徑後交由 `workspace-store` 處理，UI 不直接碰檔案系統
- [ ] 5.4 不含 `openspec/` 的 folder 於該列明確標示，且其 OpenSpec 身分入口為停用狀態
- [ ] 5.5 路徑失效的 folder 於該列明確標示
- [ ] 5.6 提供移除 folder 的操作；移除只影響 workspace 設定，不更動磁碟上的檔案或目錄
- [ ] 5.7 rail 的 DOM 結構採雛型的巢狀形狀（repo 列可容納子列），但本 change 不實作 session 子層

## 6. 驗證

- [ ] 6.1 建立單元測試指令（`node:test`），加入 `npm test`
- [ ] 6.2 邊界純函式的單元測試：合法子路徑通過；絕對路徑、`..` 逃逸、指向 root 外的 symlink、兄弟目錄前綴（root `/a/b` 對目標 `/a/bc`）皆被拒絕
- [ ] 6.3 `listDir` 的單元測試：混合種類的目錄回報每項名稱與種類且不含子目錄之下的項目；目標為檔案或不存在時回報錯誤而非空清單；未知 `folderId` 被拒絕
- [ ] 6.4 `workspace-store` 的單元測試：realpath 去重、原子寫入、設定檔損毀（無效 JSON／版本不認得）降級為空 workspace 且保留原檔、失效路徑標示、移除 folder 不更動磁碟、`hasOpenSpec` 每次重算且不出現於設定檔（含 `openspec` 為一般檔案的情形）
- [ ] 6.5 改寫 `scripts/probe-shell.mjs`：改以 renderer 的真實狀態斷言 —— 直接呼叫 preload 暴露的 API 驗證白名單、確認該介面上不存在 `readFile` 與 `writeFile`、對真實版面元素的 computed style 驗證 Tailwind、`#root` 有子節點驗證 React 掛載；不再依賴任何為驗收而存在的 `data-*` 屬性
- [ ] 6.6 新增 `scripts/probe-workspace.mjs`，以 `--user-data-dir` 指向暫存 profile（不污染真實設定），驗證：重啟後清單還原且順序一致；設定檔損毀時 app 正常啟動且原檔被保留；rail 正確呈現「含 openspec」「不含 openspec」「路徑失效」三種狀態
- [ ] 6.7 `probe-workspace.mjs` 以 renderer 實際呼叫 preload API：合法子目錄可列出；絕對路徑、`..` 逃逸、symlink 逃逸、未知 `folderId` 一律被拒
- [ ] 6.8 `probe-workspace.mjs` 驗證加入一個含 `openspec/` 與 git 歷史的 folder 時，主行程未為該偵測 spawn 任何外部程式（沿用 `probe-core.mjs` 的行程樹檢視作法）
- [ ] 6.9 新增版面互動的探針覆蓋（獨立腳本或併入 `probe-workspace.mjs`）：三個區域同時存在；拖動分界改變兩側寬度；拖過最小寬度時被夾制而不歸零；分界取得焦點後方向鍵可調整寬度；side panel 收合後主舞台其餘部分佔滿、展開後還原收合前的寬度；活動列 `Sessions` 可用且預設選取，其餘入口為停用
- [ ] 6.10 移除 `scripts/probe-editor.mjs` 及 `package.json` 中的 `probe:editor` 指令
- [ ] 6.11 手動驗證原生目錄對話框（無法以 CDP 驅動）：可開啟、選定後 folder 加入且重啟後仍在、取消時 workspace 清單不變

## 7. 文件回寫

- [ ] 7.1 更新 `openspec/config.yaml` 的 `context:`：技術棧已安裝而非規劃中、狀態為 Phase 1 實作中而非「尚無產品程式碼」
- [ ] 7.2 更新 `CLAUDE.md` 的開發指令：移除 `probe:editor`、新增 `probe:workspace` 與 `npm test`
- [ ] 7.3 於 `CLAUDE.md` 記錄 fs 邊界的兩個坑：包含關係不得以 `startsWith` 判定；TOCTOU 與 hard link 的防護留待 Phase 3 引入寫入時處理，不可沿用「只讀所以還好」
- [ ] 7.4 於 `CLAUDE.md` 的路線圖記下：Phase 2 的 Files 檢視必須重新確立本 change 移除的兩條 Monaco requirement
- [ ] 7.5 更新 `README.md` 的現況段落

## 8. 品質把關

- [ ] 8.1 `npm run typecheck` 通過（main / preload / renderer 三層）
- [ ] 8.2 `npm run lint` 通過
- [ ] 8.3 `npm test` 通過
- [ ] 8.4 `npm run probe:shell`、`npm run probe:workspace`、`npm run probe:native` 皆通過
- [ ] 8.5 於乾淨環境（未經 `npm link`）自工作樹副本執行安裝、建置與啟動，確認應用程式可開啟
