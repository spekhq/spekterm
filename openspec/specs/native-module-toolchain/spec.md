## Purpose

native 模組能在 Electron runtime 直接載入並運作，無需針對 Electron ABI 重建。以 `node-pty` 為首個案例 ——
它是 Node-API 模組，prebuilt 的 `.node` 可同時被 Node 與 Electron 載入。此能力同時要求所選版本的 prebuilt
涵蓋全部目標平台，並在 Electron 或 native 模組升版時可重新驗證。

## Requirements

### Requirement: node-pty 以預編譯 binary 安裝

`node-pty` SHALL 以其發佈的預編譯 binary 安裝。安裝過程 SHALL NOT 觸發本地原生編譯 —— 依賴本地編譯會要求每位貢獻者與每個 CI runner 具備 Python 3.8+ 與 C++ toolchain，而 Linux 正是 PRD §3.1 要優先支援的平台之一。

#### Scenario: 缺少 C++ 編譯環境仍可安裝

- **WHEN** 在缺少 Python 3.8+ 或 C++ toolchain 的環境執行安裝
- **THEN** 安裝成功完成，且 `node_modules/node-pty` 之下不存在 `build/` 目錄

#### Scenario: 安裝未呼叫 node-gyp

- **WHEN** 觀察安裝過程的輸出
- **THEN** 未出現 `node-gyp rebuild` 的編譯訊息

### Requirement: node-pty 版本釘死且 prebuilds 涵蓋全部目標平台

`node-pty` SHALL 以精確版本宣告（不使用 `^`、`~` 或其他範圍運算子），且所選版本的 `prebuilds/` SHALL 涵蓋 PRD §3.3 所列的全部目標平台。npm 的 `latest` 標籤未必滿足此條件，版本選擇 SHALL 以實際的 prebuild 覆蓋為準。

#### Scenario: 依賴為精確版本

- **WHEN** 檢查 `package.json` 中 `node-pty` 的版本字串
- **THEN** 該字串不含 `^`、`~` 或其他範圍運算子

#### Scenario: prebuilds 覆蓋所有目標平台

- **WHEN** 檢查已安裝的 `node-pty` 的 `prebuilds/` 目錄
- **THEN** 同時存在 `darwin-arm64`、`darwin-x64`、`win32-x64`、`win32-arm64`、`linux-x64`、`linux-arm64` 六個平台的目錄

### Requirement: native 模組在 Electron runtime 直接載入

native 模組 SHALL 能在 Electron runtime 直接載入，無需針對 Electron 的 ABI 重新建置。專案 SHALL NOT 依賴 `@electron/rebuild` 或任何等效的重建步驟。此要求成立的前提是模組以 Node-API 實作 —— Node-API 的 ABI 跨 Node.js 與 Electron 穩定，即使兩者的 `process.versions.modules` 不同。

#### Scenario: Electron 主行程載入 node-pty

- **WHEN** Electron 主行程 `require('node-pty')`
- **THEN** 模組載入成功，且未拋出 ABI 不相容的錯誤

#### Scenario: 模組為 Node-API 實作

- **WHEN** 檢視所載入的 `pty.node` 的匯入符號
- **THEN** 其引用 `napi_*` 符號，且不引用任何 `v8::` 符號

#### Scenario: 專案不含 native 模組重建步驟

- **WHEN** 檢查 `package.json` 的依賴與 scripts
- **THEN** 不存在 `@electron/rebuild` 依賴，也不存在用於重建 native 模組的 postinstall 步驟

### Requirement: 在 Electron 主行程 spawn 出真實 pty

Electron 主行程 SHALL 能透過 `node-pty` spawn 一個 shell 行程，並雙向讀寫其終端輸出。取得的 SHALL 是真正的偽終端，而非一般的行程管線 —— 後者無法承載 PRD §8.3 規劃的互動式 agent session。

#### Scenario: spawn shell 並取得輸出

- **WHEN** 主行程 spawn 一個 shell 並執行會產生輸出的指令
- **THEN** 透過資料事件收到該指令的輸出，且行程結束時回報 exit code 為 0

#### Scenario: 取得的是偽終端而非管線

- **WHEN** 於 Unix 類平台 spawn shell 並執行 `tty`
- **THEN** 其輸出指向一個偽終端裝置（形如 `/dev/pts/*`），而非回報該行程未連接終端

### Requirement: 相依升級後可重新驗證載入相容性

專案 SHALL 提供可重複執行的驗證程序，用以在 Electron 或 native 模組升版後確認載入相容性。Electron 升版會改變其 Node.js 版本與 ABI 編號，而 Node-API 的相容性保證繫於 N-API 版本而非 ABI 編號，故此檢查 SHALL 可被重新執行。

#### Scenario: 執行驗證程序

- **WHEN** 執行該驗證程序
- **THEN** 輸出當前 Electron 與 Node.js 的 ABI 編號與 N-API 版本，並報告 native 模組是否成功載入且能 spawn 出 pty
