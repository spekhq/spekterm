## MODIFIED Requirements

### Requirement: 狀態列呈現 focused session 的脈絡

狀態列 SHALL 呈現當前 focused session 的脈絡資訊，至少包含：其所屬 repo 的名稱、該 repo 的
git 當前分支、該 session 的標籤，以及**當前側欄座標所錨定的 change**（若有）與該 change 的任務
進度（若有）。

**錨定的 change 隸屬於 rail 上選中的項目，而非該 session**（見 `side-panel-source`）—— 於是同一個
folder 的多個 session 於狀態列上呈現同一個 change。這不構成歧義：狀態列的其餘欄位（標籤、執行
狀態、工作目錄）本就逐 session 而異，而 change 是「這個 repo 我正在看哪一個」的答案。

**沒有 focused session 時，本條所述的整條脈絡 SHALL 呈現為空狀態，SHALL NOT 因為側欄座標在無
session 時依然存在而單獨呈現其中的 change。** 這一條在改基之前是隱含的（座標不存在，無從呈現），
改基之後必須明寫 —— 否則照字面實作會得到一條只剩半截的狀態列。

側欄來源**不等於 rail 上選中的 folder** 時，狀態列 SHALL 一併標示側欄來源；
**相等時 SHALL NOT 標示** —— 那是常態，標示它等於在每一列都重複同一個值。

#### Scenario: 呈現 focused session 的 repo 與分支

- **WHEN** 存在 focused session
- **THEN** 狀態列呈現該 session 所屬 repo 的名稱與其 git 當前分支

#### Scenario: 呈現錨定的 change 與進度

- **WHEN** 存在 focused session，且當前的側欄座標錨定了一個含 tasks 的 change
- **THEN** 狀態列呈現該 change 的識別碼與其任務完成進度

#### Scenario: 沒有 focused session 時不單獨呈現 change

- **WHEN** 使用者選中一個尚無任何 session、而其側欄座標錨定了某個 change 的 folder
- **THEN** 狀態列呈現無 session 的空狀態，而非該 change

#### Scenario: 側欄來源指向別的 repo 時標示

- **WHEN** 側欄來源被指向 workspace 中另一個 folder
- **THEN** 狀態列標示側欄來源

#### Scenario: 側欄來源即自身時不標示

- **WHEN** 側欄來源等於 rail 上選中的 folder
- **THEN** 狀態列不標示側欄來源

#### Scenario: 切換 focused session 時內容隨之改變

- **WHEN** 使用者把焦點切換到另一個 session
- **THEN** 狀態列呈現的脈絡改為該 session 的
