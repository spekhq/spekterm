## ADDED Requirements

### Requirement: 側欄來源未選定時 Files 身分呈現可行動的空狀態

側欄座標的來源 repo **尚未選定**時（此狀態自 `global-session` 起存在），Files 身分 SHALL 呈現
空狀態並說明使用者可以選擇一個 repo，SHALL NOT 呈現任何檔案樹。

**SHALL NOT 以使用者的家目錄或任何非 workspace folder 的位置作為檔案樹的根。** 檔案樹的根恆為某個
workspace folder 的工作目錄 —— 這是 `filesystem-access` 之所以一條都不必修改的前提：全域項目讓
session 開在家目錄，但**不**讓 renderer 以任何方式讀取它。

空狀態 SHALL 說明**為什麼**這裡沒有檔案樹（因為 Files 檢視的是 workspace 中的 repo），
SHALL NOT 只是一塊沉默的空白 —— 否則使用者會把一個刻意的邊界讀成故障。

#### Scenario: 全域項目預設呈現空狀態

- **WHEN** 使用者選中全域項目而尚未選擇側欄來源，並切換至 Files 身分
- **THEN** 面板呈現空狀態並說明可選擇一個 repo，且不呈現任何檔案樹

#### Scenario: 來源未選定時不呈現任何檔案列

- **WHEN** 使用者於全域項目的 Files 身分檢視面板，而側欄來源尚未選定
- **THEN** 面板不呈現任何檔案或目錄的列

#### Scenario: 選定來源後樹以該 repo 為根

- **WHEN** 使用者接著為全域項目選定一個 repo 作為來源
- **THEN** 檔案樹呈現該 repo 的內容
- **AND** 本條與上一條**必須成對驗收** —— 對一塊空白面板斷言「不含家目錄的內容」恆為真，
  那樣的綠燈連「Files 身分整個壞掉」都攔不住；有了正向的這一條，「永遠空白」才會被抓到

> **「樹根不可能是家目錄」由結構保證，不由探針**：`fs.*` 的每一個能力都要求一個 folder 識別碼
> （`filesystem-access`，本 change 一條未改），而家目錄不是任何 folder —— renderer 沒有詞彙可以
> 表達它。這比任何哨兵都強，且不需要探針去證明一個否定命題。

