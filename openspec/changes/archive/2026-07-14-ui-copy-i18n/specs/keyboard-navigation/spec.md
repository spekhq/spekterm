## MODIFIED Requirements

### Requirement: 以鍵盤開啟建立 session 的入口

系統 SHALL 提供快捷鍵 `Ctrl+T`，開啟當前 repo 的**建立 session 入口**（spawn 選單），
其行為 SHALL 與以滑鼠觸發該入口相同 —— 包含選單的錨定位置。

當前沒有選中的 repo 時，`Ctrl+T` SHALL 為無操作，且 SHALL NOT 產生錯誤。

**`Ctrl+T` 在 pty 內是 `transpose-chars`**（zsh 與 bash readline 的預設綁定，實測），
攔截它即從 pty 內的程式手上沒收該鍵。此取捨見 design D8。

其實作為「**找到既有的建立入口並觸發它**」（那正是「錨定位置與滑鼠相同」得以成立的原因），
而該入口以其 `aria-label` 定位 —— **該文案 SHALL 取自字典，SHALL NOT 硬編**（見
`ui-localization` 的「以文案定位介面元素的程式碼自字典取得該文案」）。`aria-label` 在此同時是
選擇器：硬編它，一次文案改動就會**靜默地**廢掉這顆快捷鍵 —— 字串比對不會使型別檢查失敗，
也不會有任何紅燈。

#### Scenario: 以 Ctrl+T 開啟 spawn 選單

- **WHEN** 當前有選中的 repo，使用者按下 `Ctrl+T`
- **THEN** spawn 選單開啟，且其位置與以滑鼠觸發建立入口時相同

#### Scenario: 沒有選中的 repo 時為無操作

- **WHEN** 沒有選中任何 repo，使用者按下 `Ctrl+T`
- **THEN** 不開啟任何選單，且應用程式不產生錯誤

#### Scenario: 定位建立入口的文案取自字典

- **WHEN** 檢視 `Ctrl+T` 用以定位建立入口的 `aria-label` 文案
- **THEN** 該文案取自字典，而非硬編於程式碼

### Requirement: spawn 選單可完全以鍵盤操作

以快捷鍵叫出的選單，SHALL 能完全以鍵盤完成選擇 —— **否則按完仍須摸滑鼠，快捷鍵等於沒做**。

選單開啟時，焦點 SHALL 落在第一個選項。`↓` / `↑` SHALL 於選項之間移動並循環，
`Enter` SHALL 觸發當前選項，`Esc` SHALL 關閉選單。

選單的兩個選項於介面上的標籤為 **Run claude** 與 **Login shell**（UI 的文案為英文，
見 `ui-localization`）。

#### Scenario: 選單開啟時焦點落在第一個選項

- **WHEN** 使用者以 `Ctrl+T` 開啟 spawn 選單
- **THEN** 焦點位於選單的第一個選項

#### Scenario: 以方向鍵於選項間移動並循環

- **WHEN** 焦點位於選單的最後一個選項，使用者按下 `↓`
- **THEN** 焦點移至第一個選項

#### Scenario: 以 Enter 觸發當前選項

- **WHEN** 使用者以方向鍵將焦點移至 **Login shell** 並按下 `Enter`
- **THEN** 建立一個 login shell 的 session，且選單關閉
