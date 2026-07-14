## Why

**app 的文案是中英混雜的，而中文是主體。** 同一條活動列上並排著 `Handoffs`、`搜尋`、`設定`；
side panel 的身分叫 `Files`，它的空狀態卻說「尚未選擇 repo」；session 的 spawn 目標叫 `claude`，
選單項卻是「跑 claude」。這不是「還沒翻譯完」，是**從未決定過語言**——文案是隨每個 change
順手寫下的，寫的人用什麼語言想事情，UI 就長什麼語言。

spekterm 是一個英文名字的開發者工具，它包住的兩樣東西（`claude` 與 OpenSpec）介面都是英文，
它的使用者是在英文語境裡工作的開發者。**UI 的語言應該是英文**，而現況連「有一個語言」都談不上。

而且**文案沒有任何一層可以住**：約 150 個使用者可見的字串直接硬編在 JSX、`aria-label`、
`title`、主行程的 `dialog.showMessageBox` 與 `TerminalError` 的 message 裡。要換語言就是全域
搜尋取代——而下一個 change 的作者仍然會憑直覺寫下中文，因為沒有東西擋著他。

## What Changes

- **引入 i18n 層**：i18next（主行程 + renderer 共用）+ react-i18next（renderer 的 hook）。
  **只出一份 `en` 字典**——骨架允許日後加語言，但本 change 不做第二份字典、不做切換 UI
  （設定面板尚未實作，做了也沒有入口）。
- **全部使用者可見的文案改為英文，並自程式碼抽離為字典的 key**。四個來源：
  - renderer 的 UI 文案（約 130 處：JSX 文字、`aria-label`、`title`、驗證訊息、空狀態）
  - 主行程的**原生對話框**（關窗時的未存提示：`有 N 個檔案尚未儲存` 與三顆按鈕）
  - 主行程**經 IPC 流到畫面上**的錯誤訊息（`TerminalError` 的 message → session 的
    `wakeError`；`fs-service` 的 failure message → FileViewer 的 hint）
  - **終端裡寫給使用者的那一行**（session 重建時的重播分隔線）
- **locale 設定歸位**：`index.html` 的 `lang="zh-Hant"` → `en`；`relative-time.ts` 的
  `Intl.RelativeTimeFormat('zh-TW')` → `'en'`（否則檔案樹的修改時間會顯示「3 分鐘前」）。
- **新增一道守衛**（比照 `typography.test.mjs` 與 `naming.test.mjs`）：**產品原始碼的字串
  字面值與 JSX 文字不得含 CJK**。註解與文件仍為繁體中文（那是 repo 的既有慣例，不動）。
  少了這道守衛，這個 change 修好的東西會在下一個 change 被重新弄壞。
- **`aria-label` 全面更名的連帶**：`aria-label` 在這個 repo 裡同時是**選擇器**——
  6 支 probe 共 62 處以中文 `aria-label` 選元素，而 `KeyboardNavigation.tsx` 以
  `[aria-label="新增 session"]` 觸發 `Ctrl+T`。**後者是字串比對，改了不會編譯錯，
  Ctrl+T 會靜默失效。** 兩者必須在同一個 change 內同步。
- **不改**：程式碼註解、`docs/`、`openspec/`、probe 腳本自己的輸出訊息（開發工具，不是 app）。

## Capabilities

### New Capabilities

- `ui-localization`: 使用者可見的文案由 i18n 層供應而非硬編於程式碼；語言為英文；主行程與
  renderer 共用同一份字典；並以一道守衛擋住硬編的非英文文案。涵蓋「什麼算使用者可見的文案」
  的界線（含原生對話框、經 IPC 顯示的錯誤訊息、終端裡的訊息、`aria-label` 這類無障礙文字）。

### Modified Capabilities

- `openspec-panel`: 四個 scenario 以中文文案指名控制項（「瀏覽」視圖的入口、「在 Files 中開啟」、
  「在 OpenSpec 中檢視」）。文案改為英文後，這些 scenario 指不到任何東西——以英文文案改寫。
- `keyboard-navigation`: 一個 scenario 以「進 login shell」指名 spawn 選單的選項。同上。
- `file-explorer`: 「相對修改時間（例如「2 小時前」）」的舉例在 locale 改為 `en` 之後不再是
  這個 app 會產生的字串——改為 `2 hours ago`。

## Impact

**新依賴**：`i18next`、`react-i18next`（renderer bundle 增量約 40kB；`measure:bundle` 的
語言服務 worker 守衛不受影響）。

**新程式碼**：一個共用的 i18n 模組（字典 + `t`），main 與 renderer 皆可 import。

**受影響的產品程式碼**（約 150 處文案）：
- renderer：`ActivityBar`、`WorkspaceRail`、`MainStage`、`SidePanel` / `PanelSwitch`、
  `files/*`（`FilesPanel`、`FileViewer`、`FileTree`、`dialogs`、`names`、`useFileTree`、
  `relative-time`）、`openspec/*`（`OpenSpecPanel`、`BrowseView`、`ChangeView`、`SpecDetail`、
  `VizOverlay`、`ui`）、`terminal/*`（`SessionTabs`、`TerminalView`、`SessionNameDialog`、
  `session-badge`、`useSpawnMenu`）、`KeyboardNavigation`
- main：`unsaved-changes`（原生對話框）、`terminal`（`TerminalError` 的 message）、
  `fs-service`（failure message）
- `src/renderer/index.html`（`lang`）

**受影響的驗收**：6 支 probe（`shell` / `workspace` / `files` / `terminal` / `keyboard` /
`openspec`）共 62 處 `aria-label` 選擇器。**這是本 change 最大的靜默失敗風險**——不同步改，
六支全紅；而 `Ctrl+T` 的 querySelector 不同步改，連紅燈都不會有。

**不受影響**：`@spekjs/ui` 的 Graph 與 Timeline（它們的文字來自資料，不是文案）；xterm 與
Monaco 的內建 UI（本來就是英文）。
