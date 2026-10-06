## MODIFIED Requirements

### Requirement: rail 恆常呈現一個不隸屬於任何 workspace folder 的全域項目

workspace rail SHALL 恆常呈現一個**全域項目**，它 SHALL NOT 隸屬於任何 workspace folder。它
SHALL 位於所有 folder 之前，且 SHALL 恆為 rail **置頂段**的第一列（見「全域項目恆為置頂，且該
狀態不可取消」）。

**明確的視覺分隔 SHALL 劃在置頂段與其餘 folder 之間** —— 亦即全域項目與置頂的 folder 位於分隔
線的**同一側**。此處原本要求分隔線劃在全域項目與整個 folder 清單之間；置頂能力使分隔線之上不再
只有全域項目，兩者無法並存。

因此「使用者要能一眼看出它與 repo 不是同一類東西」這件事 SHALL 由該列**自身的呈現**承擔，而不
再由分隔線承擔：它使用與 folder 不同的圖示、不呈現 git 分支、不提供移除入口，且其置頂指示為
停用。workspace 尚無任何置頂的 folder 時，分隔線的位置與此前相同。

全域項目 SHALL 在 workspace **尚未加入任何 folder** 時同樣呈現。它是這個應用程式恆常提供的一格，
不是 workspace 內容的函數。

全域項目 SHALL 呈現一個標籤，SHALL NOT 呈現 git 分支 —— 它沒有 repo 可讀（見 `repo-branch`，
該能力的措辭限於 workspace 的 folder）。

**全域項目 SHALL NOT 於冷啟動時被預設選中。** This rule was introduced so that cold start would not wake
the global item's focused session. Since dormant sessions now start only on an explicit wake (see
`session-persistence`), selecting an item no longer starts anything, and that reason is gone; the rule stays
because "what is selected" must not depend on what an earlier run left behind, and the empty state is the
honest one when the user has not chosen yet.

**rail 上「選中哪個項目」的表示 SHALL 使「未選中」與「選中全域項目」互斥可辨。** 兩者若共用同一個
缺席值，每一處以「有沒有選中」為條件的行為（快捷鍵的無操作條件、狀態列的空狀態）都會把使用者
明確選中的全域項目誤判為「他還沒選」。

#### Scenario: 全域項目位於所有 folder 之前

- **WHEN** workspace 已加入一或多個 folder
- **THEN** rail 的第一個項目為全域項目，其後才是各個 folder

#### Scenario: 分隔線劃在置頂段與其餘 folder 之間

- **WHEN** workspace 有一或多個置頂的 folder
- **THEN** 全域項目與那些置頂的 folder 位於分隔線的同一側，未置頂的 folder 位於另一側

#### Scenario: 尚無置頂的 folder 時分隔線緊接於全域項目之後

- **WHEN** workspace 有一或多個 folder，但沒有任何一個被置頂
- **THEN** 分隔線緊接於全域項目之後，其後才是各個 folder

#### Scenario: 尚無任何 folder 時仍呈現

- **WHEN** workspace 尚未加入任何 folder
- **THEN** rail 仍呈現全域項目

#### Scenario: 不呈現 git 分支

- **WHEN** 使用者檢視 rail 上的全域項目
- **THEN** 該列不呈現任何 git 分支資訊
- **AND** workspace 的持久化設定中不存在任何路徑為家目錄的 folder 條目 —— 全域項目不是被合成
  出來的一筆 folder

#### Scenario: 冷啟動不預設選中全域項目

- **WHEN** 應用程式啟動完成，使用者尚未點選任何 rail 項目
- **THEN** 沒有任何 rail 項目被選中，主舞台呈現尚未選擇項目的空狀態

### Requirement: 全域 session 一樣跨重啟存活並重建

全域 session SHALL 與 folder 的 session 一樣被持久化並於下次開啟應用程式時重建，包含：spawn 目標、
使用者取的名字、分頁順序、pty 最近一次宣告的終端標題，以及 claude 目標的對話識別碼。重建的 session
SHALL 同樣為休眠態, and SHALL start its pty only when the user explicitly wakes it, like any other
dormant session（見 `session-persistence`）.

持久化的內容 SHALL 以「不隸屬任何 folder」為一個明確表示的狀態，SHALL NOT 以某個保留的 folder
識別碼字串偽裝成隸屬於某個 folder —— 後者會使每一處「以識別碼查找 folder」的程式碼靜默地查無此
folder，而型別檢查對此無能為力。

#### Scenario: 全域 session 跨重啟重建

- **WHEN** 使用者建立數個全域 session 並為其中之一命名，關閉並重新開啟應用程式
- **THEN** 那些 session 以原本的順序與名字重建於全域項目之下

#### Scenario: claude 目標的全域 session 續接原對話

- **WHEN** 一個全域 claude session 曾與 agent 對話過，關閉並重新開啟應用程式後被喚醒
- **THEN** 該 session 續接同一個對話

#### Scenario: Selecting the global item does not start its sessions

- **WHEN** the application is reopened with several global sessions and the user selects the global item
- **THEN** its focused session is displayed as dormant and no global session has started a pty

#### Scenario: 落盤內容以明確狀態表示不隸屬任何 folder

- **WHEN** 檢視持久化的 session 清單內容
- **THEN** 全域 session 的條目以一個明確的狀態表示它不隸屬任何 folder，而非帶有一個不對應任何
  workspace folder 的識別碼字串
