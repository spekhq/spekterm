## MODIFIED Requirements

### Requirement: Files 身分呈現當前 folder 的檔案樹

side panel 的 Files 身分 SHALL 呈現**側欄來源** repo 的檔案樹（見 `side-panel-source`），根目錄
預設展開。此處的「當前 folder」即**側欄來源** —— 它是 focused session 的側欄來源，SHALL 可與
rail 的 focused folder 不同（沒有任何 session 時退回 focused folder）。每個項目 SHALL 呈現其名稱，
並以可辨識的方式區分目錄與檔案。

樹的**根**為該側欄來源 repo 的**當前選定工作目錄**（見 `side-panel-worktree`），而非恆為 folder
根目錄。folder 自身是其預設值。隨之，樹上呈現的路徑、麵包屑的尾段、以及本能力其餘要求中的
「根目錄」一律以該工作目錄為基準。

**檔案系統的定址不因此改變**：對主行程的請求仍以 `(folder 識別碼, folder-relative 路徑)` 表達，
所選工作目錄僅作為該路徑的前綴。於是邊界夾制、監看的訂閱與事件推送、以及未存變更的鍵皆不受影響。

樹的視覺狀態以 `docs/workspace-mockup.html` 的 `.file-tree` 為權威：目錄以展開／收合字符標示、
以深度縮排、名稱較檔案醒目。

#### Scenario: 呈現側欄來源 repo 的根目錄內容

- **WHEN** 使用者切換至 Files 身分
- **THEN** side panel 呈現側欄來源 repo 當前選定工作目錄的直接子項目，目錄與檔案可被區分

#### Scenario: 側欄來源指向另一個 repo

- **WHEN** focused session 屬於 repoA，其側欄來源被設為 repoB，使用者切換至 Files 身分
- **THEN** Files 身分呈現 repoB 的檔案樹，而非 repoA 的

#### Scenario: 選定工作目錄後根隨之改變

- **WHEN** 使用者選定側欄來源 repo 的某個 linked worktree
- **THEN** 檔案樹呈現該 worktree 根目錄的直接子項目

#### Scenario: 沒有可用的側欄來源

- **WHEN** workspace 中沒有任何 folder 可作為側欄來源
- **THEN** Files 身分呈現說明此狀態的提示，而非空白或錯誤

### Requirement: 檔案樹標記有未存變更的檔案

檔案樹上的每一列，若其對應的檔案有未存的變更，SHALL 以可辨識的標記呈現該狀態。

Files 身分的面板 header SHALL 呈現當前 folder 中有未存變更的檔案總數。此總數 SHALL NOT 因該檔案位於一個尚未展開的目錄之下而遺漏 —— 樹上的標記只在該列可見時看得到，而未存的變更可能落在任何深度。

**此總數的範圍為整個 folder，SHALL NOT 收窄至當前選定的工作目錄** —— 這與同一 header 上的「可見
項目數」（已收窄至工作目錄）作用域不同，而該差異是刻意的：項目數描述「眼前這棵樹有多大」，未存
變更數描述「你還有多少東西沒存」。收窄後者會讓另一個工作目錄的未存變更在切走的瞬間**自使用者的
視野中完全消失**，而那正是本要求存在的理由 —— 它原本要解的就是「標記只在該列可見時看得到」。

side panel 不具備分頁列，因此若不標記，使用者沒有任何線索得知自己尚有未存的變更。

#### Scenario: 有未存變更的檔案於樹上被標記

- **WHEN** 使用者修改一個檔案的內容而不存檔，並返回檔案樹
- **THEN** 該檔案所在的列呈現其有未存變更的標記

#### Scenario: 存檔後標記消失

- **WHEN** 一個被標記的檔案完成存檔
- **THEN** 該列不再呈現未存變更的標記

#### Scenario: 未展開的目錄之下的未存變更計入總數

- **WHEN** 一個有未存變更的檔案位於一個尚未展開的目錄之下
- **THEN** 面板 header 呈現的未存變更總數仍包含它

#### Scenario: 另一個工作目錄的未存變更仍計入總數

- **WHEN** 使用者於某個 worktree 的檔案留下未存的變更，然後切換至另一個工作目錄
- **THEN** header 呈現的未存變更總數仍計入該檔案

### Requirement: 面板呈現當前可見的項目數

Files 身分的面板 header SHALL 呈現檔案樹中當前可見的項目數，並於展開或收合改變可見項目時隨之更新。

計數的範圍為**當前選定工作目錄之下**的可見項目 —— 它與樹所呈現的內容一致，SHALL NOT 計入該工作
目錄之外的項目。

#### Scenario: 展開目錄後項目數增加

- **WHEN** 使用者展開一個含有 N 個直接子項目的目錄
- **THEN** header 呈現的項目數增加 N

#### Scenario: 切換工作目錄後項目數為新根之下的數量

- **WHEN** 使用者切換至另一個工作目錄
- **THEN** header 呈現的項目數為新工作目錄根目錄下可見項目的數量
