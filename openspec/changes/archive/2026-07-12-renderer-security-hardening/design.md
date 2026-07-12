## Context

一次資安掃描發現三道位於既有邊界之上的縱深防禦缺口（見 `proposal.md`）。三者互相獨立，但
共用一個主題：**面對不受信任的內容（repo 裡的 markdown、pty 的輸出）與不受信任的 renderer，
補上既有硬化未收攏的邊角**。

當前狀態：

- renderer **完全沒有 CSP**（`out/renderer/index.html` 與 src 皆無 meta、主行程無 `onHeadersReceived`）。
- `src/main/ipc/clipboard.ts` 的 `writeText` 是 fire-and-forget 的 `ipcMain.on`、無 try/catch。
- `src/renderer/src/shell/terminal/xterm.ts` 的 `new Terminal({...})` 未設 `linkHandler`。

約束（沿用全 repo）：繁體中文註解、程式碼英文；驗收走 `scripts/probe-*.mjs`（CDP 連真 app）與
`npm test`，**不在產品程式碼塞測試分支、不為驗收掛 `data-*`**；dev 與 build 兩模式都要能驗。

## Goals / Non-Goals

**Goals:**

- renderer 套用一份由**主行程強制**的 CSP，消滅不受信任 markdown 觸發的外部資源請求（首要是
  遠端圖片 beacon），並為任何未來的 XSS 立足點提供第二層防線。
- `clipboard:writeText` 對 renderer 傳來的非字串輸入防禦，不使主行程產生未捕捉例外。
- 終端的 OSC 8 超連結與純文字連結走**同一條** `openExternal` 受控接縫，不落入 xterm 內建的
  `confirm()` + `window.open()` 預設處理器。

**Non-Goals:**

- **不開 renderer sandbox**（`sandbox: true`）—— 它牽涉把 preload 從 ESM 改成 CJS 打包，屬 Phase 6
  打包工作，本 change 不動。
- **不做全面的 IPC 輸入驗證框架。** 掃描確認只有 `clipboard:writeText` 這一個 `.on` 入口會因
  畸形輸入而使主行程崩潰；`terminal.*` 的 `write`／`resize`／`kill` 已在 `TerminalService` 內以
  try/catch 與數值夾制防禦，`app:setDirtyState` 僅存入不拋。本 change 只補會崩潰的那一個。
- **不改 markdown 渲染器**（react-markdown 的預設安全值已擋 `<script>` 與 `javascript:`）。CSP 是
  它的**縱深防禦**，不是取代它。
- 不引入 CSP 違規回報端點（`report-uri`／`report-to`）。

## Decisions

### D1：CSP 由**主行程 `onHeadersReceived`** 注入，依「是否載入 dev server」分 dev／build 兩份政策

**選擇主行程 header，而非 `index.html` 的 `<meta>`。** 兩個理由：

1. **與本 repo 的信任哲學一致。** 全 repo 的邊界檢查一律在主行程執行（「preload 與 renderer 同屬
   一個行程樹，在那裡檢查等同沒有檢查」）。CSP 若寫在 renderer 自己載入的 `<meta>` 裡，是 renderer
   宣告自己的約束；寫在主行程的 response header 裡，是**信任邊界正確的一側**強制施加的。

2. **dev 與 build 需要不同政策，`<meta>` 分不了。** electron-vite 的 dev 模式由 Vite dev server
   提供 renderer，其 HMR 需要 `connect-src` 放行 websocket，React Fast Refresh 會注入 **inline
   module script**（`script-src` 需放寬）；build 模式是 `file://` 靜態載入，可以收到最緊。單一份
   `<meta>` 對兩模式相同，會被迫放寬到 dev 的程度。`onHeadersReceived` 可依「是否載入 Vite dev
   server」（`ELECTRON_RENDERER_URL` 的存在）給兩份。

**實測依據（`file://` 上 `onHeadersReceived` 是否生效，這是本決策的前提）：** 以獨立 Electron
主行程對 `loadFile` 的頁面注入 `default-src 'self'; script-src 'self'; img-src 'self'; style-src
'self' 'unsafe-inline'`，量到：

```
{ violations: ["img-src"], imgBlocked: true,        ← 該政策確實在攔（證明注入點生效）
  inlineStyleWorks: true,                            ← <style> inline 仍生效
  externalSelfScriptRan: true, inlineRan: false }    ← same-origin .js 放行、inline <script> 被擋
```

