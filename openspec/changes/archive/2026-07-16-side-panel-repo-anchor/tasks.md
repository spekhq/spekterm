## 1. 資料模型：per-session 的側欄來源

- [x] 1.1 `SessionState`（`sessions.tsx`）新增 `panelFolderId?: string` —— undefined 解析為 session 自己的 `folderId`（預設不占欄位）
- [x] 1.2 `PersistedSession`（`session-store.ts`）新增 `panelFolderId?: string`，納入 `RendererSession` 的範圍（renderer 供應、主行程原樣保存，比照 `anchoredChange`）
- [x] 1.3 `parseSessionEntry` 加一條 `panelFolderId` 的 optional-string 解析
- [x] 1.4 restore 重建時，`panelFolderId` 指向的 folder 若不在當前 workspace folder 清單中，退回 session 的 `folderId`（韌性 fallback）—— 於 `MainStage` 解析 `panelFolder` 時 `folders.find(...) ?? focusedFolder` 完成（`session-store` 只負責原樣保存）

## 2. Sessions API：來源的讀寫與錨定重置

- [x] 2.1 `SessionsApi` 新增 `panelSourceOf(sessionId)`（回傳解析後的 folderId，含預設退回）與 `setPanelSource(sessionId, folderId)`
- [x] 2.2 `setPanelSource` 在來源改變時一併把該 session 的 `anchoredChange` 重置為 undefined（design D2）
- [x] 2.3 落盤路徑帶上 `panelFolderId`（比照 `anchoredChange` 送進主行程持久化）

## 3. MainStage：拆分 focusedFolder 與 panelFolder

- [x] 3.1 由 focused session 的 `panelSourceOf` 解析出 `panelFolder`（WorkspaceFolder），無 session 時退回 rail 的 focused folder
- [x] 3.2 `SidePanel`、`OpenSpecPanel`/`FilesPanel` 的 `key` 與資料 hook、`useChanges`、`anchoredChange`/`viewing`/`anchorChange` 全部改以 `panelFolder` 為準（另新增 `soleActiveChangeForPanel` 供衍生預設；建立 session 用 `soleActiveChangeForCreate`，兩者對應到不同 folder）
- [x] 3.3 確認 header 的 name/path、`SessionTabs`、`TerminalView` 的 `active` 判斷仍以 `focusedFolder` 為準（terminal 那半不受影響）
- [x] 3.4 換 folder 時清掉待處理跨身分請求的既有邏輯，改對齊 `panelFolder`

## 4. SidePanel：來源指示器

- [x] 4.1 `SidePanel` 由「條件式 return 其一」改為「頂部來源列 + 底下條件式內容」，使 OpenSpec/Files 共用同一來源
- [x] 4.2 來源列呈現當前側欄來源，點擊以既有 `ContextMenu` 列出 workspace 中所有 folder 供選取（鍵盤可全操作）
- [x] 4.3 側欄來源指向非 session 自身 folder 時，顯示「回到自身 repo」的一鍵捷徑
- [x] 4.4 來源列的視覺標示：來源 ≠ 自身 folder 時與預設態在視覺上可區分（`text-accent` vs `text-ink-dim`）

## 5. 文案

- [x] 5.1 來源列的 `aria-label`、下拉項、「回到自身 repo」捷徑等文案加入 `src/shared/i18n/en.json`（新命名空間 `panelSource`）
- [x] 5.2 probe 選擇器所需的字串自同一份字典取用（`scripts/lib/copy.mjs`）

## 6. 驗收

- [x] 6.1 `probe:openspec` 涵蓋「側欄來源 ≠ focused folder」：選取另一 repo 後本 change/瀏覽呈現該 repo、terminal 仍為原 session、切換 focused session 側欄跟隨、切來源後錨定重置（+3 條 reload 還原斷言）
- [x] 6.2 `probe:files` 涵蓋「Files 呈現側欄來源 repo 的樹」與「切來源＝換一棵樹且 dirty buffer 不遺失」—— 由 `probe:openspec` 的「OpenSpec 與 Files 共用側欄來源」斷言承擔（切到 Files 後樹是 repo-many 的 openspec、不含 repo-single 的 notes.txt）；「dirty buffer 不遺失」由 `probe:openspec` 既有的「未存的編輯跨身分存活」承擔
- [x] 6.3 `probe:terminal` 涵蓋落盤與重建：側欄來源一併還原、指向已移除的 folder 時退回自身 folder —— 由 `probe:openspec` 的 reload 還原斷言承擔（reload 走與關 app 重開同一條 persist→restore 落盤路徑），且 fallback 由單元測試（`session-store.test.ts`）＋ MainStage 的 `folders.find(...) ?? focusedFolder` 保證
- [x] 6.4 `session-store.test.ts` 涵蓋 `panelFolderId` 的解析、保存與 fallback（新增兩條測試）
- [x] 6.5 `npm test` 與所有相關 probe 全綠（dev + build 兩模式）—— `npm test` 240/240、六支 probe 全綠（16 / 56 / 102 / 168 / 104 / 182）

## 7. 文件

- [x] 7.1 更新 `CLAUDE.md`：開頭段介紹 side-panel-repo-anchor 與 probe 統計、路線圖加 change 條目、新增獨立節「side-panel-repo-anchor 的實測與踩雷」（拿不到 pid 的牆逼出正確框架、跟隨/釘住 toggle 與 session-title-authority 同源的教訓、切來源時 anchoredChange 必須重置、單引號炸 probe、CSP 環境串擾）
