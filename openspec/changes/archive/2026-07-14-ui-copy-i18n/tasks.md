## 1. i18n 骨架

- [x] 1.1 安裝 `i18next` 與 `react-i18next`，**寫入 `dependencies` 而非 `devDependencies`**
      （main 的 build 用 `externalizeDepsPlugin()`，i18next 於執行期 require；放錯區塊時 dev
      模式完全正常，但打包後的 app 一啟動就 `MODULE_NOT_FOUND` —— design 的 Risks）
- [x] 1.2 建立 `src/shared/i18n/en.json`（唯一的字典）與 `src/shared/i18n/index.ts`
      （i18next 的 init、`t` 的匯出）
- [x] 1.3 於 `index.ts` 宣告 `CustomTypeOptions`（`resources: { translation: typeof en }`），
      使打錯 key 於 `npm run typecheck` 失敗；並以一次刻意的錯 key 確認它真的失敗（確認後移除）
- [x] 1.4 把 `src/shared/**/*` 加進 `tsconfig.node.json` 與 `tsconfig.web.json` 的 `include`
      （兩份目前分別只涵蓋 `src/main`+`src/preload` 與 `src/renderer`）
- [x] 1.5 renderer 於進入點以 `initReactI18next` 初始化；main 於啟動時初始化同一份字典

## 2. renderer 的文案

- [x] 2.1 `ActivityBar`、`WorkspaceRail`（含 `aria-label` 與 `title`）
- [x] 2.2 `MainStage`、`SidePanel`、`PanelSwitch`
- [x] 2.3 `files/*`：`FilesPanel`、`FileViewer`、`FileTree`、`dialogs`、`names`、`useFileTree`
- [x] 2.4 `files/relative-time.ts`：locale 改由 `i18n.language` 供應（不再寫死 `zh-TW`），
      `剛剛` 進字典
- [x] 2.5 `openspec/*`：`OpenSpecPanel`、`BrowseView`、`ChangeView`、`SpecDetail`、`VizOverlay`、`ui`
      （視圖標籤定為 `This change` / `Browse`；交叉導覽入口定為 `Open in Files` / `View in OpenSpec`）
- [x] 2.6 `terminal/*`：`SessionTabs`、`SessionNameDialog`、`session-badge`、`useSpawnMenu`
      （選項定為 `Run claude` / `Login shell`），以及 `TerminalView` 的**重播分隔線**
      （只有文字進字典，ANSI 與框線字元留在程式碼）
- [x] 2.7 `KeyboardNavigation.tsx` 的 `querySelector`：`aria-label` 改自字典取得
      （硬編它，一次文案改動就會**靜默地**廢掉 `Ctrl+T`）

## 3. 主行程的文案

- [x] 3.1 `unsaved-changes.ts` 的原生對話框（訊息與三顆按鈕）
- [x] 3.2 `terminal.ts` 的 `TerminalError` message 與 `fs-service.ts` 的 failure message
      —— 它們**會被畫在畫面上**（session 的 `wakeError`、FileViewer 的 hint）
- [x] 3.3 `console.*` 與內部不變式的 `throw new Error` 一律改為英文，**但不進字典**
      （`session-store`、`workspace-store`、`terminal`、`sessions.tsx`、`monaco-workers`、
      `main.tsx`、`openspec/data.tsx`、`files/dirty-buffers.tsx`、`preload/index.ts`）

## 4. locale 設定

- [x] 4.1 `src/renderer/index.html` 的 `lang="zh-Hant"` → `lang="en"`

## 5. 守衛：產品原始碼不得含非英文的字串字面值

- [x] 5.1 新增 `scripts/copy-language.test.mjs`：以 TypeScript 的語法樹（`ts.createSourceFile`）
      走訪 `src/**`，字串字面值、模板字面值與 JSX 文字含 CJK 即失敗；**註解豁免**；
      `*.test.ts` 與 `scripts/` 豁免
- [x] 5.2 對照組：一份**刻意含 CJK 字串字面值**的來源必須被偵測到 —— 一道從未證明自己抓得到
      東西的守衛，與沒有守衛無法區分（`naming.test.mjs` 的教訓）
- [x] 5.3 對照組：一份**只有繁中註解**（行註解／區塊註解／JSX 註解）的來源必須通過
- [x] 5.4 接進 `npm test`
- [x] 5.5 新增 `scripts/aria-label-source.test.mjs`：`src/**` 與 `scripts/probe-*.mjs` 的
      `aria-label` 不得硬編（**含本來就是英文的** —— CJK 守衛看不見它們）。豁免 `@spekjs/ui`
      套件自己的 `aria-label`
- [x] 5.6 新增 `scripts/i18n-key-safety.test.mjs`：打錯的 key 必須使型別檢查失敗。
      **這道守的是一份 ambient declaration** —— 拿掉 `i18next.d.ts`，`npm run typecheck`
      照樣 exit 0（已實測）

## 6. 驗收腳本的選擇器

- [x] 6.1 於 `scripts/lib/` 提供自 `en.json` 取文案的 helper
      （`import en from '…/en.json' with { type: 'json' }`；Node 22 已實測支援）
- [x] 6.2 6 支 probe 共 62 處以中文 `aria-label` 構成的選擇器改為自字典取得
      （`probe-shell` / `workspace` / `files` / `terminal` / `keyboard` / `openspec`）
- [x] 6.3 **產品文案與 probe 選擇器必須落在同一個 commit** —— 中間任何一個 commit 都會讓
      6 支 probe 全紅（design 的 Migration Plan）

## 7. 驗證

- [x] 7.1 `npm run typecheck` 與 `npm test`（含新守衛）
- [x] 7.2 `npm run probe:shell` / `probe:workspace` / `probe:files` / `probe:terminal` /
      `probe:keyboard` / `probe:openspec` 全綠
- [x] 7.5 補上兩條沒人守的驗收：`probe:shell` 驗 `lang="en"`、`probe:files` 驗檔案樹的相對
      時間以 UI 的語言呈現（`2 hours ago` / `just now`）
- [x] 7.3 `npm run measure:bundle`：確認 i18next 的加入沒有意外的體積影響
- [x] 7.4 **人審文案**：實際開起 app，逐一走過活動列、rail、主舞台、side panel 的兩個身分與
      各視圖、session 分頁與右鍵選單、各對話框、關窗提示 —— **文案品質是這個 change 唯一無法
      自動驗的東西**，直譯會產出彆扭的英文

## 8. 文件

- [x] 8.1 更新 `CLAUDE.md`：新增 i18n 一節（字典的位置與單一性、守衛的規則與豁免、
      「`aria-label` 同時是選擇器」這條紀律及其兩個受害者：probe 與 `Ctrl+T`）
