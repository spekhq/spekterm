## MODIFIED Requirements

### Requirement: 工作目錄位於 folder 邊界外時資料完整，僅檔案導覽降級

worktree 的實體位置 SHALL NOT 限制 change 資料的完整性 —— 工作目錄位於 folder 邊界之外（例如
`/tmp`）時，該 change 的內容、tasks 進度與 spec deltas SHALL 與位於邊界內時相同。

指向檔案的路徑欄位無法翻譯為 folder-relative 時 SHALL 為 `null`，其對應的檔案導覽入口 SHALL NOT
呈現（延續既有的「翻不出來就回 null」原則）。

**檔案導覽入口存在時 SHALL 為雙向**：自該 change 的 artifact 可跳至其底層檔案，且自 Files 身分
中該檔案可跳回 OpenSpec 身分。**同一個檔案去得了就必須回得來** —— 單向的導覽在使用者眼中是壞掉
的，而非「只支援一半」。這條與本 requirement 的降級規則相合：邊界外的工作目錄兩個方向都沒有入口。

**檔案樹的根可切換之後，雙向的保證涵蓋樹根本身**：自 artifact 跳往位於某個工作目錄內的檔案時，
Files 身分的工作目錄 SHALL 一併切換至該工作目錄（見 `side-panel-worktree`），使該檔案落在當前
樹根之下。少了這一步，往返的其中一段會把使用者送到一棵不含該檔案的樹上 —— 那與單向導覽是同一種
壞法。

邊界外的工作目錄在 Files 的工作目錄選擇器中 SHALL 呈現且為停用（見 `side-panel-worktree`）——
這**不是**本 requirement 的例外：它們的檔案仍然不在該 folder 的檔案樹中，選擇器呈現它們是為了讓
「不可瀏覽」成為一個看得見的事實，而非一個看起來像疏漏的缺席。

#### Scenario: 邊界外 worktree 的 change 內容完整

- **WHEN** 一個 change 只存在於位於 folder 邊界外的 worktree
- **THEN** 側欄呈現該 change 的 artifacts 與 tasks 進度

#### Scenario: 邊界外 worktree 的 change 不提供檔案導覽入口

- **WHEN** 使用者檢視一個來源位於 folder 邊界外的 change
- **THEN** 該 change 及其 artifact 不呈現「在 Files 中開啟」之類的檔案導覽入口

#### Scenario: 邊界內 worktree 的 change 可跨身分導覽

- **WHEN** 使用者檢視一個來源位於 folder 邊界內的 worktree 的 change 的某個 artifact
- **THEN** 該 artifact 提供檔案導覽入口，且觸發後於 Files 身分開啟該檔案
- **AND** Files 身分的樹根為該 worktree

#### Scenario: 邊界內 worktree 的檔案可跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 folder 邊界內 worktree 的
  `openspec/changes/<slug>/` 之下的檔案
- **THEN** 該檔案提供跳回 OpenSpec 身分的入口，且觸發後呈現該 change

#### Scenario: 邊界外 worktree 的檔案不在該 folder 的檔案樹中

- **WHEN** 一個 change 只存在於位於 folder 邊界外的 worktree
- **THEN** **該 folder** 的檔案樹不呈現該 worktree 的任何檔案（它們沒有 folder-relative 路徑），
  因此不存在需要跳回 OpenSpec 身分的檔案
- **AND** 該工作目錄於 Files 的工作目錄選擇器中呈現為停用，無法被選為樹根
