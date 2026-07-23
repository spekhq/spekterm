## MODIFIED Requirements

### Requirement: OpenSpec 與 Files 兩個身分之間可交叉導覽

使用者 SHALL 能自 OpenSpec 身分中的 spec 或 change artifact，跳至其底層的檔案 —— 該操作 SHALL 切換
side panel 至 Files 身分並開啟該檔案。該入口於介面上的標籤為 **Open in Files**。

使用者 SHALL 能自 Files 身分中一個位於**某個工作目錄**的 `openspec/` 之下的檔案，跳至其對應的
spec 或 change —— 該操作 SHALL 切換 side panel 至 OpenSpec 身分並呈現對應的內容。該入口於介面上
的標籤為 **View in OpenSpec**。

**「某個工作目錄」涵蓋 folder 自身與該 repo 位於 folder 邊界內的 linked worktree**，其清單由主
行程供應（見 `openspec-data-access`）。判定 SHALL 為：**以工作目錄根由長至短逐一嘗試 —— 剝除該
根之後的第一段為 `openspec` 且其後符合已知結構者即命中，取第一個命中的結果**。由長至短是
tie-break（工作目錄可能巢狀），逐一嘗試則使某個根剝出後不成立時仍會試其餘的根。

判定 SHALL NOT 鬆綁為「路徑中任一段為 `openspec`」—— 一個位於 `docs/openspec/` 之下、且其後
結構與 OpenSpec 相同的檔案不是 OpenSpec artifact，SHALL NOT 呈現 **View in OpenSpec**。

工作目錄根的比對 SHALL 以路徑分段進行，SHALL NOT 以字串前綴進行 —— 否則當清單中同時存在兩個
根、其一為另一之字串前綴時，較短的那個會先命中並剝出錯誤的剩餘路徑。

工作目錄根清單尚未取得時 SHALL NOT 呈現 **View in OpenSpec**，清單抵達後 SHALL 呈現 —— 該清單
per-folder 取得一次並隨結構變更更新，SHALL NOT 於每次開啟檔案時重新請求。

自 worktree 的 `openspec/specs/<topic>/` 之下的檔案觸發時，SHALL 呈現該 **topic**（反向導覽的
目標是 spec 這個實體，不是某一個檔案）。側欄呈現的是該 topic 當前納入的版本，其來源由
`worktree-aggregation` 決定 —— 該版本與觸發時所開啟的檔案可能不同份。

因此 spec 檢視 SHALL 標示其內容的來源工作目錄，**但僅在該 repo 有多於一個工作目錄時** ——
只有一個工作目錄時不存在任何歧義，標示會成為每個 repo 都喊一次的噪音（比照 change 的來源徽章
不標示主工作目錄）。

交叉導覽 SHALL NOT 影響未存檔的編輯內容（dirty buffer 跨身分存活，延續 `file-editing` 的既有保證）。

#### Scenario: 自 spec 跳至其檔案

- **WHEN** 使用者於 OpenSpec 身分中觸發某個 spec 的 **Open in Files**
- **THEN** side panel 切換至 Files 身分，並開啟該 spec 的 `.md` 檔

#### Scenario: 自 openspec 目錄下的檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於 `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 自 worktree 中的 change 檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的
  `openspec/changes/<slug>/` 之下的檔案，並觸發 **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 change

#### Scenario: 自 worktree 中的 spec 檔案跳回 OpenSpec 身分

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的
  `openspec/specs/<topic>/` 之下的檔案，該 topic 已納入側欄呈現的 spec 清單，並觸發
  **View in OpenSpec**
- **THEN** side panel 切換至 OpenSpec 身分，並呈現該 topic
- **AND** 呈現的內容標示其來源工作目錄

#### Scenario: topic 僅存在於該 worktree

- **WHEN** 使用者於 Files 身分中開啟一個位於邊界內 worktree 的 `openspec/specs/<topic>/` 之下的
  檔案，而該 topic 尚未納入側欄呈現的 spec 清單（例如它是該 worktree 中新增的 capability）
- **THEN** 觸發 **View in OpenSpec** 後呈現該 topic 不存在的狀態，且不呈現任何其他 topic 的內容

#### Scenario: 位於 docs 之下、結構相同的檔案不呈現入口

- **WHEN** 使用者於 Files 身分中開啟 `docs/openspec/changes/<slug>/proposal.md`
- **THEN** 不呈現 **View in OpenSpec** 入口
- **AND** 該檔案位於邊界內 worktree 的 `docs/openspec/changes/<slug>/` 之下時亦不呈現

#### Scenario: 兩個工作目錄根互為字串前綴

- **WHEN** 工作目錄根清單同時包含 `<root>` 與 `<root><suffix>`（前者為後者的字串前綴），而使用者
  開啟位於 `<root><suffix>/openspec/changes/<slug>/` 之下的檔案
- **THEN** 呈現 **View in OpenSpec**，且觸發後呈現該 change

#### Scenario: 交叉導覽不丟失未存的編輯

- **WHEN** 使用者在 Files 身分中有未存檔的編輯，切換至 OpenSpec 身分後再切回
- **THEN** 未存檔的編輯內容仍在
