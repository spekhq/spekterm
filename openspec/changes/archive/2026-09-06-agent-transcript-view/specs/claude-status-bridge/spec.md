## ADDED Requirements

### Requirement: 經同一注入接縫的多個功能彼此獨立且合成

不只一個功能經由同一個 CLI 旗標接縫向 agent 注入設定時，系統 SHALL 把它們**合成為單一份設定**
一次注入，SHALL NOT 各自注入而使後者取代前者。

各功能的**啟用狀態 SHALL 彼此獨立**：關閉其中一個 SHALL NOT 使另一個失效，其中一個因故不注入
（例如無法與使用者原有的設定並存）SHALL NOT 使另一個一併不注入。

**理由**：接縫只有一個，而合成的結果只有一份 —— 一個「各自寫一次」的實作，其失效是後寫的把
先寫的蓋掉，而**兩個功能都會回報自己已啟用**。症狀是其中一個安靜地失去作用，沒有任何錯誤。

#### Scenario: 兩個功能同時啟用時皆生效

- **WHEN** 狀態橋接與事件橋接皆為啟用，使用者建立一個 agent session
- **THEN** 該 session 的狀態 payload 被寫出
- **AND** 該 session 的事件亦被寫出

#### Scenario: 關閉其中一個不影響另一個

- **WHEN** 使用者關閉狀態橋接、保持事件橋接啟用，並建立一個 agent session
- **THEN** 不產生狀態 payload
- **AND** 該 session 的事件照常被寫出

#### Scenario: 其中一個因故不注入時另一個仍注入

- **WHEN** 事件橋接因無法與使用者原有的設定並存而不注入，且狀態橋接可正常注入
- **THEN** 該 session 的狀態 payload 照常被寫出
