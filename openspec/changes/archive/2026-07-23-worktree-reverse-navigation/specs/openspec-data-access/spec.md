## ADDED Requirements

### Requirement: 主行程供應各工作目錄的 folder-relative 根

主行程 SHALL 為一個 folder 供應**可用於定位 OpenSpec 內容的工作目錄根**清單，每個根 SHALL 為
相對於 folder root 的相對路徑。

renderer 需要判斷一個 folder-relative 路徑是否落在某個工作目錄的 `openspec/` 之下（供
`openspec-panel` 的反向交叉導覽），而它目前**沒有任何詞彙**可以表達工作目錄的位置 —— 既有的
來源 DTO 只帶不可逆的識別碼、分支、版控種類與兩個布林，沒有一個能回答這個問題。

**清單 SHALL 恆包含代表 folder 自身的空相對路徑**，不論該 folder 是否位於版控之下、是否為某個
repo 的子目錄、亦不論工作目錄的列舉是否成功。folder 自身的 `openspec/` 是這個能力自始就在供應
的東西，它的可導覽性 SHALL NOT 取決於 git 的列舉結果。

其餘工作目錄無法翻譯為 folder-relative 路徑時（位於 folder 邊界之外），SHALL 整筆自清單省略，
SHALL NOT 以絕對路徑呈現，亦 SHALL NOT 以 `null` 佔位 —— **空字串是 folder 自身的合法值**，
清單中混入 `null` 會與它在消費端糾纏。於是「邊界外的工作目錄不提供檔案導覽入口」在資料層就已
成立，不倚賴 UI 記得檢查。

該清單 SHALL 隨該 folder 的 OpenSpec 結構變更而更新 —— 工作目錄的新增與移除已在既有的監看
範圍之內（見 `worktree-aggregation` 的監看要求），SHALL NOT 為此另行建立監看。

#### Scenario: 清單包含 folder 自身與邊界內的 worktree

- **WHEN** renderer 為一個 folder 請求工作目錄的根清單，而該 repo 有一個位於 folder 邊界內的
  linked worktree
- **THEN** 清單包含代表 folder 自身的空相對路徑
- **AND** 清單包含該 worktree 的 folder-relative 根

#### Scenario: folder 不在任何版控之下

- **WHEN** 一個 folder 不是 git repo、也不在任何 git repo 之內
- **THEN** 清單恰包含代表 folder 自身的空相對路徑

#### Scenario: folder 是某個 repo 的子目錄

- **WHEN** 一個 folder 是某個 git repo 的子目錄，該 repo 的工作目錄根位於 folder 邊界之外
- **THEN** 清單包含代表 folder 自身的空相對路徑
- **AND** 清單不包含該 repo 的工作目錄根（它翻譯不出 folder-relative 路徑）

#### Scenario: 邊界外的工作目錄不出現於清單

- **WHEN** 該 repo 有一個位於 folder 邊界外的 linked worktree
- **THEN** 該工作目錄不出現於清單中

#### Scenario: 清單不含絕對路徑

- **WHEN** 檢視回傳給 renderer 的工作目錄根清單
- **THEN** 其中每一個值皆為相對路徑，無任何值為絕對路徑，亦無任何值為 `null`

#### Scenario: 新增工作目錄後清單更新

- **WHEN** 一個位於 folder 邊界內的 worktree 於 app 執行期間被建立
- **THEN** renderer 取得的工作目錄根清單隨之包含它
