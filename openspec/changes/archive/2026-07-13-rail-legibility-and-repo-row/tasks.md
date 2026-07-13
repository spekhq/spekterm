# Tasks: rail 的可讀性與 repo 列重整

## 1. 字級尺度的前置驗證（先做這個 —— 它決定 D1 成不成立）

- [x] 1.1 驗證 Tailwind v4 的 `@theme` 允許變數互相引用（`--text-xs: calc(var(--text-base) - 3px)`）：
      在 `index.css` 加一個 token、跑 `npm run build`，確認建置產物中該 token 解析為預期的 px 值
      （不是字面的 `calc(var(--text-base) - 3px)` 卻無法求值，也不是被 Tailwind 丟棄）
- [x] 1.2 ~~若 1.1 不成立，改採 D1 的退路（五個明確 px 值，旋鈕退化為「改五行」）~~ —— **不適用**：
      1.1 實測成立（建置產物中 `--text-xs: calc(var(--text-base) - 3px)` 原樣輸出，由瀏覽器求值），
      單一旋鈕成立，不需要退路。
      **但實測另外抓到一個 design 沒預見的陷阱**：`@theme` 會 **tree-shake 掉沒有任何 utility 用到的
      token**，而 `--text-terminal` 只被 JS 讀取、永遠不會有 utility 引用它 —— 放在 `@theme` 裡它會
      從產物中消失，`getComputedStyle` 讀到空字串，終端字級靜默壞掉。已改定義於 `:root`。

## 2. 定義字級尺度

- [x] 2.1 在 `index.css` 的 `@theme` 定義五級尺度：`--text-base`（旋鈕，暫定 15px）與由它推導的
      `--text-2xs`(11) / `--text-xs`(12) / `--text-sm`(13) / `--text-lg`(16)
- [x] 2.2 定義 `--text-terminal`（`calc(var(--text-base) - 1px)` = 14px），供 D4 使用
- [x] 2.3 移除 `@theme` 中舊的 `--text-xs`(13px) / `--text-sm`(15px) 定義與其註解

## 3. 收斂 109 處字級 —— **必須依此順序**，否則會鏈式污染

> **順序陷阱（實測自映射表推導）**：若先做 `text-[12px]` → `text-xs`，再做 `text-xs` → `text-sm`，
> 則剛換出來的 45 處 `text-xs` 會被**二次換走**，全部變成 13px。替換必須按「目標名稱不會再成為
> 後續來源」的拓撲順序進行 —— 即**先把既有 token 讓出來，再填入新值**。
>
> 每一步都是全 `src/renderer/src` 的機械替換（`text-sm` / `text-xs` 需以字界比對，避免命中
> `text-small` 之類）。**3.1–3.8 必須在同一次提交內完成** —— 中間狀態的畫面是錯的。

- [x] 3.1 `text-sm`（4 處，本意 15px）→ `text-base`
- [x] 3.2 `text-xs`（35 處，本意 13px）→ `text-sm` ← **D2 的最大風險點**；3.1 必須已完成
- [x] 3.3 `text-[16px]`（1 處）→ `text-lg`
- [x] 3.4 `text-[14px]`（1 處）→ `text-base`（**視覺上調 1px**，D3 的刻意合併）
- [x] 3.5 `text-[13px]`（3 處）→ `text-sm`
- [x] 3.6 `text-[12px]`（45 處）→ `text-xs`；3.2 必須已完成
- [x] 3.7 `text-[11px]`（16 處）→ `text-2xs`
- [x] 3.8 `text-[10px]`（4 處）→ `text-2xs`（**視覺上調 1px**，D3 的刻意合併）
- [x] 3.9 逐檔核對數量吻合（收斂前的清單，共 19 個檔案）：
      `dialogs.tsx` 5+3、`FilesPanel.tsx` 2+4+4、`FileTree.tsx` 3+1、`FileViewer.tsx` 5+1+4、
      `MarkdownView.tsx` 1、`MainStage.tsx` 1+3、`BrowseView.tsx` 2+4+7+1、`ChangeView.tsx` 1+3+2+1+1、
      `OpenSpecPanel.tsx` 3+1、`SpecDetail.tsx` 1+2、`ui.tsx` 2+1+1+3、`VizOverlay.tsx` 5+3、
      `PanelSwitch.tsx` 1、`SidePanel.tsx` 1、`SessionNameDialog.tsx` 2+1、`SessionTabs.tsx` 1+3+3、
      `TitleConflictDialog.tsx` 2+1、`WorkspaceRail.tsx` 3+3+1+4
