> **實作順序是承重的：先做不動版面的三件（1–3），最後才上 statusbar（4）。**
> statusbar 會改變整個版面的量測，而 `probe:terminal` 是以**真滑鼠座標**點擊的 —— 反過來做的話，
> 任何一條紅燈都有兩個嫌疑犯（「是續寫入口弄壞的，還是多了一列弄壞的」）。這與
> `terminal-gpu-renderer`「先改觀測點、在舊 renderer 上驗到全綠，再換 renderer」是同一條紀律。

## 1. 選單在選取後自行關閉

- [x] 1.1 `ContextMenu` 的選項 `onClick` 於 `item.onSelect()` 之後呼叫 `onClose()`；保留既有的
      window dismiss 與 `Esc`（點選單以外之處仍須關閉）
- [x] 1.2 對照組確認根因：暫時移除 window 的 dismiss listener，確認四個呼叫端（側欄來源下拉、
      spawn 選單、分頁右鍵、檔案樹右鍵）在選取後**仍然**關閉 —— 證明關閉不再倚賴冒泡路徑；
      確認完把 listener 放回去

## 2. tasks 的完成打勾改為內嵌 SVG

- [x] 2.1 `ChangeView` 的 tasks 清單以兩個 16×16 `<svg>` 取代 `☑` / `☐`（完成＝淡綠底圓＋勾、
      未完成＝空心圓框，取自 spek web `ChangeDetail`）；不引入任何 icon 套件
- [x] 2.2 確認 `probe:openspec` 既有的 tasks 斷言不依賴那兩個字元（若依賴，改為以結構定位）

## 3. 續寫入口

- [x] 3.1 `SessionsApi` 新增薄包裝（送出文字 + 聚焦終端），維持「對 pty 寫入只有一個彙集點」——
      側欄不直接呼叫 `window.workspace.terminal.write`（design D5）
- [x] 3.2 側欄自 `ChangeInfo` 的 `hasProposal` / `hasDesign` / `hasSpecs` / `hasTasks` 導出
      「尚缺哪些 artifact」（零新增 IPC）
- [x] 3.3 判定入口是否可用：側欄來源 ＝ focused session 自身 folder、`spawnTarget === 'claude'`、
      `status === 'running'`（design D3）
- [x] 3.4 於本 change 視圖底部呈現**單一**入口：可用時列出尚缺的 artifact；不可用時**停用並說明
      原因**（不得消失）；artifact 齊備或無錨定 change 時不呈現
- [x] 3.5 觸發時把 `/opsx:continue <slug>` **連同 `\r`** 送進該 session 的 pty，隨即聚焦終端
      （design D1／D2；命令字面集中於單一常數，日後要換只動一處）

## 4. statusbar

- [x] 4.1 新增 statusbar 元件，置於三欄之下、橫跨整個視窗寬度、高度固定（依
      `docs/workspace-mockup.html` 的 `.statusbar`：26px、等寬、faint 色、分段、首段 accent）
- [x] 4.2 內容：focused session 的 repo · git 分支 · session 標籤 · 錨定 change 與任務進度；
      側欄來源**僅在不等於** session 自身 folder 時標示
- [x] 4.3 空狀態：workspace 無 folder、或當前 repo 無 session 時，仍呈現該列並給出說明文字
- [x] 4.4 寬度不足時由右往左省略，優先保留 repo 與分支；維持單行、不橫向捲動
- [x] 4.5 **不**照抄雛型的 `UTF-8` 與版本號兩格（spec 明文禁止恆定欄位）

## 4b. statusbar 的第一手欄位（本輪 dogfood 追加）

- [x] 4b.1 pty 當下的 cwd：主行程讀 `/proc/<pid>/cwd`（夾制於既有作法），**只輪詢當前 focused
      的那一個** session；路徑過深時縮寫。shell session 同樣要有
- [x] 4b.2 git 工作區的 dirty 標記：spawn `git status --porcelain`，**只對 focused 的那一個 repo**
      求值（design D6 —— 不得擴大到 rail 的每一列）
- [x] 4b.3 worktree 名：主行程解析 `.git` 的 gitdir 時本來就會走到 `worktrees/` 那層，順手導出
- [x] 4b.4 未存檔的緩衝區數（`DirtyBuffersProvider` 已在追蹤）；**為零時不呈現該欄位**
- [x] 4b.5 session 計數（本 repo／workspace 總數）、focused session 的執行狀態、
      側欄來源 repo 的 specs 數與 active changes 數

## 4c. 與 agent 的狀態橋接（`claude-status-bridge`）

- [x] 4c.1 偏好新增開關 `agentStatus`（預設 **true**），沿用既有的 `preferences.json` 與
      `settings.*` IPC；設定對話框加上它，並說明「只影響其後建立或重建的 session」
