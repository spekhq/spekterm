## Why

讀後感的委派把**使用者 login shell 的整份環境**交給 `claude -p`
（`ipc/insights.ts` 的 `env: { ...process.env, ...userEnv, PATH }`），而 `user-env.ts` 的檔頭
自己寫著那份環境持有「API 憑證、服務端點」。官方文件的認證優先序寫得很明白：

> 3. `ANTHROPIC_API_KEY` environment variable. ... In interactive mode, you are prompted once to
>    approve or decline the key, and your choice is remembered. **In non-interactive mode (`-p`),
>    the key is always used when present.**
> 7. Subscription OAuth credentials from `/login`. This is the default for Claude Pro, Max, Team,
>    and Enterprise users.

也就是說：pty 裡的互動式 `claude` 會問使用者一次，**而我們的委派不會**。使用者訂閱制的 session
在同一台機器上、由同一個 app 發動，卻可能改走 API 計費 —— 而且**沒有任何地方看得出來**：
`--output-format json` 的 `total_cost_usd` 是 client-side 估算，不指出這筆走訂閱還是 API。

社群已有實災（皆為 open issue）：anthropics/claude-code #91777（專案 `.env.local` 裡一把給
別的服務用的 key 被吃掉 14 次、US$42.95）、#81748、#86723（兩個月 US$1,122.83）。

**本機目前 `ANTHROPIC_*` 一個都沒設定**（已實測），所以至今每一趟都走訂閱。但那是「碰巧沒設」，
不是「結構上不會發生」—— 正是 CLAUDE.md 那條「『不接受某個東西』要由結構保證，不是由『沒有人
再送它』保證」的形狀。一個 `.zshrc` 裡多一行，或換一台機器，缺陷就兌現。

**同一份環境還帶著兩樣東西**：

- **`CLAUDE_CODE_*` 那一族巢狀標記**（自一個 Claude Code session 之內啟動 spekterm 時，
  `process.env` 實測有 11 個）。`terminal.ts` 為 pty 剝除它們，**委派這條路一個都沒剝**，
  其中兩個是通往**父 session** 的通訊管道。**而那正是 dogfood 的路徑。**
- **端點設定**（`ANTHROPIC_BASE_URL` 之屬）會把請求整個導向別的主機 —— 而委派送出去的是
  使用者的**對話語料**（上限 600,000 字元）。

## What Changes

- 委派行程的環境**不再是使用者 shell 環境的複本**，改為一份明確界定的白名單。
  結構上不含任何選擇憑證、計費歸屬的變數 —— **包含今天還不存在的名字**。
  使用者自身訂閱登入的長期 token（`CLAUDE_CODE_OAUTH_TOKEN`）**在白名單上**：
  它維持而非改變計費歸屬。
- **Claude Code 設定目錄只在使用者明確指定時才傳遞**，且與刪除委派紀錄所用的位置
  來自**同一次解析**。實測：合成一個預設值傳進去**不是 no-op**，它會讓 `claude`
  找不到既有設定並就地建立一份空的（詳見 design D3）。
- **委派留下的語料副本不分成敗都刪除**，且以委派專案目錄為單位而非依賴該趟識別碼。
  現行實作在失敗路徑上早退，而失敗的那一趟照樣寫了紀錄 —— 那份 60 萬字元的副本活 30 天，
  沒有任何程式碼會去刪。這個 change 刻意提高了失敗率，因此躲不掉它。
- **兩處文案**：授權畫面說明委派以什麼身分執行；委派失敗的訊息不再只指向「尚未登入」。
- 建構環境的邏輯自 `ipc/insights.ts`（import electron，單元測試載入不起來）抽為
  `report-runner.ts` 的**純函式**，比照 `delegateArgs` 既有的處置 —— 沒有這一步，
  這條規格就沒有驗收載體。
- **不改 pty 的環境。** 互動式 `claude` 會就 API key 問使用者一次，那個提問就是同意。
  （pty 那條路的 `NESTED_CLAUDE_ENV` 涵蓋不全是另一個缺口，開 issue。）

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `conversation-report`：
  - **新增兩條** requirement —— 委派環境的白名單、設定目錄的傳遞與同源。既有的
    「委派在專屬的空目錄下執行，且不使用任何工具」只約束了 cwd 與工具，對環境沉默，
    而環境正是憑證的來源。
  - **修改三條** —— 「委派在專屬的空目錄下執行」（把環境納入約束範圍）、
    「委派留下的對話紀錄於結束後刪除」（涵蓋失敗路徑）、
    「送出前須取得逐次授權」（身分說明與失敗訊息）。

## Impact

- `src/main/report-runner.ts` —— 新增 `delegateEnv` 純函式。
- `src/main/report.ts` —— 單次解析、刪除改為目錄單位且涵蓋失敗路徑、`ReportDeps` 的
  `spawn` 簽名與新的 `maxChars` 旋鈕。
- `src/main/insights-source.ts` —— 新增 `explicitConfigDir`。
- `src/main/ipc/insights.ts`、`src/main/index.ts` —— 接線與 docstring 更正。
- `src/main/report.test.ts` —— 新的驗收載體與三組對照組。
- `src/shared/i18n/en.json`、`src/renderer/src/shell/insights/ReportTab.tsx` —— 兩處文案。
- `scripts/probe-insights.mjs` —— 授權畫面的新斷言。
- **不動**：`user-env.ts`（那份環境本身沒有問題，問題在誰消費它）、
  `terminal.ts` 的 `ptyEnv`、掃描行程（`utilityProcess.fork`，不做模型請求）。
- 文件：`docs/lessons/transcript.md`、CLAUDE.md 的踩雷指南觸發器。

**已知並接受的取捨**：憑證只從環境變數來的使用者（Bedrock / Vertex / Foundry、
`ANTHROPIC_AUTH_TOKEN` 走 gateway、或以 API key 為唯一憑證）會拿不到憑證，讀後感將以既有的
失敗碼失敗。**那是刻意選擇的方向** —— 一個看得見的失敗，好過一筆沒有人同意過的帳單。
緩解是上述兩處文案，以及「失敗不再留下語料副本」。
