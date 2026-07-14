## Context

排序這件事在這個 app 裡目前只做了一半：**session 可以拖曳排序**（`workspace-layout`，分頁列與
rail 子列共用同一順序），**repo 完全不能排序** —— rail 照 `workspace.json` 的陣列順序呈現，而那個
順序是「加入的先後」，renderer 沒有任何入口改動它（`folders.*` 只有 `list` / `add` / `remove`）。
而已經做掉的那一半**沒有鍵盤對應** —— 在一個「終端幾乎永遠持有焦點」的 app 裡，這代表每次調整
順序都得把手從鍵盤上拿開。

既有的資產：

- `useDragReorder`（`shell/terminal/useDragReorder.ts`）—— 以真滑鼠事件實作的拖曳排序，支援水平
  與垂直兩軸，呼叫端提供 `rectOf` 與 `onCommit`。分頁列與 rail 的 session 子列都用它。
- `KeyboardNavigation`（無 UI）—— window 的 **capture 階段**單一 listener，`Ctrl+Tab` / `Ctrl+↑↓`
  / `Ctrl+T`；被它處理的按鍵 `stopPropagation()`，不會流進 pty 或 Monaco。
- `WorkspaceStore` —— `workspace.json` 的所有者（版本欄位 + 原子寫 + 損毀隔離）。folder 以陣列
  保存，**順序即呈現順序**。
- session 的順序已經跟著 `sessions.json` 落盤（`session-persistence`），renderer 的
  `sessions.reorder(folderId, fromIndex, toIndex)` 是唯一的入口。

## Goals / Non-Goals

**Goals:**

- repo 可以拖曳排序，且順序跨重啟存活。
- repo 與 session 都能**只用鍵盤**調整順序。
- 排序快捷鍵不得破壞文字選取 —— `Shift+arrow` 在編輯器與輸入框裡**就是**選取鍵。
- 被排序的按鍵不得流進 pty（比照既有導航快捷鍵）。

**Non-Goals:**

- **不做跨 repo 搬移 session**（既有 spec 已明文排除：session 的 cwd 在 pty 啟動時就決定了）。
- **不做鍵位設定**（本 repo 尚無任何快捷鍵設定介面，這個 change 不開這個頭）。
- **不做「排序模式」**（進入某個模式後才能用方向鍵移動）—— 那需要一個模式指示器與退出路徑，
  對兩顆鍵而言是過度設計。
- **不改 `workspace.json` 的格式**（陣列順序本來就是順序，不需要 schema 版本升級）。

## Decisions

### D1：鍵位採 `Shift+↑↓`（repo）與 `Shift+←→`（session）—— 使用者在知情下的裁決

| | 導航（既有） | 排序（本 change） |
|---|---|---|
| repo | `Ctrl+↑` / `Ctrl+↓` | `Shift+↑` / `Shift+↓` |
| session | `Ctrl+Tab` / `Ctrl+Shift+Tab` | `Shift+←` / `Shift+→` |

理由是**肌肉記憶**：`claude` 自己的 agents view 用 `Shift+↑↓`，使用者已經順手了。

**代價（實測 + 使用者確認）：**

- `Shift+arrow` **送得出去**（`CSI 1;2A`–`D`）。攔下它，等於從 pty 裡的程式手上**永久沒收**這顆鍵
  ——比照 `Ctrl+↑↓` 與 `Ctrl+T` 的那筆帳。
- **zsh 與 bash 皆未綁定**（實測：`bindkey` 與 `bind -p` 都沒有 `1;2` 序列）。
- **已知的犧牲者正是 `claude` 自己的 agents view** —— 使用者指出它用 `Shift+↑↓`。也就是說，在
  spekterm 裡開的 claude session 進到 agents view 時，這顆鍵會被我們吃掉、**傳不到 claude**。

