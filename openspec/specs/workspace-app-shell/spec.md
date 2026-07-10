## Purpose

Electron app 的最小外殼 —— 主行程開啟視窗、renderer 載入 React 應用、主行程與 renderer 依 PRD §12 信任模型
隔離（`contextIsolation`、preload 白名單）。編輯器套件只能經由單一 wrapper 模組取用，
以確保日後替換編輯器的成本侷限於該模組。其上的所有 UI 都長在這個外殼上。

## Requirements

### Requirement: 主行程開啟應用程式視窗

Electron 主行程 SHALL 在應用程式就緒後建立 `BrowserWindow` 並載入 renderer 入口。

#### Scenario: 啟動應用程式

- **WHEN** 執行開發模式啟動指令，或啟動正式建置後的應用程式
- **THEN** 開啟一個應用程式視窗，視窗成功載入 renderer 入口，且主行程未拋出未捕捉的例外

### Requirement: Renderer 載入 React 應用

renderer SHALL 以 React 19 掛載根元件，且 Tailwind CSS v4 的樣式 SHALL 生效。

#### Scenario: React 根元件掛載

- **WHEN** 視窗完成載入
- **THEN** DOM 中存在 React 掛載的根節點，且畫面呈現可辨識的骨架內容

#### Scenario: Tailwind 樣式生效

- **WHEN** 根元件套用一個 Tailwind utility class
- **THEN** 該元素的 computed style 反映對應樣式，證明 Tailwind v4 已納入 renderer 建置

### Requirement: 主行程與 renderer 依信任模型隔離

`BrowserWindow` SHALL 啟用 `contextIsolation` 並停用 `nodeIntegration`。renderer SHALL NOT 能直接存取 Node.js API。此要求對應 PRD §12 的安全與信任模型。

#### Scenario: webPreferences 設定正確

- **WHEN** 檢查建立視窗時傳入的 `webPreferences`
- **THEN** `contextIsolation` 為 `true`，且 `nodeIntegration` 為 `false`

#### Scenario: renderer 無法存取 Node API

- **WHEN** 於 renderer 求值 `typeof require`
- **THEN** 其值為 `undefined`，renderer 無法直接取用 Node.js 模組系統

### Requirement: 能力僅經由 preload 白名單暴露

主行程能力 SHALL 僅透過 preload 以 `contextBridge` 暴露的具名 API 提供給 renderer。未列於白名單的能力 SHALL NOT 可從 renderer 取得。

#### Scenario: 白名單 API 可用

- **WHEN** renderer 呼叫 preload 經 `contextBridge` 暴露的具名 API
- **THEN** 該 API 可被呼叫並回傳預期結果

#### Scenario: 非白名單能力不可得

- **WHEN** renderer 嘗試存取一個未經 `contextBridge` 暴露的主行程能力
- **THEN** 該能力不存在於 renderer 的全域範圍

### Requirement: 編輯器透過 wrapper 介面存取

編輯器 SHALL 被封裝在單一 wrapper 模組之後。renderer 的其他模組 SHALL NOT 直接 import 編輯器套件，以確保退守替代編輯器時的改動侷限於單一模組。

#### Scenario: 只有 wrapper 直接依賴編輯器套件

- **WHEN** 搜尋 renderer 原始碼中對 `monaco-editor` 的 import 陳述
- **THEN** 僅 wrapper 模組出現該 import，其餘模組一律透過 wrapper 介面取用編輯器
