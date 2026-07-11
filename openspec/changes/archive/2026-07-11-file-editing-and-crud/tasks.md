## 1. 主行程：寫入的檔案系統邊界

- [x] 1.1 於 `src/main/fs-boundary.ts` 新增寫入專用的解析：回傳解析後的真實路徑，並提供以 `O_NOFOLLOW`（缺此 flag 的平台退為 `lstat` 二次確認）開啟目標的入口。**不得**讓呼叫端拿字面路徑去 `open`（design D1）
- [x] 1.2 於 `src/main/fs-boundary.test.ts` 補上寫入的邊界測試：`..` 逃逸、指向邊界外的 symlink、兄弟目錄前綴（`/a/bc` vs `/a/b`）
- [x] 1.3 補上「解析與開啟之間 leaf 被替換為越界 symlink」的 race 測試 —— 以 mock 於 `realpath` 回傳後執行替換，斷言寫入失敗且邊界外的檔案未被修改（design D1、實測 [A]）
- [x] 1.4 補上「寫入不取代 folder 內符號連結」的測試：寫入後該路徑仍是 symlink，且其目標內容被更新（design D5）

## 2. 主行程：五個寫入操作

- [x] 2.1 `writeFile`：就地寫入（`O_WRONLY | O_TRUNC | O_NOFOLLOW`），拒絕不存在的目標與目錄目標
- [x] 2.2 `writeFile` 的 mtime 樂觀鎖：寫入前比對 `baseMtimeMs`，不符則回 `CONFLICT` 與磁碟當下的 `mtimeMs`；`baseMtimeMs` 省略時略過比對（design D11）
- [x] 2.3 `createFile`：`O_CREAT | O_EXCL`，既有的 symlink 亦視為已存在；父目錄不存在時拒絕，不自動建立中間目錄（design D6）
- [x] 2.4 `createDirectory`：`mkdir` 非遞迴，目標已存在時拒絕
- [x] 2.5 `deleteEntry`：`fs.rm({ recursive: true })`（已實測不跟隨 symlink），邊界以 `realpath` 檢查完整路徑（design D3、D7）
- [x] 2.6 `rename`：來源與目標**兩端**檢查邊界，且改名前先確認目標不存在（`rename` 會無聲覆蓋，已實測）（design D8）
- [x] 2.7 名稱驗證：空、`.`、`..`、路徑分隔符、NUL、尾端空白或 `.`、Windows 保留名稱。**三平台交集，不依當下執行平台**（design D16）
- [x] 2.8 `src/main/fs-service.test.ts` 覆蓋以上五個操作的成功與各拒絕條件

## 3. 主行程：watcher 的自寫事件抑制

- [x] 3.1 `WatchService` 啟用 `alwaysStat: true`，事件攜帶 `stats.mtimeMs`
- [x] 3.2 寫入成功後把 `(folderId, relPath, mtimeMs)` 記入帶 TTL 的自寫集合；事件命中則丟棄並移除該筆（design D12）
- [x] 3.3 `src/main/watch-service.test.ts`：釘住 `O_TRUNC` + write 實際產生的 `change` 事件序列，斷言「存檔不推事件」與「存檔後的外部變更仍推事件」

## 4. IPC 與 preload 白名單

- [x] 4.1 `src/main/ipc/fs.ts` 註冊五個新 handler，失敗一律以 `{ ok: false, code, detail }` 結果物件跨越 IPC（沿用既有的 `toResult`）
- [x] 4.2 `src/preload/index.ts` 加入五個能力，**並改寫檔頭註解** —— 現行文字逐字寫著「`writeFile` 之所以不在……」
- [x] 4.3 新增 `app.setDirtyState(entries)` 通道供 renderer 推送 dirty 快照（design D15）
- [x] 4.4 更新 `src/preload/index.d.ts` 的型別

## 5. 主行程：視窗關閉的攔截

- [x] 5.1 主行程持有 renderer 推送的 dirty 快照；`window.on('close')` **同步**讀取它決定是否 `preventDefault`（design D15）
- [x] 5.2 以原生 `dialog.showMessageBox` 呈現「儲存全部 / 不儲存並關閉 / 取消」
- [x] 5.3 「儲存全部」走一次 IPC 往返並設逾時，逾時退回對話框

## 6. Renderer：編輯器 wrapper