> **這與 `Ctrl+T` 的裁決前提正好相反。** `Ctrl+T` 之所以可以拿，關鍵是「**`claude` 沒有使用它**」
> —— claude session 是這個 app 的主場。這裡我們明知 claude 在用，仍然拿走它：使用者判斷「在 rail
> 上排 repo」的頻率遠高於「在 claude 的 agents view 裡按 Shift+↑↓」，且後者在 agents view 裡通常
> 還有方向鍵可用。**這個裁決有前提**：日後若 claude 的 `Shift+↑↓` 變成常用路徑，本裁決即失效。
>
> **退路是 `Ctrl+Shift+arrow`**（`CSI 1;6A`–`D`）：實測 zsh／bash 同樣未綁定，且與既有的
> `Ctrl+↑↓`／`Ctrl+Tab` 成對（Ctrl ＝ 移動游標，加 Shift ＝ 移動東西）。**改鍵位的成本只有
> `KeyboardNavigation.tsx` 的一個判斷與對應的 spec／probe** —— 沒有任何資料格式綁在鍵位上。

**被否決的替代方案：「只在 rail 有焦點時才攔截 `Shift+arrow`」。** 終端幾乎永遠持有焦點，這等於
把這顆快捷鍵變成「大部分時候按了沒反應」—— **一顆有時候有用的快捷鍵比沒有更糟**（使用者會停下來
確認是不是壞了，那正是這個 app 想省掉的那次分心）。

### D2：排序快捷鍵於「可編輯文字持有焦點」時讓路 —— 而**終端不算可編輯文字**

`Shift+arrow` **就是**文字選取鍵。一個全域 capture 的攔截會把側欄 Monaco 與對話框輸入框裡的選取
**整個吃掉**（連 `Shift+→` 選一個字元都不行）。因此排序快捷鍵有一條導航快捷鍵**沒有**的例外：

> 焦點落在可編輯文字元素上時，排序快捷鍵 SHALL NOT 生效，且該按鍵 SHALL 照常抵達該元素。

這與既有的 requirement「**編輯器持有焦點時快捷鍵仍生效**」看似矛盾，其實不是 —— 那條講的是**導航**
快捷鍵（`Ctrl+Tab` 在編輯器裡仍然要能切 session）。兩條必須在 spec 裡各自寫清楚它作用於哪一組鍵，
否則下一個人只會看到一份自相矛盾的規格。

**判準不能是「activeElement 是不是 `<textarea>`」。** xterm 的輸入路徑正是一個**隱形的
`<textarea>`**（`.xterm-helper-textarea`；而且我們刻意關掉了 Monaco 的 native EditContext，Monaco
的輸入路徑**也**是 textarea）—— 那樣寫的話，快捷鍵會在終端上（也就是 99% 的時間）**完全失效**，
而且是靜默失效。

判準是**兩段式**的：

1. **焦點在終端之內**（`activeElement.closest('.xterm')`）→ **不是**可編輯文字，快捷鍵生效。
2. 否則，焦點是 `<input>` / `<textarea>` / `contenteditable` → 可編輯文字，讓路（**不 `preventDefault`、
   不 `stopPropagation`**）。

第 1 條寫成「在終端之內」而不是「是 xterm 的那個 textarea」，是為了讓它涵蓋 xterm 日後可能改變的
內部實作；第 2 條寫成通則而不是列舉 Monaco，是為了讓**任何**新的輸入框自動被尊重（比照 `role=dialog`
的判定哲學）。

> 對話框已經被既有的 `[role="dialog"], [role="menu"]` 判定攔在更前面（所有快捷鍵一律讓位），
> 所以第 2 條實際只為 **side panel 的 Monaco** 而存在 —— 但它必須寫成通則。

### D3：移動到端點**不循環**（no-op），與導航快捷鍵的「可循環」刻意不同

