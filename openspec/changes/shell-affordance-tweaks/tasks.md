## 1. 移除 menu bar

- [x] 1.1 `src/main/index.ts` 的 `createWindow`：移除 `autoHideMenuBar: true`，改為移除整個 menu（`Menu.setApplicationMenu(null)` 或等效），使 `Alt` 不叫出任何 menu

## 2. 精簡建立 session 的入口文字

- [x] 2.1 `SessionTabs.tsx` 兩處可見文字「+ session」→「+」（空狀態列與分頁列旁）
- [x] 2.2 確認 `aria-label` 仍為 `t('sessions.new')` 不動 —— 它是 probe 與 `Ctrl+T` 的選擇器

## 3. Ctrl+Shift+W 關閉當前 session

- [x] 3.1 `KeyboardNavigation.tsx` 加 `Ctrl+Shift+W` 的處理：關閉 `sessions.focusedIdFor(selectedId)` 取得的當前 session，攔截於 window 的 capture 階段
- [x] 3.2 沒有選中的 repo 或該 repo 無 session 時為無操作；對話框／overlay 開啟時不生效（沿用 `[role="dialog"]` 判定；由 `KeyboardNavigation` 頂端既有的 `[role="dialog"], [role="menu"]` 判定承擔）

## 4. 驗收

- [x] 4.1 `probe:keyboard` 新增 `Ctrl+Shift+W` 的驗收：關閉當前 session、終端持有焦點時仍生效（按鍵不進 pty 由對照組承擔：純 w 進 pty 會改變終端內容 → 對照組會綠；若 Ctrl+Shift+W 也進 pty，那顆按下去終端會多一個 w）、對話框開啟時不生效
- [x] 4.2 `probe:terminal` 確認「+」文字改動不打到既有選擇器（既有選擇器靠 `aria-label`，168/168 全綠）
- [x] 4.3 `npm test` 與相關 probe 全綠（dev + build 兩模式）—— npm test 240/240、probe:keyboard 114/114、probe:terminal 168/168

## 5. 文件

- [x] 5.1 更新 `CLAUDE.md`：開頭段介紹 shell-affordance-tweaks + probe 統計、快捷鍵表加 `Ctrl+Shift+W` 一列、「四顆鍵，四種代價」節加第五顆條目、路線圖加 change 條目、新增獨立節「shell-affordance-tweaks 的實測與踩雷」（`autoHideMenuBar` 非移除、probe 插入段的位置與相對數字、按鍵不進 pty 由對照組承擔、aria-label 是選擇器再驗一次）
