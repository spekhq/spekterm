## REMOVED Requirements

### Requirement: Monaco 編輯器在 renderer 載入並提供語法高亮

**Reason**: 這兩條 requirement 的驗收載體是 Phase 0 的診斷頁（`src/renderer/src/App.tsx`），它是 renderer 中唯一 import 編輯器 wrapper 的模組。本 change 以真實版面取代該頁後，`editor/` 不再被任何模組引用，Monaco 連帶不會被打包進 renderer bundle —— app 裡沒有編輯器可以開啟，requirement 的 scenario 無法成立。

規格應描述系統當下為真的行為。Phase 1 的應用程式確實不載入 Monaco；保留「SHALL 載入並高亮」會讓規格說謊。編輯器在 PRD §6.2 的定位是 Files side panel 的檔案檢視，屬 Phase 2／3，屆時才會有真實的使用情境作為載體。

**Migration**: Phase 2 的 Files 檢視實作時，須以該檢視為載體重新確立此 requirement（含 dev 與 build 兩種模式的 worker 驗證）。讓它運作的完整作法 —— Vite `?worker` 後綴搭配全域 `MonacoEnvironment.getWorker`，以及「不可以看到語法高亮就認定 worker 存活，因為 tokenization 在主執行緒完成」這個反直覺的教訓 —— 記錄於封存的 `openspec/changes/archive/2026-07-10-workspace-foundation-spike/design.md` D3。

`src/renderer/src/editor/` 保留於原處供 Phase 2／3 使用，且仍受 `npm run typecheck` 與 `npm run lint` 涵蓋，因此型別層面不會腐化；未受看守的僅是打包與 worker 載入這一層。`scripts/probe-editor.mjs` 隨本 change 移除（已無載體可驗）。

### Requirement: Monaco 對 renderer bundle 的體積貢獻可量測

**Reason**: 同上。Monaco 不再進入 renderer bundle 之後，其體積貢獻恆為零，「與不含 Monaco 的基準相比較」成為同義反覆，此 requirement 不再具有鑑別力。

**Migration**: `npm run measure:bundle` 保留 —— 它產出的是 renderer 資產總覽，Monaco 相關的條目自然歸零。Phase 2 將 Monaco 掛載回 Files 檢視時，須連同此 requirement 一併重新確立，作為是否依 PRD §8.3 退守 CodeMirror 6 的判斷依據。封存的 Phase 0 `design.md` D3 記錄了當時的實測基準：不含 Monaco 為 0.54 MB，含 Monaco 為 20.88 MB，其中 `ts.worker` 佔 12.65 MB。
