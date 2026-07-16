## 1. 行高：修掉框線的靜態縫（GPU renderer 延後，見 design D2）

- [x] 1.1 `xterm.ts`：預設行高 1.3 → **1.0**（DOM renderer 下框線靠字型 glyph 拼接，glyph 僅約 1em 高，行高 > 1 會讓上下列的 `│` 留縫 —— dogfood 實測「好不少」）
- [x] 1.2 `xterm.ts`：行高納入 `fontOverride`／`resolveLineHeight()`／`setFont`，使用者偏好可覆蓋預設
- [x] 1.3 **GPU renderer（webgl）不在本 change 交付** —— 完整調查與兩條候選解記於 design D2，由下一個 change 承接

## 2. 右鍵 gate 在 mouse reporting；中鍵由終端擁有

- [x] 2.1 `xterm.ts`：`XtermHandle` 新增 `mouseTrackingActive(): boolean`，讀 `term.modes.mouseTrackingMode !== 'none'`（xterm 存取留在 wrapper 內）
- [x] 2.2 `TerminalView.tsx`：`onContextMenu` 一律 `preventDefault()`，僅在 `!mouseTrackingActive()` 時 `setMenu`（右鍵 gate 在 mouse mode）
- [x] 2.3 `TerminalView.tsx`：**中鍵一律由終端擁有**（dogfood 修正）—— host 上的 capture 階段 listener 對 button 1 的 mousedown／mouseup／auxclick 一律 `preventDefault`（擋 native 中鍵貼上，不論它掛在哪個事件）+ `stopPropagation`（不轉發給 xterm/claude），mousedown 時做**唯一一次**貼上；與 mouse reporting 無關（design D1）

## 3. 終端字型：預設系統字型 + wrapper 解析 + setFont

- [x] 3.1 `xterm.ts`：預設 fontFamily 收斂為 `ui-monospace, monospace`（移除幻影 `JetBrains Mono` 與 macOS 專屬 `SF Mono`／`Menlo`）
- [x] 3.2 `xterm.ts`：wrapper 持有 `fontOverride = { family, size, lineHeight }`；`resolveFamily()`＝`override.family ?? 預設鏈`、`resolveSize()`＝`override.size ?? terminalFontSize()`；`fit()` 的字級來源改用 `resolveSize()`（未設偏好時仍跟隨字級尺度）
- [x] 3.3 `xterm.ts`：`XtermHandle` 新增 `setFont({ family, size, lineHeight })` —— 更新 override 並套用 `term.options` 的三個對應欄位

## 4. preferences-store（主行程）

- [x] 4.1 新增 `src/main/preferences-store.ts`：`{ version: 1, terminal: { fontFamily?, fontSize?, lineHeight? } }`，比照 `workspace-store` —— version 欄位、`parsePreferences` 任何不信任回 `null`、`quarantine` 損毀檔、原子寫（temp+rename）、`load()` 永不拋（失敗以空偏好啟動）
- [x] 4.2 `preferences-store.ts`：值驗證 —— `fontSize` 夾制於 8–32、`lineHeight` 夾制於 1–2（分數不取整），`fontFamily` 長度受限、去除控制字元；不合法值拒絕或夾制（spec：不合法的偏好值被拒絕）
- [x] 4.3 `src/main/index.ts`：以 userData 下的 `preferences.json` 實體化並 `load()`
- [x] 4.4 新增 `src/main/preferences-store.test.ts`：parse 正常／損毀回 null／原子寫／值驗證與夾制（比照 `workspace-store.test.ts`，含對照組）

## 5. settings IPC + preload 白名單

- [x] 5.1 新增 `src/main/ipc/settings.ts`：`settings.get()` 回傳偏好；`settings.setTerminalFont(family, size, lineHeight)` 驗證後持久化並回傳更新後偏好；`settings.listMonospaceFonts()` 列舉系統等寬字（dogfood：`fc-list :spacing=100 family`，Linux；他平台回空陣列，design D9）
- [x] 5.2 主行程註冊 `settings.*` handler（比照既有 ipc 模組的註冊點）
- [x] 5.3 `preload/index.ts` 新增 `settings` namespace（`get`／`setTerminalFont`／`listMonospaceFonts`，白名單）；型別由 `WorkspaceApi` 推導
- [x] 5.4 `scripts/probe-shell.mjs`：白名單守衛新增 `settings.*`（`get`／`setTerminalFont`／`listMonospaceFonts`）並確認守衛**真的列舉**這個 namespace（folders.* 曾整個漏掉守衛的教訓）

