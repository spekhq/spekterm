## MODIFIED Requirements

### Requirement: Files 身分呈現當前 folder 的檔案樹

side panel 的 Files 身分 SHALL 呈現**側欄來源** repo 的檔案樹（見 `side-panel-source`），根目錄
預設展開。此處的「當前 folder」即**側欄來源** —— 它是 focused session 的側欄來源，SHALL 可與
rail 的 focused folder 不同（沒有任何 session 時退回 focused folder）。每個項目 SHALL 呈現其名稱，
並以可辨識的方式區分目錄與檔案。

樹的視覺狀態以 `docs/workspace-mockup.html` 的 `.file-tree` 為權威：目錄以展開／收合字符標示、
以深度縮排、名稱較檔案醒目。

#### Scenario: 呈現側欄來源 repo 的根目錄內容

- **WHEN** 使用者切換至 Files 身分
- **THEN** side panel 呈現側欄來源 repo 根目錄的直接子項目，目錄與檔案可被區分

#### Scenario: 側欄來源指向另一個 repo

- **WHEN** focused session 屬於 repoA，其側欄來源被設為 repoB，使用者切換至 Files 身分
- **THEN** Files 身分呈現 repoB 的檔案樹，而非 repoA 的

#### Scenario: 沒有可用的側欄來源

- **WHEN** workspace 中沒有任何 folder 可作為側欄來源
- **THEN** Files 身分呈現說明此狀態的提示，而非空白或錯誤
