## Context

`MainStage` 目前把單一 `folder`（rail 的 focused folder）一路灌給三個消費者：header 的
name/path、`SessionTabs`／`TerminalView`（**駕駛**那半），以及 `SidePanel`（**讀** 那半）。
在單 repo 的世界裡「我正在駕駛的 repo」與「我想讀的 repo」永遠是同一個，於是一個 prop 同時
表達兩者 —— 這是一個一直成立的巧合。agent 一旦在 session 裡跨 repo 工作（`claude` 自己 `cd`
過去，或拿絕對路徑改別的 repo），巧合破掉：側欄看不到那個 repo 的 spec 與檔案。

既有結構有兩塊直接承接本 change：

- **`anchoredChange` 已經是「側欄跟隨 focused session」的先例。** 側欄的「本 change」視圖顯示
  focused session 錨定的 change，per-session，切 session 就跟著走。本 change 把這條線的粒度從
  「一個 change」放大為「一個 (repo, change)」—— 同一條線，不是新軸。
- **落盤是「renderer 供應、主行程原樣保存」。** `PersistedSession` 的 `anchoredChange` 由 renderer
  送出、主行程不解讀地存回 `sessions.json`（`RendererSession = Omit<PersistedSession,
  'claudeSessionId' | 'cwd'>`）。側欄來源要落盤，就是在這條路上加一個平行欄位。

主行程的 OpenSpec 與 Files 供應層本就以 `folderId` 定址、每個 folder 各自快取與監看。側欄指向
另一個 folder，對主行程而言只是 renderer 送了另一個合法的 `folderId` —— 邊界與供應層不需要動。

## Goals / Non-Goals

**Goals:**

- 側欄（OpenSpec + Files）的來源與 rail 的 focus 解耦：能在不切走 terminal 的前提下，讓側欄
  呈現 workspace 中另一個 repo。
- 側欄來源是 per-session 的狀態，隨 session 一併落盤與重建。
- OpenSpec 與 Files 兩個身分共用同一個側欄來源。

**Non-Goals:**

- rail 上「哪個 repo 剛有事」的弱訊號提示（後續 change）。
- 同一 repo 內多個 git worktree 的聚合（後續 change B，疊在本 change 之上）。
- 側欄「自動」跟隨 agent 實際在動的 repo —— 需把「哪個 session 改了哪個 repo」歸因，而 Linux
  的 inotify 不回報 pid、fanotify 需 root。本 change 繞開這堵牆，改由手動選取 + 人眼歸因。
- 追蹤 pty 的 cwd 來決定側欄來源（cwd 是瞬時位置且會抖動，見 D1）。

## Decisions

### D1. 側欄來源 = focused session 的 `panelFolderId`，預設為 session 自己的 folder —— 不設「跟隨／釘住」toggle

模型：每個 session 帶一個 `panelFolderId`，預設等於 `session.folderId`（它自己的家），使用者
可改為 workspace 中任一 folder。側欄的來源永遠是 **focused session 的 `panelFolderId`**；沒有
任何 session 時（空 repo）退回 rail 的 focused folder。這與 `anchoredChange` 的優先序同構：

```
panelFolder   = focused session 的 panelFolderId  ?? rail focused folder
anchoredChange = focused session 的錨定 change      ?? folder 層 viewing ?? 唯一 active change
```

**proposal 描述的「跟隨（預設）/ 釘住」切換鈕被取消 —— 它是多餘的。** 那顆 toggle 的預設「跟隨」
本意是「側欄 = 我正在駕駛的 repo」。但在這個 app 裡「正在駕駛的 repo」＝`session.folderId`，而它
**不隨 pty 的 cwd 浮動**（session 掛在哪個 repo 底下是固定的）。於是「跟隨」退化為「側欄 = 自己的
folder」，與「釘在自己的 folder」在行為上完全一樣。真正有意義的差別只剩「切到別的 session 再切回
來，側欄記不記得指向 repoB」—— 而 per-session 的裁決已經決定「記得」。所以「釘住」是唯一且預設的
行為，動態版的「跟隨」不存在，toggle 無事可做。

- **替代方案（proposal 的 toggle）**：保留「跟隨/釘住」二態。否決 —— 增加一個永遠處於同一態、
  無法表達出差異的旋鈕，只會讓使用者以為「跟隨」會動態追蹤 agent（它不會）。
- **可供性補償**：來源指示器在 `panelFolderId !== session.folderId` 時顯示一個「回到自己的 repo」
  的捷徑（一鍵重置為 `session.folderId`）—— 取代 toggle 的「回到預設」功能，但不假裝有動態跟隨。

### D2. 切換側欄來源時，`anchoredChange` 重置

change 的 slug 隸屬於某個 repo（`openspec/changes/<slug>`）。把側欄來源從 repoA 切到 repoB 時，
repoA 的 slug 在 repoB 不存在 —— 沿用它，「本 change」視圖會對著一個不存在的 change 顯示空狀態，
看起來像壞掉。因此切換 `panelFolderId` 時把該 session 的 `anchoredChange` 重置為 undefined，讓
既有的衍生預設接手（repoB 恰有一個 active change 時錨定它，否則呈現空狀態讓使用者自己挑）。

於是「一個 (repo, change)」在資料上是「`panelFolderId` + 隸屬於它的 `anchoredChange`」，而非一個
獨立的複合鍵 —— 切 repo，change 歸零重解析。

