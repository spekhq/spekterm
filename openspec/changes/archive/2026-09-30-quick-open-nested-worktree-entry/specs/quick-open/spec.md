## MODIFIED Requirements

### Requirement: 清單不含其他工作目錄與版控忽略的內容

呈現給使用者選擇的清單 SHALL NOT 含有位於**其他工作目錄**之下的檔案，亦 SHALL NOT 含有版本控制
所忽略的內容（建置產物、相依套件目錄等）。

**前者是本要求的重點。** 使用者的標準工作流把每個 change 的 git worktree 開在 repo **內部**
（`.claude/worktrees/<slug>/`）—— 一個天真的遞迴列舉會使同一個檔案在結果中出現 N+1 次，而那正好
摧毀本能力的主要情境（使用者知道檔名、要跳過去）。這也與 `side-panel-worktree` 的模型一致：
worktree 是**另一個**工作目錄，由工作目錄選擇器切換。

清單 SHALL 只含檔案，SHALL NOT 含目錄 —— 目標是開啟一個檔案，而側欄的檢視器開不了目錄。

#### Scenario: 巢狀工作目錄的檔案不重複出現

- **WHEN** 某個 repo 於自身之內含有一個 git worktree，其中存在與主工作目錄同名的檔案，
  而使用者以側欄來源為該 repo 的**主**工作目錄開啟快速開啟入口並查詢該檔名
- **THEN** 結果中該檔案恰好出現一次，且其路徑不位於該 worktree 之下

#### Scenario: 版控忽略的內容不出現

- **WHEN** 使用者查詢一個僅存在於版控忽略目錄（例如相依套件目錄）之下的檔案
- **THEN** 該檔案不出現在結果中

#### Scenario: 目錄不出現在結果中

- **WHEN** 使用者查詢的片段與某個目錄的名稱相符
- **THEN** 該目錄不出現在結果中

#### Scenario: A nested working tree or nested repository itself is not listed

- **WHEN** a repo contains, inside itself, a git worktree and a separate git repository, neither of
  which is ignored by any ignore rule — including the user's global ignore rules
- **AND** the user opens the quick-open entry with the side-panel source set to the repo's **main**
  working directory
- **THEN** neither the worktree nor the nested repository appears as an entry in the results
- **AND** a file tracked in the main working directory still appears

#### Scenario: A submodule itself is not listed

- **WHEN** a repo contains a submodule
- **AND** the user opens the quick-open entry with the side-panel source set to that repo
- **THEN** neither the submodule nor any file inside it appears in the results
- **AND** a file tracked in the repo still appears

#### Scenario: A tracked symlink to a directory is not listed

- **WHEN** a repo tracks a symbolic link that points to a directory, and also tracks a symbolic link
  that points to a file inside the repo
- **AND** the user opens the quick-open entry with the side-panel source set to that repo
- **THEN** the link to the directory does not appear in the results
- **AND** the link to the file does appear

#### Scenario: A file in a merge conflict appears once

- **WHEN** a repo has a file in an unresolved merge conflict
- **AND** the user opens the quick-open entry with the side-panel source set to that repo
- **THEN** that file appears exactly once in the results

#### Scenario: A folder whose only content is a nested working tree lists nothing from inside it

- **WHEN** a repo has no files of its own, and holds inside itself a git worktree whose checkout
  contains files, not ignored by any ignore rule
- **AND** the user opens the quick-open entry with the side-panel source set to the repo's main
  working directory
- **THEN** the results contain no file from under that worktree
