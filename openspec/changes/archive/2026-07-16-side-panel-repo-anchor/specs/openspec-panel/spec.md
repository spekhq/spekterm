## MODIFIED Requirements

### Requirement: 側欄跟隨 focused session 的錨定 change

**本 change** 視圖所呈現的 change SHALL 為**當前 focused terminal session** 所錨定的 change，
且該 change 隸屬於該 session 的**側欄來源** repo（見 `side-panel-source`）。使用者切換 focused
session 時，本 change 視圖 SHALL 隨之呈現新 focused session 所錨定的 change。

錨定關係為 per-session —— 不同的 session 可錨定不同的 change。

**側欄來源** repo **恰有一個** active change 且尚無明確的錨定時，本 change 視圖 SHALL 呈現該
change —— 這是**衍生的預設值**，SHALL NOT 依賴「使用者曾經建立過 session」。使用者選了一個只有
一個 active change 的 repo，卻看到空白的側欄，是說不過去的。

沒有任何 session 時，側欄來源退回 rail 的 focused folder（見 `side-panel-source`）—— 此處的
「側欄來源」在該情境下即為 focused folder。

#### Scenario: 切換 session 後側欄跟隨

- **WHEN** 兩個 session 錨定了不同的 change，使用者將 focus 由其中一個切換至另一個
- **THEN** 本 change 視圖呈現新 focused session 所錨定的 change

#### Scenario: 尚未建立任何 session 時仍呈現唯一的 active change

- **WHEN** 使用者選中一個恰有一個 active change 的 folder，且尚未建立任何 session
- **THEN** 本 change 視圖呈現該 change

#### Scenario: 側欄來源指向另一個 repo 時呈現該 repo 的 change

- **WHEN** focused session 屬於 repoA，其側欄來源被設為 repoB
- **THEN** 本 change 視圖呈現 repoB 的 change（依錨定或衍生預設），而非 repoA 的

### Requirement: 側欄資料隨檔案變更更新

**側欄來源** repo 的 `openspec/` 之下發生檔案變更時，側欄呈現的內容 SHALL 隨之更新 —— 使用者
SHALL NOT 需要手動重新整理。側欄來源與 rail 的 focused folder 不同時，此更新 SHALL 針對**側欄
來源** repo（那正是 agent 正在改的地方），而非 focused folder。

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