導航是**巡覽**：越過末端繞回開頭只是換個位置看，什麼都沒被改變，而且循環讓「連按」永遠有反應。
排序是**改變資料**：越過末端繞回開頭意味著「把第一名丟到最後一名」—— 那是使用者按過頭時最不想
發生的事，而且視覺上它跳得很遠（要再按 N-1 次才回得來）。

**clamp（no-op）是最不 surprising 的**：清單的邊界在畫面上顯而易見（那一列已經在最上面了），
使用者不會誤以為快捷鍵壞了。

### D4：排序的作用對象是**選中／focused 的那一個**，且它在移動後仍然是選中／focused 的

- `Shift+↑↓` 移動的是 **rail 上選中的 repo**（`selectedId`）。沒有選中的 repo → 無操作。
- `Shift+←→` 移動的是 **當前 repo 的 focused session**（`focusedIdFor(selectedId)`）。沒有 repo
  或該 repo 沒有 session → 無操作。

**這在實作上是免費的** —— `selectedId` 與 focused session 都是以 **id** 保存的，不是位置；重排陣列
之後選中的仍是同一個東西。但它必須寫成 scenario：若哪天有人把它們改成 index，這條會紅。

### D5：`folders.reorder` 的簽名以 **id + 目標位置**，不是 (fromIndex, toIndex)

session 的 `reorder(folderId, fromIndex, toIndex)` 用 index 是安全的 —— session 清單**整份活在
renderer 的 state 裡**，只有一個所有者。

folder 不是：**權威在主行程**（`WorkspaceStore`），renderer 手上是一份經 IPC 推送的複本，而
`workspace:folders:changed` 隨時可能推來一份新的（分支變動、另一個視窗移除了 folder）。一個飛行中
的 `fromIndex` 因此可能已經指向**另一個 folder**。以 id 定位就沒有這個問題：最壞情況是 `toIndex`
偏了一格，而不是**移錯一個 repo**。

```
folders.reorder(id: string, toIndex: number): Promise<WorkspaceFolder[]>
```

主行程對「id 不存在」與「toIndex 越界」一律 clamp／no-op（比照 `remove` 對不存在的 id 靜默返回），
並沿用既有的 `save()`（原子寫）與 `workspace:folders:changed` 廣播。

**preload 的白名單要同步新增 `folders.reorder`，而 `probe:shell` 有一道守衛在等著**
（`surplusFolderKeys` 逐一列舉允許出現的 method）—— 那是 `repo-branch` 那次才補上的漏洞，不同步
就會紅。這是好事：它正是為此而存在。

### D6：拖曳 repo —— **起點是標題列，命中判定是整個區塊**

使用者裁決：插入點以**整個 repo 區塊**（含展開時底下的 session 子列）判定 —— 那是使用者眼中「這個
repo 佔的地盤」。因此 `rectOf(index)` 回傳 `<li>` 的 rect（整塊），不是標題列的 rect。

**但拖曳的起點（`onMouseDown`）只能掛在標題列上，不能掛在 `<li>` 上。** 兩個 `useDragReorder`
（repo 一份、session 子列一份）此刻是**巢狀**的：session 子列在 repo 的 `<li>` 之內。若 repo 的
`onMouseDown` 掛在 `<li>`，那麼在 session 子列上按下時，事件會冒泡上去**同時啟動兩個拖曳** ——
一次拖曳會同時移動 session 與 repo。掛在標題列上，兩者的起點就在 DOM 上互斥。

> 標題列上那三顆子按鈕（展開／收合、＋、✕）的 `mousedown` 仍會冒泡到標題列、記下拖曳起點 ——
> **無害**：`useDragReorder` 有 4px 閾值，未位移就當作點擊，而那三顆按鈕的 `onClick` 都
> `stopPropagation()`。從 ✕ 上開始「拖」也確實會拖動整個 repo —— 這符合直覺，不必特別處理。

### D7：`useDragReorder` 自 `shell/terminal/` 提升到 `shell/`

