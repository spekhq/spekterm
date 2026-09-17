## MODIFIED Requirements

### Requirement: routing 為使用者可編輯的有序規則，第一個命中者勝出

系統 SHALL 以一組**有序規則**把一則 intake 解析為一個 folder。規則 SHALL 依序比對，
**第一個命中的規則勝出**，其後的規則不再參與。

規則 SHALL 為**資料**：使用者 SHALL 能新增、修改、刪除與調整順序，SHALL NOT 需要修改程式碼或
重新安裝應用程式。

規則的判準 SHALL 限於 intake 的通用欄位，SHALL NOT 能以來源專屬的原始內容為判準。

**本條的作用域為「目標尚未被解析」的 intake。** 一則帶著接收端已解析出的目標 folder 的 intake
不比對規則（見下一條）—— 規則是**使用者**用來決定一件事該在哪裡處理的工具，而那種 intake 的
目標是使用者自己指名的。

#### Scenario: 第一個命中的規則勝出

- **WHEN** 三條規則分別指向三個不同的 folder，一則 intake 同時符合第二條與第三條
- **THEN** 解析結果為**第二個** folder

#### Scenario: 把規則往後移改變結果，且結果是絕對的

- **WHEN** 承上，使用者把**第二條規則移到第三條之後**
- **THEN** 同一則 intake 的解析結果為**第三條原本所指向的那個** folder

#### Scenario: 依來源座標識別碼解析

- **WHEN** 一則 intake 的來源座標識別碼符合某條規則，而其標題不符合任何規則
- **THEN** 解析結果為該規則指向的 folder

## ADDED Requirements

### Requirement: 帶著接收端已解析目標的 intake 不比對規則，且其目標不可用時仍然拒絕

一則 intake 帶有**接收端已解析出的目標 folder** 時，系統 SHALL 直接採用該 folder，
SHALL NOT 比對任何規則、SHALL NOT 落到 fallback。

該目標 **SHALL NOT 能由投遞內容表達**（見 `agent-intake`）—— 否則放進共用投遞落點的任何檔案
都能繞過規則自選 folder。

**該 folder 已不在 workspace 中時 SHALL 拒絕並說明**，SHALL NOT 改為比對規則、SHALL NOT 落到
fallback。理由與「命中規則所指向的 folder 已不在 workspace」完全相同：使用者明確指定的目標
不可用時，正確的處置是告訴他，而不是悄悄換一個地方。

#### Scenario: 已解析目標者不受規則影響

- **WHEN** 一則 intake 帶著已解析的目標 folder A，而存在一條會命中它並指向 folder B 的規則
- **THEN** 解析結果為 **A**

#### Scenario: 已解析目標者不落到 fallback

- **WHEN** 一則 intake 帶著已解析的目標 folder A，且沒有任何規則命中它，fallback 指向 B
- **THEN** 解析結果為 **A**

#### Scenario: 已解析的目標已被移出 workspace 時拒絕，即使 fallback 可用

- **WHEN** 一則 intake 帶著已解析的目標 folder A，而 A 已不在 workspace 中，**且 fallback 已設定
  並指向一個可用的 folder**
- **THEN** 該則 intake 無法被處理，且系統說明該 folder 不再可用
- **AND** 不建立任何 session
