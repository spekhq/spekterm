## ADDED Requirements

### Requirement: 側欄的來源獨立於 rail 的 focused folder

side panel（OpenSpec 與 Files 兩個身分）所呈現的 repo SHALL 由一個**側欄來源**決定，該來源
SHALL 可與 rail 的 focused folder 不同。terminal（session 分頁、focused session、pty 的顯示）
SHALL NOT 受側欄來源影響 —— 側欄指向另一個 repo 時，terminal 仍呈現 focused folder 的 session。

這解一個 agent 主場才有的情境：在一個 session 裡，`claude` 會 `cd` 到另一個 repo 或拿絕對路徑改
另一個 repo。使用者需要在**不切走正在跑的 agent** 的前提下，讀那個 repo 的 spec 與檔案。

#### Scenario: 側欄指向另一個 repo，terminal 不受影響

- **WHEN** focused session 屬於 repoA，其側欄來源被設為 repoB
- **THEN** side panel 呈現 repoB 的內容，而 terminal 仍呈現 repoA 的 focused session 與分頁列

### Requirement: 側欄來源為 per-session，預設為 session 所屬的 folder

每個 session SHALL 記住自己的側欄來源，其預設值 SHALL 為該 session 所屬的 folder。side panel
呈現的 repo SHALL 為 **focused session 的側欄來源**；使用者切換 focused session 時，side panel
SHALL 隨之呈現新 focused session 的側欄來源。

沒有任何 session 時（例如剛加入、尚未建立 session 的 folder），側欄來源 SHALL 退回 rail 的
focused folder。

這是「側欄跟隨 focused session」既有語意的延伸：既有的 `anchoredChange` 已是 per-session 且切
session 就跟著走，本能力把跟隨的粒度從「一個 change」放大為「一個 (repo, change)」。

#### Scenario: 未曾改動時呈現 session 自己的 repo

- **WHEN** 一個 session 的側欄來源未曾被改動
- **THEN** side panel 呈現該 session 所屬 folder 的內容

#### Scenario: 切換 focused session 後側欄來源跟隨

- **WHEN** 兩個 session 的側欄來源指向不同的 repo，使用者將 focus 由其中一個切換至另一個
- **THEN** side panel 呈現新 focused session 的側欄來源所指的 repo

#### Scenario: 沒有 session 時退回 focused folder

- **WHEN** 選中的 folder 尚無任何 session
- **THEN** side panel 呈現該 focused folder 的內容

### Requirement: 來源指示器可選取任一 folder，並提供回到自身 repo 的捷徑

side panel SHALL 於其頂部呈現一條**來源指示器**，標示當前的側欄來源，並 SHALL 允許使用者將側欄
來源改為 workspace 中的任一 folder。來源指示器的選取 SHALL 可全鍵盤操作（沿用既有選單的紀律），
其文案 SHALL 來自字典（`ui-localization`）。

當側欄來源指向**非** session 所屬 folder 的 repo 時，來源指示器 SHALL 提供一個一鍵將側欄來源
重置回 session 所屬 folder 的捷徑 —— 這取代了「跟隨/釘住」切換鈕（session 所屬的 folder 不隨
pty 的 cwd 浮動，故「跟隨」退化為「釘在自身 folder」，一個 toggle 無事可做）。

#### Scenario: 選取另一個 folder 作為側欄來源

- **WHEN** 使用者於來源指示器選擇 workspace 中的另一個 folder
- **THEN** side panel 呈現該 folder 的內容，且該選擇成為 focused session 的側欄來源

#### Scenario: 一鍵回到自身的 repo

- **WHEN** 側欄來源指向非 session 所屬 folder 的 repo，使用者觸發「回到自身 repo」的捷徑
- **THEN** 側欄來源重置為該 session 所屬的 folder

### Requirement: OpenSpec 與 Files 兩個身分共用同一個側欄來源

side panel 的 OpenSpec 與 Files 兩個身分 SHALL 共用同一個側欄來源。切換身分 SHALL NOT 改變側欄
來源所指的 repo。

Files 身分的檔案樹是單一 repo 的階層結構，本就一次只能呈現一個來源 —— 這也是側欄採「選一個
repo」而非「聚合多個 repo」的決定性理由：若 OpenSpec 聚合而 Files 只能選一個，兩個身分的來源
語意就會分裂。

#### Scenario: 切換身分不改變側欄來源

- **WHEN** 側欄來源指向 repoB，使用者於 OpenSpec 與 Files 身分之間切換
- **THEN** 兩個身分皆呈現 repoB 的內容

### Requirement: 切換側欄來源時重置錨定的 change

使用者切換側欄來源時，該 session 的 `anchoredChange` SHALL 被重置。change 的 slug 隸屬於某個
repo（`openspec/changes/<slug>`）—— 沿用舊 repo 的 slug，本 change 視圖會對著一個在新 repo 不
存在的 change 呈現空狀態，看起來像壞掉。重置後由既有的衍生預設接手（新來源 repo 恰有一個 active
change 時呈現它，否則呈現空狀態讓使用者自行挑選）。

#### Scenario: 切換側欄來源後本 change 重置

- **WHEN** focused session 錨定了 repoA 的某個 change，使用者將側欄來源切至 repoB
- **THEN** 該 session 不再錨定 repoA 的 change；本 change 視圖依 repoB 的狀態重新解析
