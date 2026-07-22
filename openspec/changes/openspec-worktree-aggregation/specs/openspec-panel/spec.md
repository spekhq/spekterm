## ADDED Requirements

### Requirement: change 標示其來源工作目錄

側欄呈現 change 時，來源**非主工作目錄**的 change SHALL 標示其來源。標示的內容 SHALL 為該工作
目錄的分支名稱；分支無法判定（detached HEAD）時 SHALL 呈現一個固定的替代字樣。

來自**主工作目錄**的 change SHALL NOT 標示來源 —— 在單一工作目錄的 repo 裡那會是每一列都重複一次
的雜訊（比照 rail 曾把「每列都喊一次的 `OpenSpec`」降級的判斷）。

標示 SHALL NOT 呈現來源工作目錄的絕對路徑 —— renderer 不持有該資訊（見 `worktree-aggregation`）。

#### Scenario: 來自 linked worktree 的 change 標示分支

- **WHEN** 側欄呈現一個來源為 linked worktree 的 change
- **THEN** 該 change 標示其來源工作目錄的分支名稱

#### Scenario: 來自主工作目錄的 change 不標示

- **WHEN** 側欄呈現一個來源為主工作目錄的 change
- **THEN** 該 change 不呈現來源標示

#### Scenario: 標示不含路徑

- **WHEN** 側欄呈現任一 change 的來源標示
- **THEN** 標示及其提示文字均不含檔案系統路徑

## MODIFIED Requirements

### Requirement: 側欄資料隨檔案變更更新

**側欄來源** repo 的 `openspec/` 之下發生檔案變更時，側欄呈現的內容 SHALL 隨之更新 —— 使用者
SHALL NOT 需要手動重新整理。側欄來源與 rail 的 focused folder 不同時，此更新 SHALL 針對**側欄
來源** repo（那正是 agent 正在改的地方），而非 focused folder。

此處的「該 repo 的 `openspec/`」SHALL 涵蓋該 repo 的**每一個工作目錄**的 `openspec/`，而非僅主
工作目錄的那一個（見 `worktree-aggregation`）—— agent 在一個 linked worktree 裡改 spec、勾 tasks，
與它在主工作目錄裡做同樣的事，對使用者而言是同一件事。

這是本 app 的核心情境：agent 在 terminal 中改 spec、勾 tasks，側欄應當即時反映 —— 即使 agent
改的是 focused folder 之外的另一個 repo（見 `side-panel-source`）。

#### Scenario: agent 勾完一個 task 後進度更新

- **WHEN** 外部程式改動了錨定 change 的 tasks 檔案
- **THEN** 本 change 視圖的 tasks 進度隨之更新

#### Scenario: 新增一個 change 後樹上出現它

- **WHEN** 外部程式於 `openspec/changes/` 下新增一個 change
- **THEN** 瀏覽視圖的 Changes 樹隨之出現該 change

#### Scenario: 側欄來源 repo 的變更即時反映

- **WHEN** 側欄來源指向一個非 focused folder 的 repo，外部程式改動了該 repo 的 `openspec/`
- **THEN** 側欄呈現的內容隨之更新，無需手動重新整理

#### Scenario: linked worktree 中的變更即時反映

- **WHEN** 外部程式改動了側欄來源 repo 的某個 linked worktree 中、錨定 change 的 tasks 檔案
- **THEN** 本 change 視圖的 tasks 進度隨之更新，無需手動重新整理