（此實測用了 `img-src 'self'`，只是為了證明**注入點對 `file://` 生效**；最終政策放行遠端 https
圖片，見 D2。）`onHeadersReceived` 對 `file://` response **確實觸發且 CSP 生效** —— build 模式不
需要退回 `<meta>`。

**切換依「是否載入 dev server」，不是 `app.isPackaged`。** 實作時實測發現：probe 的建置模式是
未打包的 `electron .` 載入 `file://` 產物，`isPackaged` 仍為 `false` → 若以它為準會誤發 dev 政策，
且使 **production 政策永無 probe 覆蓋**（一個假綠）。改以 `ELECTRON_RENDERER_URL` 的存在為準，
`file://` 一律拿 production 政策，probe 的建置模式驗的就是它。

**退路：** 若日後某 Electron 版本改變 `file://` 的 webRequest 行為使 header 注入失效，退回 build
模式用 `<meta>`（政策內容相同，只是施加點不同）。此退路已由上述實測涵蓋其可行性邊界。

### D2：CSP 政策骨架 —— build 收到最緊，dev 僅放行 Vite 所需

**Production（非 dev server，即 `file://`）目標政策：**

```
default-src 'self';
script-src 'self';
style-src 'self' 'unsafe-inline';
img-src 'self' data: https:;
font-src 'self' data:;
worker-src 'self' blob:;
connect-src 'self';
object-src 'none';
base-uri 'none';
frame-src 'none'
```

各 directive 的理由：

- `script-src 'self'`：app 的所有 script 都是打包後的 same-origin `.js`（已確認建置產物**無 `eval`／
  `new Function`**，故不需要 `'unsafe-eval'`）。inline script 被擋正是我們要的。
- `style-src 'self' 'unsafe-inline'`：**Monaco、xterm、Tailwind v4 都在執行期注入 inline `<style>`**。
  這是無法避免的 `'unsafe-inline'`（style 的 inline 不像 script 那樣可被武器化為任意程式執行）。
- `img-src 'self' data: https:`：**放行遠端 https 圖片**。遠端圖片是 markdown 的正常內容（README
  徽章、架構圖、螢幕截圖）—— 擋掉它能防的只是一個**低嚴重度**的追蹤 beacon（洩漏「開了這個檔」＋
  IP，無程式執行、無憑證竊取、無邊界逸出），而使用者本就對其 workspace folder 做過信任決定、還在
  裡面跑 agent 與 shell。這筆帳擋圖片划不來，故放行。**不放行 `http:`**：近乎所有真實圖片都是
  https，而擋 `http:` 同時擋掉惡意 markdown 對 `http://localhost` 的 image-GET 探測（窄面的
  CSRF-via-image）。`data:` 放行 app 內嵌的小圖示。
- `worker-src 'self' blob:`：Monaco 的 `editor.worker` 經 Vite 打包為 same-origin module worker
  （`new Worker(new URL(...))`）；建置產物另有一處 `createObjectURL` 的 blob worker fallback，故
  併放 `blob:`（blob worker 只能源於自身，不構成外洩）。
- `connect-src 'self'`：production 不需要任何外連。
- `object-src 'none'`、`base-uri 'none'`、`frame-src 'none'`：關掉 `<object>`／`<embed>`、`<base>`
  劫持、以及任何 iframe。

**Dev（載入 dev server）放寬項：** `script-src` 加 `'unsafe-inline'`（React Fast Refresh 的 inline
preamble）、`connect-src` 加 dev server 的 `ws:`／`http:`（Vite HMR）。dev 是開發者自己的機器、
威脅面低，此放寬只為讓 `npm run dev` 與 dev 模式的 probe 能跑。

**待實作 probe 收斂（Open Questions 有列）：** 精確的 dev 放寬字串、以及 `worker-src` 是否真需要
`blob:`，由實作時的 `probe:files`（Monaco worker 往返）與 dev 啟動實測定案。本 change 的架構決策
（注入點、分政策、directive 集合）已由上述實測支撐；剩下的是字串微調，不是架構問題。

### D3：`clipboard:writeText` 加型別 guard，畸形輸入靜默丟棄

```ts
ipcMain.on(CLIPBOARD_CHANNELS.writeText, (_event, text: string) => {
  if (typeof text !== 'string') return   // ← 新增
  clipboard.writeText(text)
})
```