- [x] 4c.2 spawn claude session 時，啟用則注入 `--settings '{"statusLine":{...}}'`，並以環境變數
      傳入該 session 的 payload 落點（比照 `ptyEnv()` 既有的環境處理）
- [x] 4c.3 注入的命令必須：**原子寫入**（先寫暫存再 rename）、且**串接**使用者原有的 statusline
      命令（自 `~/.claude/settings.json` 讀出）。**使用者有自訂但讀不出來時整個不注入** ——
      注入會弄壞他現有的，不注入只是少一個他還不知道的功能（design D10）
- [x] 4c.4 主行程監看 payload 目錄（chokidar，debounce），解析後推給 renderer；解析失敗靜默退回
      「無 agent 狀態」；session 關閉時清除其 payload
- [x] 4c.5 statusbar 呈現：模型顯示名、**context 使用百分比（分母取 payload 的
      `context_window.context_window_size`，不得自建對照表）**、花費與用量上限；
      **每個欄位各自可缺席**，缺席即不呈現該段

## 5. 文案

- [x] 5.1 新增的使用者可見文案全部進 `src/shared/i18n/en.json`（英文），`aria-label` 一律自字典
      取字串 —— 它同時是 probe 的選擇器
- [x] 5.2 確認 `/opsx:continue …` 這串**不進字典**：它是送給 agent 的命令，不是 UI 文案
      （design D1）

## 6. 驗收

- [x] 6.1 `probe:openspec` 補上續寫入口：呈現條件（尚缺 artifact／齊備／無錨定）、三種停用情形
      （側欄來源指向他處、focused 為 shell、session 休眠或已結束）、以及可用時觸發後**焦點落在
      終端**
- [x] 6.2 「pty 真的收到了那則指示」以**讀檔**承載（renderer-agnostic —— 不從 DOM 讀終端內容）：
      以一支把 stdin 落盤的 stub `claude` 為載體，斷言落盤內容含該 change 的 slug 且以換行結尾
      （＝真的送出了，不是只填入）
- [x] 6.3 `probe:openspec` 補上「於來源下拉選取 folder 後選單關閉」
- [x] 6.4 `probe:workspace` 補上 statusbar：存在且橫跨寬度、呈現 repo 與分支、切換 focused session
      後內容隨之改變、側欄來源指向他處時標示（相等時不標示）、收合 side panel 後仍在且高度不變、
      視窗變窄時 repo 與分支仍可見且維持單行、內容不含字元編碼與版本號字樣
- [x] 6.4b `probe:workspace` 補上第一手欄位：於終端內 `cd` 之後 cwd 欄位隨之更新（**以真 pty 驗，
      不是讀設定**）、shell session 同樣有 cwd、未存檔緩衝區為零時不呈現該欄位
- [x] 6.4c `probe:terminal` 補上狀態橋接：**關閉時不注入**（spawn 的命令列不含 `--settings`，
      且不產生 payload）、**使用者有自訂 statusline 但讀不出來時亦不注入**、
      預設（啟用）時 payload 出現且狀態列呈現其欄位、**損毀的 payload 不影響其餘欄位**、
      session 關閉後 payload 消失。以**受探針控制的 stub claude** 承載（它可以照著注入的命令寫檔），
      不啟動真的 claude
- [x] 6.5 `probe:files` 與 `probe:terminal` 回歸（`ContextMenu` 是四個呼叫端共用的元件）
- [x] 6.6 **statusbar 上線後單獨再跑一次 `probe:terminal`**；若出現紅燈，**先跑 baseline 對照組**
      （stash 掉本 change 的改動）再懷疑產品 —— 版面位移造成的座標點空會偽裝成既有 flaky
      （`typography-scale` 的實測教訓）。
      **已執行**：`runMode` 有兩條紅燈（GPU canvas 未釋放、複製選不到內容），**baseline 對照組
      重現了一模一樣的兩條** → 既有問題，非本 change 造成。另行處理，不在本 change 的範圍內。
- [x] 6.7 `npm test` 與 `npm run typecheck` 全綠（CJK 守衛與 `aria-label` 守衛會擋下 5.1 的疏漏）

## 7. 文件

- [x] 7.1 更新 `CLAUDE.md`：新增本 change 的段落（四條回饋的落點、`/opsx:continue` 取代自然語言
      的理由、多個 claude 不構成歧義的推理），並把 **#3／#4 的調查結論**（claude 的連結歸 claude
      管、我們收不到那次左鍵）記為擋住重複調查的紀錄
- [x] 7.2 開發指令一節補上新 probe 段落的說明（`probe:openspec` 的續寫入口、`probe:workspace`
      的 statusbar）
