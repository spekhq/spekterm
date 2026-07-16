## ADDED Requirements

### Requirement: 應用程式視窗不呈現原生 menu bar

應用程式視窗 SHALL NOT 呈現原生的 menu bar，使用者按 `Alt` SHALL NOT 浮出任何 menu。這個 app
不定義任何 menu 內容 —— 一條空的 menu bar 只會擋住畫面、讓使用者以為漏看了什麼。

此要求為**移除** menu，而非僅隱藏：`autoHideMenuBar`（平時隱藏、按 `Alt` 浮出）不滿足它，
主行程 SHALL 移除整個 menu（`Menu.setApplicationMenu(null)` 或等效）。

#### Scenario: 按 Alt 不叫出任何 menu

- **WHEN** 應用程式視窗開啟，使用者按下 `Alt`
- **THEN** 不出現任何 menu bar
