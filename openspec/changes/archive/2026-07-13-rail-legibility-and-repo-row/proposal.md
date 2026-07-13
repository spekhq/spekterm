# Proposal: rail 的可讀性與 repo 列重整

## Why

第一次真正拿 spekterm 來 dogfooding 就撞上三件事：**字太小**、**repo 名稱不夠突出**、
**每個 repo 底下都掛一行「OpenSpec」**。

前兩者是可讀性；第三者是設計缺陷 —— 那行「OpenSpec」與該列最右邊的 `◈` 是**同一個布林值
（`folder.hasOpenSpec`）的兩次呈現**，而且 `◈` 的 `onClick` 裡只有 `stopPropagation()`，
它是一顆**長得像按鈕、卻按不下去**的假按鈕。`docs/workspace-mockup.html`（UI 的權威雛型）
的 rail 裡根本沒有 `◈`；雛型把「有沒有 `openspec/`」處理成**弱訊號**（只在**沒有**的時候
附註一句），而那格副標放的是 **git branch**。我們把雛型刻意弱化的資訊，變成了每一列都喊
一次的主要訊息。

「字太小」還有一個結構性成因：`index.css` 的 `@theme` 只調大了 `--text-xs` / `--text-sm`
兩個 token，但全 app 大量寫死 `text-[11px]` / `text-[12px]` / `text-[13px]` 這類 arbitrary
值 —— **它們完全不吃那兩個 token**。也就是說，現在沒有任何一個旋鈕能整體放大字級。

## What Changes

- **字級收斂為 token（新能力 `typography-scale`）**：全 renderer 寫死的 `text-[Npx]` arbitrary
  值一律收斂回 `@theme` 的字級 token；字級自此**只有一個調節處**。本 change **不定案放大幅度**
  —— 先把旋鈕做出來，由使用者在 dev 中試出舒服的數值後再定。terminal 的 `fontSize` 是 xterm 的
  canvas 設定（非 CSS），一併納入同一組尺度的治理。
- **砍掉 rail 上的 `◈` 假按鈕**（`WorkspaceRail.tsx`）。OpenSpec 身分的**真入口**是主舞台
  header 的 `PanelSwitch`，那裡已有 `◈`；rail 的這顆從來不是入口，只是指示燈。**BREAKING（對
  既有規格）**：`workspace-layout` 現行條文要求 rail「反映 folder 的兩種身分狀態」，改為只在
  **異常時**發聲。
- **repo 名稱取回視覺權重**：現行是 15px / normal weight / 未選中時 `text-ink-dim`（暗灰）；
  雛型是 **700 粗體 + 最亮前景色，選中轉 accent**。它比雛型「大」卻看起來更弱，旁邊 12px 的
  副標幾乎跟它一樣顯眼。字重與顏色比 px 更能解決「不夠突出」。
- **repo 列副標改為顯示 git branch（新能力 `repo-branch`）**：主行程新增讀取當前分支的能力，
  並在分支變動時更新 rail。**以讀取 `.git/HEAD` 檔案實作，不 spawn `git`** —— 既守住
  `workspace-folders`「偵測 SHALL NOT 呼叫任何外部程式」的既有精神，也讓「監看分支變動」
  退化成「監看一個檔案」（切 branch 就是改寫 `.git/HEAD`）。
- **「有沒有 `openspec/`」降級為弱訊號**：有 `openspec/` 時**不再顯示任何東西**（那是常態，
  常態不需要被喊）；只有**沒有**時才在副標附註，且以弱化樣式呈現。

### 範圍裁決

- **雛型的副標寫的是 `master, feat/term`（複數分支）** —— 那對應的是 git worktree 的聚合視圖
  （`@spekjs/core` 確有 worktree 聚合能力）。本 change **只做「當前分支」單一值**；多 worktree
  的聚合是獨立的產品決策，留待日後。
- **不做字級的使用者設定介面**（Settings UI）。本 change 只把字級收斂成「改一處就全體生效」的
  token，幅度由開發者定案後寫死。

## Capabilities

### New Capabilities

- **`typography-scale`** — renderer 的字級一律經由 `@theme` 的字級 token 表達，不得寫死
  arbitrary 值；字級具備單一調節處。含一條可自動驗收的守衛（產品原始碼不得出現 `text-[Npx]`）。
- **`repo-branch`** — 主行程為每個 folder 供應其 git 當前分支，並在分支變動時通知 renderer。
  以檔案讀取實作，不執行外部程式。非 git repo、detached HEAD 皆為合法狀態。

### Modified Capabilities

- **`workspace-layout`** — `Requirement: rail 呈現每個 folder 的名稱與身分` 的行為改變：
  rail 不再為「含有 openspec」這個常態發聲（移除 `◈` 指示鈕與「OpenSpec」副標文字），
  改為呈現 **repo 名稱（強調）+ git 分支（副標）**，並僅在**缺少 `openspec/`**或**路徑失效**
  時以弱訊號標示。

### 不受影響

- **`workspace-folders`** — `hasOpenSpec` 的**偵測**方式與持久化語意完全不變，改變的只是
  rail **如何呈現**它（那條屬於 `workspace-layout`）。`Requirement: 偵測 folder 是否含有
  openspec 目錄` 的「SHALL NOT 呼叫任何外部程式」在本 change 後**依然成立** —— 新增的分支
  讀取同樣不 spawn 任何程式。

## Impact

**Renderer**

- `src/renderer/src/index.css` — `@theme` 的字級 token（新增/調整），`@spekjs/ui` overlay 的
  字級覆寫一併對齊。
- `src/renderer/src/shell/WorkspaceRail.tsx` — 移除 `◈` 按鈕；repo 名稱的字重與顏色；副標改
  為分支。
- **全 renderer 的 `text-[Npx]` 出現處**（依調查涵蓋 `WorkspaceRail`、`SessionTabs`、
  `MainStage`、`OpenSpecPanel`、`BrowseView`、`ChangeView`、`FileTree`、`MarkdownView`、
  `openspec/ui.tsx`、`files/FilesPanel` 等）—— 逐一收斂為 token。
- `src/renderer/src/shell/terminal/xterm.ts` — terminal 的 `fontSize` 納入同一組尺度。

**主行程**

- 新增分支讀取與監看（`.git/HEAD`，含 `.git` 為檔案的 worktree 形式）；新增對應的 IPC 與
  preload 白名單項目 —— 白名單有一道 `probe:shell` 的守衛在等著（見 CLAUDE.md）。
- workspace 的 folder 狀態新增 `branch` 欄位（**衍生狀態，不持久化**，比照 `hasOpenSpec`）。

**驗收**

- 新增字級守衛（`npm test`：產品原始碼不得出現寫死字級）。
- `probe:workspace` 擴充：rail 呈現分支、切 branch 後 rail 自己更新、非 git repo 與 detached
  HEAD 不使 rail 失效、`◈` 不復存在。
- 既有 `probe:shell` 的 preload 白名單守衛會因新 IPC 而需同步更新（**它是刻意設計來擋這件事的**）。

**風險**

- 字級收斂會**動到幾乎每一個 renderer 元件的 class**，屬於大面積但機械性的改動；風險在於誤把
  非字級的 arbitrary 值一起換掉。以「改動只在 `text-[…]`」與跑遍全部 probe 來控制。
- 放大字級後，**side panel 在其 320px 最小寬度下的截斷會變多**（既有 `truncate` 已處理，但視覺
  密度會變）。這是選定幅度時要一併看的，也是把幅度交給 dogfooding 定案的原因。