## 6. renderer 偏好接線

- [x] 6.1 新增 `PreferencesProvider`（renderer context）：掛載時 `settings.get()` 載入，供應當前偏好與 `updateTerminalFont`（persist via IPC + 更新本地 state）
- [x] 6.2 把 `PreferencesProvider` 掛在終端掛載之上（`SessionsProvider` 之上或同層），盡量在終端掛載前備妥偏好
- [x] 6.3 `TerminalView.tsx`：`usePreferences()`，effect 於偏好變動時 `handle.setFont(...)` → `handle.fit()` → 非 null 就 `terminal.resize(...)`；掛載時套用初始偏好

## 7. Settings 介面 + ActivityBar 入口

- [x] 7.1 `ActivityBar.tsx`：Settings 入口 `enabled: true` 並接上 onClick 開啟設定對話框
- [x] 7.2 新增終端字型設定對話框元件（`role="dialog"`）：字型 family **下拉選單**（dogfood：純 `<select>`，選項來自 `listMonospaceFonts`，首項為系統預設；不可打字）、字型 size（number）、行高（number, step 0.1）、回到預設；儲存呼叫 `updateTerminalFont`
- [x] 7.3 **live preview**（dogfood）：以當下選取的 family／size／行高即時渲染範例文字，**含 box-drawing** —— 終端與 preview 同為 DOM renderer，preview 裡框線接不接得起來就是終端裡表格會不會破，使用者能在套用前看出好的組合

## 8. 文案（i18n）

- [x] 8.1 `src/shared/i18n/en.json` 新增設定對話框的所有可見文案與 `aria-label`（含 ActivityBar 的 Settings label 若尚未有）—— 全英文，經字典（守衛：字串字面值不得含 CJK、`aria-label` 不得硬編）

## 9. 驗收（probe + npm test）

- [x] 9.1 `probe:terminal`：右鍵 gate —— stub 以 `printf '\033[?1000h'` 開 mouse mode 時右鍵**不**出現選單、以 `\033[?1000l` 關閉時右鍵**出現**選單。（中鍵「只貼一次」驗不到：兇手是 Chromium native 中鍵貼上，CDP 合成事件不觸發它 —— 由 code review + design D10 承擔）
- [x] 9.3 `probe:workspace`：偏好寫入時主行程夾制 size、清理 family（雙引號）、保留合法行高；字型偏好跨重啟還原；偏好設定檔損毀時仍以預設啟動且原檔改名保留
- [x] 9.4 `probe:shell`：`settings.*` 只暴露白名單方法（含對照組）
- [x] 9.5 `probe:workspace`：Settings 入口為 enabled、觸發後對話框開啟（含 family 下拉／size／行高／預覽）、下拉首項為系統預設、Esc 關閉
- [x] 9.6 `probe:keyboard`：終端字型設定對話框開啟時，導航快捷鍵被抑制（`role="dialog"` 的既有規則多一個受測載體）
- [x] 9.7 `npm test` 全綠（新增的 `preferences-store` 單元測試；既有 typography／aria-label／copy-language／naming 守衛不回歸）；`npm run typecheck` 綠

## 10. 文件

- [x] 10.1 更新 `CLAUDE.md`：右鍵 gate 在 mouse reporting、中鍵由終端擁有（native 中鍵貼上造成雙貼的實測）、行高 1.0 與框線的關係、終端字型的系統預設 + 可設定（下拉 + preview）、Settings 設定介面；**GPU renderer 延後的完整調查**（canvas 對 xterm 6 已死、webgl 廢掉 probe 觀測點、兩條候選解）；同步 probe 描述
- [x] 10.2 更新 `docs/PRD.md`：終端字型「系統預設 + 可設定」的產品決策（§8.3 或相關章節）