- [x] 6.1 `src/renderer/src/editor/index.tsx`：`CodeViewer` → `CodeEditor`，新增 `onChange` / `onSave`，`readOnly` 降為選項
- [x] 6.2 於 wrapper 內註冊 `Cmd/Ctrl+S`（monaco 會吃掉該按鍵，全域 `keydown` 攔不到）。**`monaco.KeyMod` 不得洩漏至 wrapper 之外**（design D13）
- [x] 6.3 確認 `eslint` 的 `no-restricted-imports` 仍擋住 wrapper 之外的 `monaco-editor` 引用

## 7. Renderer：dirty buffer 與存檔

- [x] 7.1 新增 workspace 層級的 dirty buffer store，key 為 `${folderId}:${relPath}`，value 含 `text` 與 `baseMtimeMs`。**必須位於 `FilesPanel` 之上** —— 它以 `folder.id` 為 key 掛載（design D9）
- [x] 7.2 `FileViewer` 改為受 buffer 驅動：開啟時優先取 buffer，其次讀磁碟；編輯寫入 buffer
- [x] 7.3 內容改回與磁碟相同時離開 dirty 狀態
- [x] 7.4 存檔流程：成功後清除 buffer 並更新 `baseMtimeMs`
- [x] 7.5 衝突 UI：以我的內容覆寫 / 捨棄並重載 / 取消。三者皆 SHALL NOT 在使用者選擇之前捨棄 buffer（design D11）
- [x] 7.6 焦點不在編輯器時（markdown 預覽）由面板層 `keydown` 接手 `Cmd/Ctrl+S`
- [x] 7.7 dirty 集合變動時推送快照給主行程

## 8. Renderer：markdown 的預覽 / 原始碼切換

- [x] 8.1 檔案檢視加入 `[預覽 │ 原始碼]` 切換，預覽為預設
- [x] 8.2 原始碼模式走 `CodeEditor`（markdown 語言），預覽走既有的 `MarkdownView`
- [x] 8.3 切換模式不捨棄未存的變更；預覽渲染 buffer 的內容而非磁碟的內容
- [x] 8.4 確認 `MarkdownView` 的安全預設未被動到：**不得**加 `rehype-raw`、**不得**覆寫 `urlTransform`

## 9. Renderer：檔案樹的 dirty 標記與 CRUD 入口

- [x] 9.1 `FileTree` 每列在對應檔案有未存變更時呈現標記
- [x] 9.2 Files 面板 header 呈現當前 folder 的未存變更總數（未展開目錄之下的也要計入）（design D10）
- [x] 9.3 樹上的右鍵選單：新增檔案 / 新增資料夾 / 重新命名 / 刪除（design D16）
- [x] 9.4 header 的新增入口，供空目錄與根目錄使用
- [x] 9.5 刪除的確認對話：指出目標；目錄則指出為遞迴刪除
- [x] 9.6 新增 / 改名的名稱驗證與錯誤呈現（介面驗證不取代主行程驗證）
- [x] 9.7 刪除或改名一個有 dirty buffer 的檔案：刪除後捨棄 buffer，改名後 buffer 跟隨新路徑

## 10. 驗收

- [x] 10.1 擴充 `scripts/probe-files.mjs`（或新增探針）覆蓋：編輯 → dirty → 存檔 → 樹上標記消失
- [x] 10.2 探針覆蓋外部變更衝突：存檔前由探針自磁碟改動該檔，斷言出現衝突而非覆蓋
- [x] 10.3 探針覆蓋 CRUD 四個操作與刪除確認
- [x] 10.4 探針覆蓋「存檔不觸發外部變更提示」
- [x] 10.5 `npm run measure:bundle` 仍為零 —— 可編輯之後不得有任何語言服務 worker 進入產物
- [x] 10.6 `npm test`、`npm run typecheck` 全綠

## 11. 文件回寫

- [x] 11.1 `docs/PRD.md` §11 Phase 3：由「`fs.writeFile`」擴充為完整 CRUD，與本 change 的實際範圍一致
- [x] 11.2 `docs/PRD.md` §5 的 F3：補上 CRUD 與 dirty buffer 的跨 folder 存活
- [x] 11.3 `docs/PRD.md` §13 技術風險表：補上「Node 無 `openat`，中間目錄段的 TOCTOU 靠 renderer 拿不到 symlink 來承擔」與「`O_NOFOLLOW` 在 Windows 不存在」
- [x] 11.4 `CLAUDE.md` 現況段：Phase 2 已封存、Phase 3 實作中
- [x] 11.5 `CLAUDE.md`「檔案系統邊界」段：改寫 TOCTOU 與 hard link 的段落，指向本 change 的 design D3；移除「Phase 3 引入 `writeFile` 時此論證不再成立」的預告（它已經發生了）
- [x] 11.6 `CLAUDE.md` 開發指令段：補上本 change 新增或改動的探針
