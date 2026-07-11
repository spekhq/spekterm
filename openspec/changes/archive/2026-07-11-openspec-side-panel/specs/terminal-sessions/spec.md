## ADDED Requirements

### Requirement: session 可錨定一個 change

每個 session SHALL 可錨定其所屬 folder 的**一個** change，供 side panel 的 OpenSpec 身分跟隨。
錨定關係為 per-session —— 不同的 session 可錨定不同的 change。

**錨定關係由使用者建立，SHALL NOT 由系統自 pty 的輸出或標題推測。** pty 中執行的 agent 不會宣告它正在
處理哪個 change，任何由輸出內容進行的推測都會在「標題碰巧提到某個 slug」時假陽性、在「agent 用別的說法
描述同一件事」時假陰性 —— 一個大部分時候對、偶爾莫名其妙跳到別的 change 的側欄，比沒有側欄更糟，
因為使用者會開始不信任它。

這與「session 的標籤反映 pty 設定的終端標題」不矛盾：那條之所以成立，是因為 pty **真的以 OSC 序列宣告了
標題**（一個明確的協定）。change 的錨定沒有這樣的協定。

session 建立時，若其所屬 folder **恰有一個 active change**，該 session SHALL 錨定該 change。
folder 的 active change 為零或多於一個時，新建的 session SHALL 無錨定 —— 系統不在多個候選之間猜測。

session 的錨定 SHALL 可被使用者改變（入口見 `openspec-panel` 的瀏覽視圖）。

錨定關係 SHALL NOT 持久化 —— session 本身即不跨 app 重啟存活。

#### Scenario: folder 恰有一個 active change 時自動錨定

- **WHEN** 使用者於一個恰有一個 active change 的 folder 建立 session
- **THEN** 該 session 錨定該 change

#### Scenario: folder 有多個 active change 時不猜測

- **WHEN** 使用者於一個有多個 active change 的 folder 建立 session
- **THEN** 該 session 無錨定的 change

#### Scenario: folder 沒有 active change

- **WHEN** 使用者於一個沒有 active change 的 folder 建立 session
- **THEN** 該 session 無錨定的 change

#### Scenario: 錨定不隨 pty 的輸出改變

- **WHEN** 一個已錨定 change 的 session，其 pty 輸出了含有另一個 change slug 的內容或終端標題
- **THEN** 該 session 的錨定不改變

#### Scenario: 不同 session 錨定不同 change

- **WHEN** 同一個 folder 的兩個 session 分別錨定了不同的 change
- **THEN** 兩個 session 各自保有其錨定，互不影響
