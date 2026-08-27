## ADDED Requirements

### Requirement: agent 目標的 session 環境等同使用者的互動 shell 環境

spawn 目標為 agent CLI 的 session，其行程環境 SHALL 涵蓋使用者**互動** login shell 所建立的環境
—— **不限於 PATH**，包含任何只在互動 rc（`.zshrc`、`.bashrc` 之屬）中設定的變數。

**理由是失效方式。** agent 在 session 內執行的東西（MCP server、工具鏈、其他 CLI）取用環境的方式，
與使用者手動在自己的終端機裡執行它們時**完全相同**。一個「PATH 對、其餘變數皆缺」的環境不會讓它們
拒絕啟動 —— 它們啟動得起來，只是找不到認證、連不上服務、或落到與使用者預期不同的行為，而終端裡
**不會有任何一句話指出環境是缺的**。使用者能觀察到的只有「同一個東西在我的終端機裡好好的，在這裡
就是不行」。

本要求對**環境的內容**設限，對**取得它的機制**不設限 —— 以互動方式 spawn 每一個 pty 能滿足它，
於主行程取得一次再交給 pty 亦然（後者的取得要求見 `desktop-packaging`）。

- 此涵蓋範圍 SHALL NOT 由「僅補強 PATH」的機制滿足。那樣的機制會讓 session 看起來像修好了 ——
  `claude` 找得到、工具跑得起來 —— 而 PATH 以外的每一個變數仍然缺席。
- session 的建立 SHALL 與該環境的取得**對齊時序**：取得尚未完成時，SHALL NOT 以未補強的環境
  建立 pty。取得失敗或放棄時 SHALL 照常建立 session ——一個因為環境查不到而建不出來的 session，
  比一個環境不完整的 session 更糟。
- spawn 目標為 login shell 的 session 亦 SHALL 涵蓋同一份環境。它掛在 pty 上本就是互動 shell、
  本來就讀得到互動 rc，因此本要求對它是**不得倒退**，而非新增能力。
- 應用程式自身承重的環境項目（終端型別、以及標示「隸屬於某個 Claude Code session」的那組變數）
  SHALL 由應用程式決定，SHALL NOT 被使用者環境中的同名項目取代。**其餘一律以使用者的值優先** ——
  那正是「等同使用者的環境」的意思。

**本要求的驗收 SHALL 具備對照組**：同一個受控環境下，未經該機制取得的環境 SHALL 觀察不到只在
互動 rc 設定的變數。少了對照組，一個「環境本來就有那個變數」的驗收環境會讓斷言在機制失效時
依然通過。

#### Scenario: 只在互動 rc 設定的變數於 agent session 內可見

- **WHEN** 使用者的互動 rc（而非 login profile）設定了某個環境變數，並建立一個 spawn 目標為
  agent CLI 的 session
- **THEN** 該 session 的行程環境中可觀察到該變數及其值

#### Scenario: 只由互動 rc 提供的可執行檔路徑可被解析

- **WHEN** 使用者的互動 rc（而非 login profile）將某個目錄加入 PATH，並建立一個 spawn 目標為
  agent CLI 的 session
- **THEN** 該目錄下的可執行檔在該 session 中可被解析

#### Scenario: 對照組——未經該機制的環境觀察不到該變數

- **WHEN** 於同一個受控環境下，取得未經該機制補強的環境
- **THEN** 只在互動 rc 設定的變數不可見 —— 驗收據此確認自己具備鑑別力

#### Scenario: 應用程式承重的項目不被使用者環境取代

- **WHEN** 使用者環境中含有與終端型別、或與「隸屬於某個 Claude Code session」之標示同名的變數
- **THEN** session 的環境中該項目為應用程式所決定的值，而非使用者環境中的值

#### Scenario: 啟動後立即建立的 session 同樣拿到完整環境

- **WHEN** 環境的取得尚未完成時，使用者建立一個 spawn 目標為 agent CLI 的 session
- **THEN** 該 session 的 pty 於取得完成後才建立，其環境涵蓋只在互動 rc 設定的變數

#### Scenario: 環境取得失敗時 session 仍建立得起來

- **WHEN** 環境的取得失敗或被放棄，使用者建立一個 session
- **THEN** 該 session 仍以主行程當下的環境建立，SHALL NOT 因此失敗或被阻擋

#### Scenario: login shell 目標的環境不因本要求而倒退

- **WHEN** 建立一個 spawn 目標為 login shell 的 session
- **THEN** 其環境仍涵蓋互動 rc 所設定的變數

### Requirement: 本要求的涵蓋範圍取決於使用者的 shell 與平台

上一條要求的滿足**取決於使用者的環境能否被安全查詢**。使用者的 shell 不屬於已知可安全查詢者、
或平台為 Windows 時，取得一律放棄（見 `desktop-packaging`），該情形下 agent CLI 目標的涵蓋範圍
**退回 login rc 所提供者** —— 亦即只在互動 rc 設定的變數仍然缺席。

**這是一個已知且未關閉的缺口，SHALL 被記載而非被略過**（追蹤於 issue #31）。一個宣稱自己涵蓋所有情形、實際上只涵蓋
一部分的規格，會讓下一個人在那些情形下把症狀誤判為新的 bug。

#### Scenario: 無法安全查詢的 shell 下涵蓋範圍退回

- **WHEN** 使用者的 shell 不屬於已知可安全查詢者，並建立一個 spawn 目標為 agent CLI 的 session
- **THEN** 該 session 建立成功，其環境涵蓋 login rc 所提供者，只在互動 rc 設定的變數不可見
