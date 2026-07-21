## ADDED Requirements

### Requirement: 偏好包含是否啟用 agent 狀態橋接

偏好 SHALL 包含一個開關，決定是否啟用 agent 的狀態橋接（見 `claude-status-bridge`），
預設為**啟用**。它 SHALL 與既有的終端字型偏好同存於同一份偏好檔、同一個設定對話框。

設定介面 SHALL 說明此開關只影響其後建立或重建的 session。

#### Scenario: 設定對話框提供該開關

- **WHEN** 使用者開啟終端偏好設定
- **THEN** 對話框呈現「啟用 agent 狀態橋接」的開關
- **AND** 其預設為啟用
- **AND** 介面說明它只影響其後建立或重建的 session

#### Scenario: 切換後跨重啟保留

- **WHEN** 使用者關閉該開關並重新啟動應用程式
- **THEN** 該開關仍為關閉
