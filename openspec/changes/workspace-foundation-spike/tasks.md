## 1. 外部前置（僅驗證結果）

> 更名與發佈的實作由 `spek` repo 自己的 change（建議名 `publish-core-to-npm`）承載 —— OpenSpec change 是 repo-local 的，本 change 無權編輯該 repo（design D5）。此節只驗證前置的**結果**。
>
> 本節不阻擋第 2、3、4 節；僅第 5 節（core 整合）依賴它。

- [x] 1.1 驗證 npm org `spekjs` 已註冊且本帳號為成員：`npm org ls spekjs` 列出 `kewangtw`
- [ ] 1.2 驗證 core 套件已發佈：`npm view @spekjs/core version` 能取得版本號

## 2. Package 骨架與信任模型

- [x] 2.1 以 electron-vite 建立 `main` / `preload` / `renderer` 三層結構，各自對應 Node 與 DOM 環境的 TypeScript 設定
- [x] 2.2 加入 Electron 依賴並**釘死 43.1.0**（精確版本，不用 `^` / `~`），確保建置可重現
- [x] 2.3 於 renderer 設定 React 19 與 Tailwind CSS v4，確認 utility class 的 computed style 生效
- [x] 2.4 主行程於 app ready 後建立 `BrowserWindow` 並載入 renderer 入口，啟動過程無未捕捉例外
- [x] 2.5 `webPreferences` 設定 `contextIsolation: true` 且 `nodeIntegration: false`
- [x] 2.6 preload 以 `contextBridge` 暴露具名 API 白名單（Phase 0 只需一個最小示範 API）
- [x] 2.7 驗證 renderer 中 `typeof require` 為 `undefined`，且未白名單的主行程能力不存在於全域範圍

## 3. node-pty 與 native 模組

- [x] 3.1 加入 `node-pty` 依賴並**釘死 1.2.0-beta.14**（npm 的 `latest` 1.1.0 缺 Linux prebuild，不可用）
- [x] 3.2 驗證安裝未觸發本地編譯：`node_modules/node-pty` 下不存在 `build/` 目錄，安裝輸出無 `node-gyp rebuild` 訊息
- [x] 3.3 驗證 `prebuilds/` 涵蓋六個目標平台：`darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64`、`linux-x64`、`linux-arm64`
- [x] 3.4 確認 `package.json` 不含 `@electron/rebuild` 依賴，也無用於重建 native 模組的 postinstall 步驟
- [x] 3.5 主行程 `require('node-pty')` 並 spawn shell，透過資料事件取得輸出、行程結束回報 exit code 0
- [x] 3.6 於 Unix 類平台驗證取得的是真實偽終端：spawn shell 執行 `tty`，輸出形如 `/dev/pts/*`
- [x] 3.7 撰寫可重複執行的驗證程序，輸出當前 Electron 與 Node.js 的 ABI 編號（`process.versions.modules`）與 N-API 版本，並報告模組載入與 spawn 結果
- [x] 3.8 將「`pty.node` 只引用 `napi_*` 符號、不引用任何 `v8::` 符號」的檢查納入 3.7 的驗證程序

## 4. 編輯器（Monaco）與退守判定

- [x] 4.1 加入 `monaco-editor` 依賴
- [x] 4.2 建立編輯器 wrapper 模組，對外只暴露介面；驗證 renderer 中僅該模組直接 import `monaco-editor`
- [x] 4.3 dev 模式開啟編輯器載入一段 TypeScript 內容，確認完成掛載、呈現語法高亮，且 console 無 worker 載入錯誤
- [x] 4.4 正式建置後啟動應用程式，重複 4.3 的驗證 —— build 模式的 worker 載入路徑與 dev 不同，兩者皆須通過
- [x] 4.5 產出 renderer bundle 體積報告，量出 Monaco 相關 chunk 的貢獻，並與不含 Monaco 的基準比較
- [x] 4.6 依 4.4 與 4.5 的結果判定是否維持 Monaco；若任一項不可行，依 PRD §8.3 原文退守 CodeMirror 6，並更新 `design.md` D3 記錄實測數據與結論

## 5. `@spekjs/core` 整合（依賴第 1 節）

- [ ] 5.1 於 `package.json` 以語意化版本宣告 `@spekjs/core` 依賴，不得使用 `file:` / `link:` / `portal:` 等本機協定
- [ ] 5.2 主行程直接 `import @spekjs/core`，對一個含 `openspec/` 的 repo 路徑呼叫 `scanOpenSpec()`
- [ ] 5.3 驗證回傳物件含 `specs` / `activeChanges` / `archivedChanges` / `defaultSchema`，且 `defaultSchema` 等於該 repo `openspec/config.yaml` 宣告的 schema
- [ ] 5.4 驗證對不含 `openspec/` 的路徑呼叫時回傳空結構，而非拋出例外
- [ ] 5.5 開發模式啟動時，主行程輸出掃描摘要（spec 數量、active change 數量、`defaultSchema`）
- [ ] 5.6 確認掃描過程未為此監聽任何 TCP 埠，結果直接來自行程內函式呼叫

## 6. 文件回寫

- [x] 6.1 更新 `docs/PRD.md` §8.1 / §9.1 / §9.2 / §11：`@spek/core` 更名為 `@spekjs/core`、`@spek/ui` 更名為 `@spekjs/ui`
- [x] 6.2 更新 `docs/PRD.md` §8.3：移除「`node-pty` 需 `electron-rebuild` 對齊 Electron ABI」，改為「須採用 prebuilds 涵蓋全部目標平台的 1.2.0-beta 系列」
- [x] 6.3 更新 `docs/PRD.md` §13：將「node-pty native ABI 對不上 Electron」改寫為「須選用涵蓋目標平台 prebuilt 的版本；Node-API 使其免 `electron-rebuild`」；若 4.6 退守 CM6，一併更新編輯器選型與其風險項
- [x] 6.4 更新 `CLAUDE.md`：清除「`@spek/core` 取得方式」與「Monaco 地位」兩個待決事項，改為記錄已定案的結論
- [x] 6.5 更新 `README.md` 的「現況」段落，反映骨架已建立、不再是「尚未開始實作」

## 7. 品質把關

- [x] 7.1 設定 TypeScript type-check 指令並通過（main / preload / renderer 三層皆納入）
- [x] 7.2 設定 lint 指令並通過
- [x] 7.3 於乾淨環境（未經 `npm link`）自 clone 起執行安裝與啟動，確認應用程式可開啟，證明依賴宣告不依賴本機路徑
