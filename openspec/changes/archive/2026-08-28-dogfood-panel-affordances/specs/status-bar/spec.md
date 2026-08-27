## ADDED Requirements

### Requirement: 狀態列呈現的錨定 change 與側欄以同一條規則解析

狀態列所呈現的錨定 change SHALL 與 side panel 的「本 change」視圖**以同一條規則解析**（見
`openspec-panel`「本 change 視圖呈現當前側欄座標所錨定的 change」）：明確的錨定須存在於側欄來源
repo 的掃描結果之中，否則讓位給衍生預設；兩者皆不成立時 SHALL NOT 呈現該欄位。

**兩處對同一個問題 SHALL NOT 給出兩個答案。** 錨定跨重啟存活而 slug 會改名或消失（`openspec
archive` 會把 slug 改名為帶日期前綴的形式）—— 只在一處加上解析，得到的是「側欄說沒有在看任何
change，狀態列說正在看 `add-list-unsubscribe-header`」，而使用者無從判斷哪一個是真的。

解析不出來時 SHALL NOT 呈現任何錯誤或佔位文字：那一欄就是不存在（比照「狀態列不呈現恆定不變的
欄位」的紀律 —— 沒有內容的欄位不佔用寬度）。

#### Scenario: 錨定的 change 已不存在於來源 repo 時不呈現該欄位

- **WHEN** 某個 folder 的座標錨定了一個已不存在於該 repo 掃描結果中的 slug，且該 repo 的 active
  change 不只一個，使用者選中該 folder 的某個 session
- **THEN** 狀態列不呈現任何 change 欄位，亦不呈現該 slug 或任何錯誤文字

#### Scenario: 側欄與狀態列呈現同一個答案

- **WHEN** 側欄的「本 change」視圖正呈現某個 change
- **THEN** 狀態列呈現的 change 與它相同