它與 terminal 無關（是一個泛用的拖曳排序 hook），而 repo 的排序不該去 import 一個住在
`terminal/` 底下的模組。純檔案搬移，行為不變 —— 但它是 `probe:terminal`（分頁列與 rail 子列的
拖曳）與 `probe:files`（共用元件的回歸）的路徑，搬完要跑一次。

### D8：游標 —— 靜止 `pointer`，只有拖曳進行中才 `grabbing`

現況不一致：**session 子列與分頁列靜止時是 `grab`**（張開的手），**repo 列是 `pointer`**（食指）
—— 而這兩種東西的能力完全一樣：**可點擊也可拖曳**。

`grab` 宣告的是「這個東西只能被拖」。但這些項目**點一下是有作用的**（切換 focused session／選中
repo），而且那是使用者在它們身上最常做的事 —— 拖曳是偶爾為之。**游標該宣告主要的可供性，不是次要
的那個。** 慣例也在這一邊：VS Code 的分頁、瀏覽器的分頁都是可拖曳的，靜止時一律 `pointer`。

因此規則是：**可拖曳且可點擊的項目，靜止時 `cursor: pointer`；只有拖曳真的在進行時才 `grabbing`。**
它同時約束 repo 列、session 子列與分頁。

> **拖曳中的 `grabbing` 不能只設在 `body.style.cursor` 上，也不該由每個呼叫端各自維護一個三元式。**
> `cursor` 雖是可繼承屬性，但**元素自己的宣告會贏過繼承來的值** —— 而這條路徑上滿地都是自己宣告了
> cursor 的元素：可拖曳的列與分頁靜止時是 `cursor-pointer`，`<button>` 更帶著一條 UA 的
> `cursor: default`（**Tailwind v4 的 preflight 不再像 v3 那樣把它改回 pointer** —— 實測：探針量到
> 分頁的游標是 `default`，因為 `role="tab"` 正是一顆 button）。
>
> 而 repo 的拖曳判定**刻意涵蓋整個區塊**（D6，含 session 子列與 ▾／＋／✕ 三顆鈕）—— 游標一定會掃過
> 它們。**每個呼叫端各自加三元式是修不完的**（獨立稽核抓到：session 子列與那三顆鈕都會在 repo 拖曳
> 途中變回食指，游標一路閃爍）。因此改為 `useDragReorder` 在 `body` 掛上 `data-dragging`，由
> `index.css` 的一條 `!important` 規則覆蓋**整棵子樹** —— 呼叫端只要宣告靜止時的 `cursor-pointer`。

這條寫進 spec（而不是只改兩個 class）的理由：它是**呈現契約**，而這個 change 正在新增一個可拖曳的
項目種類（repo）。不寫下來，下一個可拖曳的東西會再抄一次 `cursor-grab`。

### D9：拖曳的落點 —— 插入點與提交序位差一格（既有的 off-by-one，本 change 一併修）

**這是獨立稽核抓到的，而我的探針原本是繞過它、不是抓到它。**

`useDragReorder` 的命中判定回傳的是**插入點**（「插在第 i 個之前」），指示線畫的也是它。但提交端
一律是「**先移除、再插入**」（`splice(from, 1)` → `splice(to, 0, moved)`）—— 移除會讓被拖曳項目
**之後**的每一個元素前移一格。於是**往下／往右拖時，實際落點比指示線多一格**：

| 放開的位置 | 指示線 | 修正前的實際結果 |
|---|---|---|
| 第二個 repo 的上半 | 插在它之前（＝原地不動） | **跑到它後面** |
| 第二個 repo 的下半 | 插在它之後 | **越過第三個，飛到清單末端** |

換算集中在一處：`commitIndex(from, insertAt) = insertAt > from ? insertAt - 1 : insertAt`。state 裡
保存的**永遠是插入點**（`DragState.insertAt`）—— 指示線與落點必須是同一個東西。

順帶修掉兩個相關的缺陷：

