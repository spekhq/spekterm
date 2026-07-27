## ADDED Requirements

### Requirement: 工作目錄的選擇為 per-folder，預設為 folder 自身

工作目錄的選擇是側欄座標的一個維度（見 `side-panel-source`）—— 它 SHALL 隸屬於 **rail 上的
項目**，SHALL NOT 隸屬於任何 session。side panel 呈現的工作目錄 SHALL 為**當前選中項目的選擇**；
切換 rail 上選中的項目時 SHALL 隨之改變。

**該選擇 SHALL 可被改變，而 SHALL NOT 以「該 folder 是否已有 session」為條件。**

預設值 SHALL 為 **folder 自身**，SHALL NOT 為該 repo 的主工作目錄 —— folder 本身可能就是一個
linked worktree，此時該 repo 的主工作目錄對使用者而言是「別的地方」，而不是預設視角。

**folder 自身 SHALL 以「沒有工作目錄識別碼」表示**，SHALL NOT 以其 repo 主工作目錄的識別碼表示
—— 後者會使同一個邏輯狀態有兩種表示，而「切換來源時重置」與「工作目錄已消失時退回」兩條要求就
沒有唯一的正確值可寫。這與 `terminal-sessions` 對「session 開在 folder 根」的既有表示法一致，
且它同時涵蓋 folder 不位於版控之下的情形（那時根本不存在任何識別碼）。

#### Scenario: 預設為 folder 自身

- **WHEN** 使用者於一個尚未選過工作目錄的 folder 切換至 Files 身分
- **THEN** 檔案樹以該 folder 的根目錄為根

#### Scenario: folder 本身是 linked worktree

- **WHEN** 一個 workspace folder 本身是某個 repo 的 linked worktree，使用者選中它並切換至
  Files 身分
- **THEN** 檔案樹以**該 folder**（即該 linked worktree）為根，而非該 repo 的主工作目錄

#### Scenario: 切換 rail 上選中的項目時工作目錄隨之改變

- **WHEN** folderA 選定了某個 worktree、folderB 維持預設，使用者於 rail 上在兩者之間切換
- **THEN** Files 身分的樹根隨選中項目的選擇改變

#### Scenario: 同一個 folder 的不同 session 共用同一個工作目錄選擇

- **WHEN** 某個 folder 選定了一個 linked worktree，使用者於該 folder 內切換 focused session
- **THEN** Files 身分仍以該 worktree 為樹根

## MODIFIED Requirements

### Requirement: 切換側欄來源 repo 時重置工作目錄

使用者切換側欄來源 repo 時，**該 folder 座標中**的工作目錄選擇 SHALL 被重置為 folder 自身。

工作目錄的識別碼隸屬於某個 repo —— 沿用舊 repo 的識別碼，新 repo 的清單中查無此項，檔案樹會對著
一個不存在的根呈現空狀態。這與 `side-panel-source` 既有的「切換來源時重置錨定的 change」是同一條
理由（座標的隸屬關係）。

#### Scenario: 切換來源 repo 後工作目錄回到預設

- **WHEN** 某個 folder 的側欄來源為 repoA 且選定了 repoA 的某個 worktree，使用者將其側欄來源
  切至 repoB
- **THEN** Files 身分以 repoB 的 folder 根目錄為樹根

## REMOVED Requirements

### Requirement: 工作目錄的選擇為 per-session，預設為 folder 自身

**Reason**: 名稱與內容皆以 session 為歸屬單位（「每個 session SHALL 記住自己的工作目錄選擇」），
而本 change 把側欄座標的三個維度一併改基到 rail 的項目上。該 requirement 並且明文寫著「沒有任何
session 時，工作目錄 SHALL 為 folder 自身」—— 那是一個唯讀的 fallback，正是本 change 要修的痛點
（尚無 session 的 folder，其工作目錄選擇器完全無法使用）。

**Migration**: 由 `## ADDED Requirements` 的「工作目錄的選擇為 per-folder，預設為 folder 自身」
承接。「預設為 folder 自身而非該 repo 的主工作目錄」及其論證、以及「folder 自身以沒有識別碼表示」
那一整段（它是「切換來源時重置」與「工作目錄已消失時退回」得以有唯一正確值的前提）**逐字保留**。
「切換 focused session 時工作目錄隨之改變」由「切換 rail 上選中的項目時工作目錄隨之改變」取代。
持久化改由 `side-panel-source` 的「側欄座標跨應用程式重啟存活」承接。