- **為什麼是靜默 return，而非拋錯或回報：** preload 端是 `ipcRenderer.send`（單向 fire-and-forget），
  主行程沒有回應通道可以告知 renderer。畸形輸入唯一合理的處置就是丟棄。
- **為什麼 guard 在主行程，而非 preload：** preload 的 `text: string` 只是 TypeScript 的編譯期
  標註，擋不住執行期傳入任意型別的被入侵／有 bug 的 renderer。與 fs 邊界同哲學 —— 真正的防護在
  主行程這一側。
- **實測依據：** 以真實 Electron 行程確認 `clipboard.writeText({...})` 拋 `TypeError`，且在
  `ipcMain.on` handler 內無 try/catch 時成為主行程的未捕捉例外。加上 guard 後該路徑不再可達。

**替代方案（否決）：** 改用 `ipcMain.handle`（有回應通道）→ 過度，且需連帶改 preload 的 `send`
為 `invoke`，為一個「丟棄畸形輸入」的動作引入不必要的往返。

### D4：xterm `Terminal` 設 `linkHandler`，OSC 8 導向既有 `openLink` 接縫

```ts
const term = new Terminal({
  ...,
  linkHandler: {
    activate: (_event, uri) => openLink(uri),   // 與 WebLinksAddon 同一條出口
  },
})
```

- xterm 有**兩套**連結機制：`WebLinksAddon`（regex 偵測**純文字** URL，本 app 已覆寫其 handler）
  與核心的 `OscLinkProvider`（處理 **OSC 8** escape-sequence 超連結，走 `Terminal.linkHandler`）。
  目前只覆寫了前者，後者落入 xterm 內建預設：`confirm()`（URL 文字由不受信任的 pty 輸出控制）
  + `window.open()`。設 `linkHandler.activate` 導向既有的 `openLink`，兩套連結就走**同一條**
  `openExternal`（主行程驗協定，僅放行 http／https）。
- **不設 `allowNonHttpProtocols`**（預設 `false`）：非 http／https 的 OSC 8 URI 根本不會被
  `OscLinkProvider` 建成可點連結。加上 `activate` 導向 `openExternal`（再驗一次協定），構成雙重
  保險。
- `openLink` 是 `createXterm` 既有的注入點（wrapper 不認得 `workspace.*`，信任決策在接縫之外）——
  本決策不動這道分層，只是把 OSC 8 也接上它。

## Risks / Trade-offs

- **[CSP 太緊會弄壞 Monaco worker 或終端]** → 已以實測拆解主要未知：`onHeadersReceived` 對
  `file://` 生效、`style-src 'unsafe-inline'` 保住 inline style、無 `eval` 故不需 `'unsafe-eval'`。
  `worker-src` 已預留 `blob:`。剩餘風險（Monaco worker 在最終政策下的往返）由 `probe:files` 的既有
  「detected-link 往返」驗收把關 —— 若政策擋掉 worker，那條驗收會紅。
- **[`style-src 'unsafe-inline'` 是一個放寬]** → 無法避免（三個 UI 套件都注入 inline style），且
  style 的 inline 不可被武器化為程式執行。script 維持 `'self'`（production 無 `'unsafe-inline'`），
  真正的注入面守住。
- **[dev 政策較寬，可能與 production 行為分叉]** → 接受。dev 的放寬僅限 Vite HMR 所需（inline
  script + ws），且威脅面是開發者自己的機器。probe 兩模式都跑，行為分叉會被抓到。
- **[OSC 8：設了 `linkHandler` 是否影響純文字連結]** → 不影響。`WebLinksAddon` 有自己的 handler，
  兩套並存、各走各的偵測，最終都匯到 `openLink`。`probe:terminal` 對兩種連結各驗一次。

## Migration Plan

三項皆為疊加式硬化，無資料遷移、無 breaking change。部署即生效；rollback 為還原三處改動之一或
全部，彼此獨立（CSP、clipboard guard、linkHandler 互不相依）。

## Open Questions

- Dev 模式 CSP 的精確放寬字串（`script-src` 要不要 `'unsafe-inline'` 之外的項、`connect-src` 的
  dev server 來源如何取得）—— 由實作時 `npm run dev` 與 dev 模式 probe 收斂。
- `worker-src` 最終是否真的需要 `blob:`，或 `'self'` 已足夠 —— 由 `probe:files` 的 Monaco worker
  往返驗收定案（預留 `blob:` 是保守側）。