- **末端拖不到。** 命中判定原本在「游標落在所有項目的中線之後」時回傳 `count - 1`（＝插在最後一個
  之前），使用者**永遠拖不到真正的最後一格**。改回傳 `count`，並由呼叫端在最後一個項目**之後**畫
  指示線（新增 `dropAtEnd`）。
- **無操作卻畫了指示線。** 拖在自己原本的位置上時放開什麼都不會發生，卻有一條線說「放開會移動」。

> **這個 bug 在 session 的拖曳上是既有的**（`sessions.reorder` 同樣是 splice），只是一直沒被抓到：
> **分頁列的拖曳驗收只用兩個分頁 —— 而兩個項目時，兩種語意的結果完全相同**；rail 子列則只驗了往上拖
> （往上拖不受影響）。**驗收必須以至少三個項目、且往下／往右拖進行** —— 這條紀律已寫進 spec。

### D10：不新增任何使用者可見文案

拖曳沒有文案；排序快捷鍵是全域 listener、無 UI（比照既有的 `KeyboardNavigation`）。**刻意不加**
「按 Shift+↑↓ 可調整順序」之類的提示 —— 那會是 rail 上每一列都喊一次的噪音（`rail-legibility-and-repo-row`
才剛把這種東西移掉）。快捷鍵表在 `CLAUDE.md` 與 spec 裡。

## Risks / Trade-offs

**[`claude` 的 agents view 失去 `Shift+↑↓`]** → 使用者在知情下裁決採用（D1）。退路 `Ctrl+Shift+arrow`
成本已量過：只動一個判斷、一份 spec、一支 probe，沒有資料格式綁在鍵位上。

**[使用者在終端裡按 `Shift+↑↓` 想捲動，卻意外重排了 repo]** → `Shift+arrow` 的門檻比 `Ctrl+Shift+arrow`
低，誤觸的機率是真的。緩解：(a) 排序**沒有破壞性** —— 反向按回去就還原了；(b) 移動有立即的視覺回饋
（選中的那一列真的在動，而它是 rail 上顏色最突出的一列）。**不做 undo**（一個只為兩顆方向鍵而存在
的 undo stack，成本遠大於收益）。

**[「編輯器焦點時讓路」的例外靜默失效]** → 這是本 change 最可能悄悄壞掉的地方：判準若寫成「是不是
textarea」，快捷鍵會在終端上完全失效；若漏掉這個例外，Monaco 的選取會消失。**兩個方向都必須有
probe 對照組**：焦點在編輯器時 `Shift+→` **仍然選取文字且順序不變**，焦點在終端時 `Shift+↑` **仍然
移動 repo 且該按鍵不抵達 pty**。少了任一條，這條 spec 就是零覆蓋的。

**[巢狀拖曳互相誤觸]** → D6 的「起點掛標題列」是唯一的接縫。probe 必須**在一個展開著 session 子列
的 repo 上**拖曳（fixture 若只有收合的 repo，這個 bug 會躲過整輪全綠的驗收 —— 比照 Phase 2 的
symlink fixture 教訓）。

**[`workspace:folders:changed` 與拖曳的競態]** → 拖曳進行中若主行程推來一份新清單（例如分支變了），
`folders` 陣列會重新渲染，而拖曳的 `rectOf` 是即時量測的 —— 順序不會錯亂（id 定位，D5），最壞情況
是指示線閃一下。不特別處理。

## Open Questions

- **probe 要怎麼斷言「Monaco 真的選取了文字」？** Monaco 的選取**不是 DOM selection**（它自己畫），
  因此 `window.getSelection()` 讀不到（這與 xterm 同源，`terminal-clipboard` 已經踩過）。候選判準是
  view overlay 上的 `.selected-text` 元素是否存在 —— 實作時實測確認，並以**對照組**證明它有鑑別力
  （拿掉讓路的例外，這條斷言必須變紅）。