- **替代方案**：per-session 記住「每個 repo 各自的 anchoredChange」（`Map<folderId, slug>`）。
  否決 —— 為一個罕見的「切回去希望還記得上次看哪個 change」情境，換來一個更難推理的狀態，且它
  與落盤、重建都要同步。不值得。

### D3. 落盤：`PersistedSession` 加 `panelFolderId?`，走 renderer 供應那條路

`panelFolderId` 由 renderer 送出、主行程原樣保存（比照 `anchoredChange`，加進 `RendererSession`
的範圍、`parseSessionEntry` 加一條 optional-string 解析）。**重建時的韌性**：`panelFolderId` 指向
的 folder 可能已被移除（使用者重開前刪了那個 repo）—— 重建時若它不在當前 workspace 的 folder
清單裡，退回 `session.folderId`。這與 session-restore 既有的「folder 路徑失效 → wakeError」是同一
種防禦姿態：持久化的座標不保證重開後仍然有效。

- **省略欄位**：`panelFolderId === session.folderId`（未曾改動）時不必寫入 —— 讀取時 undefined
  自然解析回 `session.folderId`。保持 `sessions.json` 乾淨，且與「預設不落盤」一致。

### D4. `MainStage` 拆出兩個 folder 概念

目前的單一 `folder` 分裂為：

- **`focusedFolder`**（rail 的）→ header 的 name/path、`SessionTabs`、`TerminalView` 的 `active`
  判斷。**這一半完全不變** —— terminal 仍以 `session.folderId === focusedFolder.id &&
  session.id === focusedId` 判斷顯示。
- **`panelFolder`**（側欄的）→ `SidePanel`、`OpenSpecPanel`／`FilesPanel` 的 `key` 與資料 hook、
  `anchoredChange` 的錨定目標。

`anchorChange`／`viewing` 的語意隨之對齊到 `panelFolder`（沒有 session 時的 folder 層檢視狀態，
以 `panelFolder.id` 為鍵）。

### D5. 來源指示器：側欄頂部一條共用來源列

`SidePanel` 目前是「條件式 return `OpenSpecPanel` 或 `FilesPanel` 其一」，沒有共用殼。改為「頂部
一條來源列 + 底下條件式內容」，於是 OpenSpec 與 Files 共用同一個來源選擇（切身分不改來源）。

- **位置**：側欄 Panel 內的頂部，而非 stage header —— stage header 的 name/path 屬於「駕駛」那半
  （focusedFolder），把「讀」那半的來源混進去會讓兩個身分打架。
- **下拉選取**：沿用既有 `ContextMenu`（spawn 選單、右鍵選單都是它）—— 鍵盤可全操作是這個 repo
  的既定紀律，不自己另做一個只能點的下拉。
- **文案入字典**（`ui-localization`）：來源列的 `aria-label`、下拉項、「回到自己的 repo」捷徑的
  標籤全部走 `en.json`；probe 的選擇器自同一份字典取字串。

### D6. 主行程零改動（邊界與供應層）

`panelFolderId` 是白名單內的合法 folder id。OpenSpec 與 Files 的 IPC 本以 `folderId` 定址、每個
folder 各自 chokidar 監看與快取 —— 側欄指向另一個 folder 只改變 renderer 送哪個 `folderId`。
唯一的主行程改動是 `session-store` 多存一個欄位（D3），供應層、`fs-boundary`、watcher 一律不動。

## Risks / Trade-offs

- **[切來源後「本 change」重置，使用者以為東西不見了]** → D2 的必然結果；以衍生預設（唯一 active
  change 自動接手）與空狀態的明確文案緩解。這與今天「換 folder 後側欄重解析」的行為一致，不是新
  的驚訝。
- **[`panelFolderId` 指向已移除的 folder]** → D3 的重建 fallback（退回 `session.folderId`）。
- **[`FilesPanel` 以 `panelFolder.id` 為 key，切來源會重新掛載整棵樹]** → 與今天「換 folder 換一
  棵樹」同一機制；dirty buffer 是跨 folder 存活的全域狀態（file-editing 既有），不隨掛載/卸載清
  除，切來源不會丟失未存編輯。驗收需覆蓋這一點。
- **[terminal 與側欄來源不一致，使用者迷失「我在哪」]** → 來源列明確標示側欄看的 repo，且在
  `!== session.folderId` 時視覺上與預設態不同（連同 D1 的重置捷徑）。header 仍顯示駕駛那半的
  repo，兩個身分各自標示。

## Migration Plan

無資料遷移。`PersistedSession` 新欄位為 optional，舊的 `sessions.json`（無 `panelFolderId`）讀取
時每個 session 的側欄來源解析為 `session.folderId` —— 即今日行為。純 additive，可直接出貨。

## Open Questions

- **來源列的視覺形態**：D5 定了「側欄頂部一條列 + `ContextMenu` 下拉」，但列的確切呈現（只顯示
  repo 名？名 + 分支？非預設態的標示方式）留待實作時對齊既有 rail／header 的視覺語彙，並在
  probe 盤點文案時定案。
- **`Ctrl+T` 建立的新 session 其 `panelFolderId`**：新 session 誕生於 `focusedFolder`，`panelFolderId`
  自然預設為它自己的 folder —— 無需特別處理，列此確認無遺漏。