- [x] 3.10 收斂 `index.css` 中 4 個 `.spekui-*` selector 的 `font-size`（rem/px 混用）為引用尺度
      token（D12）

## 4. terminal 的字級接上尺度

- [x] 4.1 `terminal/xterm.ts` 移除寫死的 `fontSize: 14`，改由
      `getComputedStyle(document.documentElement).getPropertyValue('--text-terminal')` 解析取得
- [x] 4.2 字級變更後重新 `fit()` 並將新的 `cols/rows` 送達 pty —— 未重新量測會使終端內容與視窗錯位

## 5. 字級守衛

- [x] 5.1 新增守衛（納入 `npm test`）：`src/renderer/src` 的產品原始碼不得出現 `text-[<數字>px|rem]`；
      `index.css` 的 `@theme` 區塊之外不得出現 `font-size:`
- [x] 5.2 守衛的**對照組**：餵它一段刻意寫死字級的樣本，它必須命中 —— 一條永遠不會紅的守衛等於
      沒有守衛（CLAUDE.md 已記過 `naming.test.mjs` 的假綠）

## 6. 主行程：讀取分支

- [x] 6.1 實作分支讀取：`stat` `<folder>/.git` → 目錄則讀 `<folder>/.git/HEAD`；檔案則解出
      `gitdir:` 指向的路徑再讀 `<gitdir>/HEAD`（D7）
- [x] 6.2 解析 HEAD：`ref: refs/heads/<name>` 取 `refs/heads/` **之後全部**（分支名可含 `/`）；
      純 sha 則為 detached，回傳短 sha 的替代標示（D6）
- [x] 6.3 無 `.git`、`.git` 內容無法解讀、HEAD 不存在 → 一律回「沒有分支」，不拋錯、不使 app 崩潰
- [x] 6.4 單元測試：一般分支、含 `/` 的分支名、detached HEAD、worktree（`.git` 是檔案）、非 git
      repo、損毀的 HEAD
- [x] 6.5 單元測試：分支判定期間**不得 spawn 任何子行程** —— 攔截 `node:child_process` 的全部入口，
      並加一個**對照組**證明攔截確實生效（CLAUDE.md 已載明此手法）

## 7. 主行程：監看分支變動（兩層，D8/D9）

- [x] 7.1 第一層：監看 folder 根目錄（`depth: 0`），事件以 basename `.git` 過濾，用來偵測 `.git`
      的出現與消失
- [x] 7.2 第二層：`.git` 存在時，監看 HEAD 檔案（一般 repo 為 `<folder>/.git/HEAD`；worktree 為
      `<gitdir>/HEAD`）；`.git` 消失時銷毀該 watcher
- [x] 7.3 watcher 一律 `followSymlinks: false`
- [x] 7.4 folder 自 workspace 移除、視窗 reload（`did-navigate`）、視窗關閉時，兩層 watcher 皆須
      銷毀 —— CLAUDE.md：reload 不銷毀 `webContents`，只掛 `'destroyed'` 的清理不會觸發

## 8. folder 狀態與 IPC（D10）

