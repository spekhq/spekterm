# public-content-hygiene Specification

## Purpose
公開的 repo 不得帶著維護者宣告為內部的識別資訊 —— 任職公司的名稱與內部系統的名稱、同事的名字、維護者的本機
家目錄路徑。repo 公開之後這些就收不回來，而維護者每天都在會自然寫出它們的環境裡工作（dogfood 紀錄、實測數字）。

## Requirements

### Requirement: repo 不含維護者宣告為內部的識別字詞

repo 中的檔案 SHALL NOT 含有維護者宣告為內部的識別字詞。比對以**字詞**為單位：把檔案內容依非英數字元切開、
轉為小寫，任何一個字詞落在清單中即為違規（`Some-Name_URL` 會切成 `some`、`name`、`url` 三個字詞）。

清單 SHALL 以單向雜湊保存於版控，**SHALL NOT 以明文、或任何能還原明文的形式（例如字串拼接）出現在 repo 裡**
—— 守衛本身若寫出那些字，就等於把它們公開。

檢查範圍 SHALL 為版控追蹤的檔案加上尚未追蹤、但未被 `.gitignore` 忽略的檔案，**且不排除任何路徑**（含
`openspec/changes/archive/**`）—— 歷史改寫之後 archive 裡不會再有命中，而一個排除 archive 的守衛會讓下一份
dogfood 紀錄在封存時把名字帶回來。

#### Scenario: 內部識別字詞不出現

- **WHEN** 對檢查範圍內每一個檔案的每一個字詞計算雜湊，與清單比對
- **THEN** 沒有任何命中

#### Scenario: 比對確實有效

- **WHEN** 以同一套切詞與雜湊流程，比對一個已知存在於 repo 的公開字詞（例如產品名）的雜湊
- **THEN** 它命中 —— 一個永遠零命中的比對等於沒有檢查

#### Scenario: 清單不以明文出現

- **WHEN** 讀取守衛的原始碼與它讀取的清單
- **THEN** 清單中的每一項都是固定長度的十六進位雜湊值

### Requirement: repo 不含維護者的本機家目錄路徑

repo 中的檔案 SHALL NOT 含有維護者本機家目錄的絕對路徑。範例與 fixture SHALL 使用通用的家目錄路徑（例如
`/home/me`、`/home/u`）。檢查範圍與上一條相同，不排除任何路徑。

維護者的使用者名稱本身不受此限 —— 它是公開的 GitHub 帳號，出現在 `LICENSE` 與 `FUNDING.yml` 是應該的。

#### Scenario: 家目錄路徑不出現

- **WHEN** 在檢查範圍內搜尋維護者的家目錄路徑
- **THEN** 沒有任何命中

### Requirement: git 歷史不含內部識別資訊

repo 的 git 歷史 —— 每一個 commit 的每一個檔案內容與每一則 commit 訊息 —— SHALL NOT 含有上兩條所禁止的字詞與路徑。
這一條在 repo 公開之前 SHALL 以全歷史掃描驗證一次；公開之後，歷史只會由符合上兩條的 commit 延伸。

#### Scenario: 全歷史零命中

- **WHEN** 以與上兩條相同的比對，掃描所有分支上每一個 commit 的內容與訊息
- **THEN** 沒有任何命中
