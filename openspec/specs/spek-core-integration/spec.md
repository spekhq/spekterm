## Purpose

`spek-workspace` 以合法套件依賴取得已發佈的 `@spekjs/core`，主行程可直接 `import` 並呼叫其掃描 API 取得
OpenSpec 結構，無需 HTTP 或 IPC 中介。這是 PRD §9「重用而非重造」的地基。

## Requirements

### Requirement: 以已發佈的 npm 套件取得 core

`spek-workspace` SHALL 透過已發佈於 npm public registry 的 `@spekjs/core` 套件取得 OpenSpec 解析能力。版控中的依賴宣告 SHALL NOT 使用 `file:`、`link:`、`portal:` 或其他指向本機路徑的協定 —— 這類宣告會讓 CI 與 `electron-builder` 打包看到與開發者機器不同的依賴。

#### Scenario: 依賴宣告為已發佈的版本

- **WHEN** 檢查版控中的 `package.json` 依賴
- **THEN** `@spekjs/core` 以語意化版本宣告，且不含 `file:`、`link:`、`portal:` 等本機協定

#### Scenario: 乾淨環境可解析套件

- **WHEN** 在未經 `npm link` 的乾淨環境執行安裝
- **THEN** `@spekjs/core` 自 npm registry 解析並安裝成功

### Requirement: 主行程直接 import core 並掃描 OpenSpec 結構

Electron 主行程 SHALL 能直接 `import` `@spekjs/core` 並呼叫其掃描 API，取得目標 repo 的 OpenSpec 結構。此要求驗證 PRD §8.1 的核心論證：core 是純 Node.js 模組，主行程可直接使用。

#### Scenario: 掃描含 openspec 目錄的 repo

- **WHEN** 主行程對一個含 `openspec/` 目錄的 repo 路徑呼叫 `scanOpenSpec()`
- **THEN** 回傳的物件包含 `specs`、`activeChanges`、`archivedChanges` 與 `defaultSchema` 欄位，且 `defaultSchema` 等於該 repo `openspec/config.yaml` 所宣告的 schema

#### Scenario: 掃描不含 openspec 目錄的路徑

- **WHEN** 主行程對一個不含 `openspec/` 目錄的路徑呼叫 `scanOpenSpec()`
- **THEN** 回傳空的結構，而非拋出例外

### Requirement: 掃描不經 HTTP 或 IPC 中介

core 的掃描 SHALL 在 Electron 主行程內以行程內函式呼叫完成。應用程式 SHALL NOT 為了取得掃描結果而啟動 HTTP server，亦 SHALL NOT 將掃描委派給常駐的外部服務行程。

註：core 內部會 spawn 一次 `git log` 取得 change 的時間戳，其輸出於行程內解析。那是短命的子行程，不是中介服務，也不監聽任何埠。

#### Scenario: 掃描期間未開啟網路埠

- **WHEN** 主行程執行一次掃描
- **THEN** 應用程式未為此監聽任何 TCP 埠，掃描結果直接來自函式呼叫的回傳值

### Requirement: 掃描結果於開發模式可觀察

開發模式下，主行程 SHALL 輸出目標 repo 的掃描摘要，作為本 change 對 core 整合的可見驗收依據。

#### Scenario: 開發模式輸出掃描摘要

- **WHEN** 以開發模式啟動應用程式並指定一個含 `openspec/` 的 repo 路徑
- **THEN** 主行程輸出該 repo 的掃描摘要，內容至少包含 spec 數量、active change 數量與 `defaultSchema`