- [x] 8.1 folder 狀態新增 `branch: string | null`（**衍生狀態，不持久化**，比照 `hasOpenSpec`）
- [x] 8.2 新增推送通道 `folders.onChanged(listener)`（preload），形狀比照既有的 `fs.onWatchEvent`
      與 `openspec.onChanged`；分支變動時主行程推送更新後的 folder 清單
      > **D10 原本斷言「不新增 preload method」，實作時推翻** —— 既有的 `folders.*` 只有
      > `list`/`add`/`remove`，沒有任何推送通道，而「切 branch 後 rail 自己更新」必然需要訂閱 API。
- [x] 8.3 **補上 `probe:shell` 對 `folders.*` 的白名單守衛** —— 實測發現它只涵蓋 `fs.*` 與
      `openspec.*`，漏掉整個 `folders` namespace（於是新增 method 不會被擋，那是守衛的漏洞，
      不是許可）
- [x] 8.4 單元測試：`workspace-store` 的持久化不含 `branch`

## 9. rail 的 repo 列（D11）

- [x] 9.1 移除 `WorkspaceRail.tsx` 中的 `◈` 按鈕（那顆 `onClick` 只有 `stopPropagation()` 的假按鈕）
- [x] 9.2 repo 名稱取回視覺主導：`font-weight: 700`、未選中亦為 `text-ink`（不再 `text-ink-dim`）、
      選中轉 accent
- [x] 9.3 副標改為分支（mono、弱化）：有分支即顯示；缺 `openspec/` 時附註（`master · 無 openspec/`）；
      兩者皆無則只顯示該附註；**含有 `openspec/` 時不再顯示任何標示**
- [x] 9.4 路徑失效維持既有的明確標示（那是錯誤，不是弱訊號）

## 10. 驗收

- [x] 10.1 `probe:workspace` 擴充：rail 呈現分支、於 terminal 切 branch 後 rail 自己更新、非 git
      repo 與 detached HEAD 不使 rail 失效、`.git` 於執行期間出現時 rail 開始顯示分支、`◈` 不復存在、
      rail 上不存在按下去無效果的控制項
- [x] 10.2 跑 `npm run typecheck`、`npm test`、`npm run lint`
- [x] 10.3 回歸：`probe:shell`（preload 白名單）、`probe:files`、`probe:terminal`、`probe:keyboard`、
      `probe:openspec` —— 字級收斂動到 15 個 renderer 檔案，探針對版面座標敏感
- [x] 10.4 `npm run measure:bundle` 仍通過
- [x] 10.5 **實際開 app 逐頁看過**（D2 的緩解）：字級收斂的「用錯 token」不會被任何守衛抓到，
      只能靠眼睛。逐一檢視 rail／分頁列／side panel 兩個身分／overlay／對話框
- [x] 10.6 由使用者在 dev 中定案 `--text-base` 的值，寫回 `index.css` —— **定案 17px**（五級 13/14/15/17/18，terminal 16px）。它暴露了一個既有缺陷：Panel 缺 min-w-0，宣告的 minSize=180px 一直沒真的兌現（見 design D14）

## 11. 文件

- [x] 11.1 `CLAUDE.md` 補上字級尺度的約束（字級一律走 token、守衛的存在、`--text-base` 是唯一旋鈕）
- [x] 11.2 `CLAUDE.md` 補上本 change 的實測踩雷：git 以 rename 換掉 `.git/HEAD`（inode 每次變）
      但 chokidar 撐得住、監看尚不存在的 `.git` 收不到事件（故需兩層 watcher）、`@theme` 重新定義
      既有 token 名稱時的鏈式污染陷阱
- [x] 11.3 `docs/PRD.md`：若 rail 的呈現與 PRD 描述有出入，回寫（雛型仍是 UI 權威） —— **已檢查，無出入**：PRD 的 rail 示意圖本就沒有 ◈ 或「OpenSpec」副標（那是實作偏離雛型長出來的）；PRD 中的 ◈ 指主舞台 header 的 segmented switch，原封不動保留
