## Why

Dogfood 回饋的三個缺陷，共同點是**側欄與殼層呈現了與使用者當下狀態不符的東西**：

1. **活動列每次重啟都變寬。** 它是一個 `Panel`，而 react-resizable-panels 的
   `groupResizeBehavior` 預設為 `preserve-relative-size` —— px 尺寸在掛載時換算成容器百分比，
   視窗放大後就等比長大。主視窗建立於 1280×800，使用者最大化之後那 56px 變成一百多 px
   （**有上限**：`maxSize="120px"` 每次都以當下的 group 寬度重新換算，於是它長到 120px 為止 ——
   但那已經是原本的兩倍多）。而它是一列固定寬的圖示按鈕，**拖動它沒有任何可調整的內容**。
2. **側欄來源的 repo 下拉沿用 rail 的順序。** rail 的順序是使用者為了「常用的放上面」拖出來的，
   而下拉是**查找**用的清單 —— 二十幾個 repo 時，照 rail 的順序找一個名字是線性掃描。
3. **`This change` 顯示 `unknown change slug: <slug>`。** 錨定落盤於 `panel.json` 且**從不失效**，
   而 `openspec archive` 會把 slug 改名成 `<日期>-<slug>` —— 於是每個 change 一封存，它的錨定就
   永遠指向一個不存在的 slug，側欄把主行程的原始錯誤字串直接畫到畫面上。使用者看見的是「我沒有
   選 change，它卻在報錯」。**狀態列有同一個缺陷的第二個出口**：它自己又解析一次錨定
   （`StatusBar.tsx`），於是側欄不呈現那個 change 之後，狀態列還在印它的 slug。

## What Changes

- **活動列改為固定寬度，不再是可拖動的 `Panel`。** 移除活動列與 rail 之間的分界。
  **BREAKING（對規格而言）**：`workspace-layout` 現行條款明文要求該分界可拖動。
- **側欄來源的下拉依 folder 名稱 a–z 排序**，與 rail 的順序脫鉤。
- **`This change` 視圖只在「有一個可解析的 change」時才呈現。** 沒有時，該視圖與它的入口一併
  不呈現，OpenSpec 身分只有 `Browse`。
- **錨定的 slug 於側欄來源 repo 的掃描結果中查無此項時，視同沒有錨定** —— 讓位給衍生預設
  （該 repo 恰有一個 active change 時就是它），衍生預設也不成立時該視圖不呈現。
  失效的錨定**不清除落盤內容**：清除是一次由掃描結果驅動的破壞性寫入，掃描暫時失敗就會抹掉
  一個好的錨定，而留著它沒有壞處（它隨時可能因 worktree 重新加入而再度有效）。
- **狀態列與側欄以同一條規則解析錨定**，解析不出來時不呈現該欄位 —— 否則兩處會對同一個問題
  給出兩個答案。
- **移除「無錨定 change 時本 change 視圖呈現空狀態」** —— 該視圖不呈現時，它的空狀態
  （含 `Pick one from Changes` 按鈕）永遠到不了。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `workspace-layout`: 活動列與 rail 之間**不再有可拖動的分界**；活動列為固定寬度。
  「區域之間的分界可拖動且受最小寬度夾制」的適用範圍收斂為 rail↔主舞台、主舞台↔side panel 兩處。
- `side-panel-source`: 來源下拉的候選 **SHALL 依 folder 名稱排序**，不依 rail 的順序；
  並修正「切換側欄來源時重置錨定」條款中對已被移除之空狀態的援引。
- `openspec-panel`: 「本 change」視圖**僅在存在可解析的錨定 change 時呈現**；錨定的 slug 在
  來源 repo 中查無此項時視同無錨定；移除無錨定時的空狀態要求。
- `status-bar`: 其呈現的錨定 change **SHALL 與側欄同一條解析規則**，解析不出來時不呈現該欄位。

## Impact

- `src/renderer/src/shell/AppShell.tsx` —— 活動列的 `Panel` 與其 `Separator`。
- `src/renderer/src/shell/ActivityBar.tsx` —— 固定寬度。
- `src/renderer/src/shell/side-panel/PanelSourceBar.tsx` —— 下拉候選的排序。
- **新模組**（純函式）—— 錨定的解析規則。`MainStage` 與 `StatusBar` 兩個消費者共用，並由
  `npm test` 承擔其邊界情形（清單未載入、slug 落在 archived、恰一個 active 的退路）。
- `src/renderer/src/shell/MainStage.tsx`、`src/renderer/src/shell/StatusBar.tsx` —— 改用該模組。
- `src/renderer/src/shell/openspec/OpenSpecPanel.tsx` —— 視圖清單與當前視圖的裁定。
- `src/renderer/src/shell/openspec/ChangeView.tsx` —— 移除無錨定的空狀態分支。
- `src/shared/i18n/en.json` —— `openspec.noAnchoredChange` / `openspec.goToChanges` 失去消費者。
- `scripts/probe-workspace.mjs` —— `role="separator"` 由 3 個變 2 個，**7 處索引/計數**（含
  `MOUNTED` 閘裡的那一處）。
- `scripts/probe-openspec.mjs` —— `CHANGE_EMPTY_TEXT` 的 5 個使用站點（其中一處沒有 `check`，
  是一道同步屏障）＋ 視圖 tab 的 settle 條件。
- **不在範圍內**：
  - 主行程 `unknown change slug: <slug>` 這個字串本身仍未進字典。本 change 讓正常路徑不再抵達
    它（錨定失效時該視圖根本不呈現），但「change 正被檢視時於磁碟上消失」的競態仍會顯示它。
  - `openspec/specs/artifact-continuation/spec.md` 中「側欄會落入『尚無錨定』的空狀態」是一句
    **已過期的論證文字**（非 SHALL 條款）。本 change 不動它，記在此處以免下一個人以為那個空狀態
    還在。
