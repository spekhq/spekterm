## ADDED Requirements

### Requirement: side panel 的預設身分為 OpenSpec

選中的 folder 其 OpenSpec 身分為可用狀態時，side panel 的預設身分 SHALL 為 **OpenSpec**。
OpenSpec 身分為停用狀態時（該 folder 不含 `openspec/`），預設身分 SHALL 為 Files。

這是 `docs/workspace-mockup.html` 的預設（`#content-openspec` 為初始顯示的內容）。此前實作暫以 Files 為
預設，理由是 OpenSpec 身分尚無內容可顯示 —— 該理由已不復存在。

**OpenSpec 是這個工作台的主張**：使用者加入一個有 `openspec/` 的 repo，預期看到的是它的 spec 與 change，
而不是一棵他在 IDE 裡已經看膩的檔案樹。

#### Scenario: 選中含 openspec 的 folder

- **WHEN** 使用者選中一個含有 `openspec/` 的 folder，且尚未手動切換過身分
- **THEN** side panel 呈現 OpenSpec 身分的內容

#### Scenario: 選中不含 openspec 的 folder

- **WHEN** 使用者選中一個不含 `openspec/` 的 folder
- **THEN** side panel 呈現 Files 身分的內容
