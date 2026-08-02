## ADDED Requirements

### Requirement: 側欄來源未選定時 OpenSpec 身分呈現可行動的空狀態

側欄座標的來源 repo **尚未選定**時，OpenSpec 身分 SHALL 呈現空狀態並說明可選擇一個 repo 來檢視。
此狀態自 `global-session` 起存在 —— 全域項目沒有自身 repo 可作為預設來源。

空狀態 SHALL NOT 只是一塊沉默的空白 —— 使用者無從分辨那是刻意的狀態、是還沒載入完，還是壞了。
它 SHALL 指向來源指示器，使「怎樣才會有內容」這個問題在原地就有答案。

此狀態 SHALL 與「來源已選定但該 repo 不含 `openspec/`」相區別：後者是該 repo 的性質 —— 依
`workspace-layout`，那時 OpenSpec **身分本身**為停用並退回 Files；而前者是尚未作出的選擇 ——
身分為可用，面板呈現本條所述的空狀態。**兩者的差別在身分入口的狀態，不只在面板的內容。**

#### Scenario: 全域項目預設呈現空狀態

- **WHEN** 使用者選中全域項目而尚未選擇側欄來源，且 side panel 為 OpenSpec 身分
- **THEN** 面板呈現空狀態，並說明可選擇一個 repo 來檢視

#### Scenario: 選擇來源後即呈現該 repo 的內容

- **WHEN** 使用者於來源指示器為全域項目選擇一個含 `openspec/` 的 repo
- **THEN** 面板呈現該 repo 的 OpenSpec 內容

#### Scenario: 與「來源不含 openspec」的狀態相區別

- **WHEN** 使用者為全域項目選擇一個不含 `openspec/` 的 repo
- **THEN** OpenSpec 身分的入口轉為停用、side panel 退回 Files 身分
- **AND** 不呈現「尚未選擇來源」的空狀態 —— 選擇已經作出了
