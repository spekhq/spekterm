## MODIFIED Requirements

### Requirement: Files 身分呈現當前 folder 的檔案樹

side panel 的 Files 身分 SHALL 呈現**側欄來源** repo 的檔案樹（見 `side-panel-source`），根目錄
預設展開。此處的「當前 folder」即**側欄來源** —— 它是 **rail 上選中之項目的側欄座標**所指的 repo，
SHALL 可與 rail 的 focused folder 不同，且 SHALL NOT 以「該 folder 是否已有 session」為前提。
每個項目 SHALL 呈現其名稱，並以可辨識的方式區分目錄與檔案。

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

- **WHEN** rail 上選中的 folder 為 repoA，其側欄來源被設為 repoB，使用者切換至 Files 身分
- **THEN** Files 身分呈現 repoB 的檔案樹，而非 repoA 的

#### Scenario: 尚無 session 的 folder 同樣呈現其側欄來源

- **WHEN** 使用者選中一個尚未建立任何 session 的 folder，將其側欄來源設為 repoB 並切換至
  Files 身分
- **THEN** Files 身分呈現 repoB 的檔案樹

#### Scenario: 選定工作目錄後根隨之改變

- **WHEN** 使用者選定側欄來源 repo 的某個 linked worktree
- **THEN** 檔案樹呈現該 worktree 根目錄的直接子項目

#### Scenario: 沒有可用的側欄來源

- **WHEN** workspace 中沒有任何 folder 可作為側欄來源
- **THEN** Files 身分呈現說明此狀態的提示，而非空白或錯誤
