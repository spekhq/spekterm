## Context

約 150 個使用者可見的字串硬編在四個地方：renderer 的 JSX／`aria-label`／`title`、主行程的
`dialog.showMessageBox`、主行程經 IPC 送到畫面上的錯誤 message，以及寫進 pty 串流的一行分隔線。
它們是繁體中文，而 app 的其餘部分（`Handoffs`、`claude`、`shell`、`OpenSpec`、`Files`、`Graph`、
`Timeline`）是英文。

三個約束左右了這份設計：

1. **`aria-label` 在這個 repo 裡同時是選擇器。** `scripts/probe-*.mjs` 不得為驗收在產品 UI 上
   掛 `data-*`（CLAUDE.md 的既有紀律），於是它們只能靠 `role` 與 `aria-label` 定位元素 ——
   6 支 probe 共 **62 處**。而 `KeyboardNavigation.tsx` 以
   `document.querySelector('[aria-label="新增 session"]')` 觸發 `Ctrl+T`。**後者是字串比對：
   改了文案不會編譯錯，`Ctrl+T` 直接失效，沒有任何徵兆。**
2. **文案跨行程。** main 與 renderer 是兩個 JS realm，但它們的文案是同一個產品的文案。
3. **repo 的既有慣例是「程式碼英文、註解與文件繁中」。** 這條不動 —— 本 change 動的是**字串**，
   不是註解。

## Goals / Non-Goals

**Goals:**

- 使用者可見的文案**全部為英文**，且**不再硬編於程式碼**。
- 文案有一個**單一的住所**（字典），main 與 renderer 共用同一份。
- 一道**守衛**，讓下一個 change 的作者寫不出中文 UI 字串 —— 沒有它，這個 change 會被慢慢磨掉。
- **結構性地**消滅「文案改了、selector 沒跟上」這個靜默失效（不是靠寫進文件叫人記得）。

**Non-Goals:**

- **不做第二份字典**（沒有 zh-Hant，沒有任何其他語言）。
- **不做語言切換 UI** —— 設定面板尚未實作（ActivityBar 的「設定」是 disabled 的佔位），
  做了也沒有入口。
- **不做語言包的 lazy load**（只有一個語言，沒有東西可以延遲）。
- **不改註解、`docs/`、`openspec/`**，也不改 probe 腳本自己的 log 輸出（那是開發工具，不是 app）。
- **不做文案的逐字翻譯。** 直譯會產出彆扭的英文（「以 + session 開一個終端」→
  "Open a terminal with + session"）。文案是**重寫**的，以英文的慣用說法為準。

## Decisions

### D1 — i18next + react-i18next；而 key 的型別安全並沒有因此失去

使用者裁決採用 i18next（26.3.6）+ react-i18next（17.0.9），而非自寫的 `t()`。

**附帶結論（值得寫下來，因為它推翻了選型當下的假設）**：「JSON 字典 ⇒ key 沒有型別安全」是**錯的**。
`tsconfig.json` 早已開啟 `resolveJsonModule`，於是 `import en from './en.json'` 的型別就是那份
JSON 的**形狀**。把它餵回 i18next 的 `CustomTypeOptions`：

```ts
declare module 'i18next' {
  interface CustomTypeOptions {
    defaultNS: 'translation'
    resources: { translation: typeof en }
  }
}
```

`t('rail.emty')` 於是**編譯失敗**（TS2345），與自寫方案同等強度。**不需要任何型別產生器。**
這條若沒做，i18next 打錯 key 只會在執行期把原 key 印在畫面上 —— 那是這個選型唯一真正的弱點，
而它是可以關掉的。

### D2 — 字典是 `.json`，不是 `.ts`

**因為 probe 必須讀得到同一份事實（見 D5），而 `scripts/*.mjs` 無法 import TypeScript。**
Node 22 的 import attributes 已實測可用：

```js
import en from '../src/shared/i18n/en.json' with { type: 'json' }
```

代價：JSON 不能寫註解。可接受 —— 字典的內容就是文案本身，它不需要解釋自己。

### D3 — 兩個 i18next 實例，一份字典；preload 不碰 i18n

main 與 renderer 是不同的 realm，沒有共用的模組實例可言。**各自 `i18next.init()`**，
`resources` 指向同一個 `src/shared/i18n/en.json`。

- **renderer 的元件**用 `useTranslation()`（react-i18next）—— 這是選了 react-i18next 的用途：
  日後真的加了語言，切換時元件會自己 re-render。
- **renderer 的非元件情境**用 i18n 實例的 `t`（`session-badge.tsx` 的 `statusTitle` 是純函式、
  `KeyboardNavigation` 的 querySelector 不在 render 週期裡）。
- **main** 用 `i18next.t`。
- **preload 不參與** —— 它不產生任何文案，只轉發 IPC。

`src/shared/` 是新目錄，必須加進 `tsconfig.node.json` 與 `tsconfig.web.json` 的 `include`
（兩份目前分別只 include `src/main`+`src/preload` 與 `src/renderer`）。

### D4 — 「使用者可見的文案」的界線：會被顯示的進字典，開發者訊息只要求英文

| | 進字典？ | 必須英文？ | 例 |
|---|---|---|---|
| JSX 文字、`aria-label`、`title`、驗證訊息、空狀態 | ✅ | ✅ | `尚未加入任何 folder` |
| 原生對話框（`dialog.showMessageBox`） | ✅ | ✅ | `有 N 個檔案尚未儲存` |
| **經 IPC 流到畫面上的**錯誤 message | ✅ | ✅ | `TerminalError` → session 的 `wakeError` |
| 寫進 pty 串流的訊息 | ✅ | ✅ | session 重建的重播分隔線 |
| `console.*` | ❌ | ✅ | `[sessions] 重建失敗：…` |
| 內部不變式的 `throw new Error` | ❌ | ✅ | `useSessions 必須用在 SessionsProvider 之內` |

**開發者訊息不進字典**（沒有使用者會看到，翻譯它毫無意義），**但仍必須是英文** —— 因為守衛
（D6）是一刀切的。

**而一刀切是對的**：「這個字串會不會被顯示」**無法靜態判定**。`TerminalError` 的 message 看起來
像內部錯誤，實際上它會被畫在終端上（`無法恢復這個 session：{wakeError}`）；`fs-service` 的
failure message 會變成 FileViewer 的 hint。一道「只擋使用者可見文案」的守衛，得先解決一個
不可判定的問題；一道「字串字面值一律英文」的守衛，只需要一個 AST walker。

### D5 — probe 的 selector 從**同一份字典**取字串，而不是硬編英文

62 處硬編中文 selector 若只是換成硬編英文，下一次改文案時就要再全域改一次 —— 而漏掉的那幾處
會讓探針**選不到元素**（不是斷言失敗，是 `null`）。改為：

```js
import en from '../src/shared/i18n/en.json' with { type: 'json' }
const NEW_SESSION = `[aria-label="${en.sessions.new}"]`
```

**要正面回答的反對意見：「測試與被測物共用同一份事實，字典寫錯時測試不會發現。」**

不成立，因為 **probe 驗的是行為，不是文案內容**。文案的**字面內容不是任何一條 requirement** ——
沒有哪條 spec 說「那顆按鈕必須叫做 New session」，spec 說的是「觸發它會建立一個 session」。
`aria-label` 在 probe 裡的角色是**定位手段**，等同於 CSS class 或 `role`，共用它跟共用
`role="tablist"` 沒有差別。

文案內容的正確性由**人**擔保（它就印在畫面上，dogfooding 天天看得到）；而共用字典正好消滅了
真正該擋的失敗模式 —— **文案改了、探針靜默地選不到元素**。

（`role` 的結構、哪個元素該有 label、label 是否唯一 —— 這些仍是 probe 斷言的一部分，不受影響。）

### D6 — 守衛：TypeScript AST，不是行掃描；而且必須有對照組

規則：**`src/**` 的產品原始碼（排除 `*.test.ts`）中，字串字面值、模板字面值與 JSX 文字不得含 CJK。**
註解豁免（repo 慣例是繁中註解）。

**必須用 AST（`ts.createSourceFile` + walk），不能用 regex 掃行：**
- 註解與字串在同一行裡分不開（`const x = 'ok' // 這是註解`）；
- JSX 的 `{/* 註解 */}` 對行首的 `//` 判斷完全無效；
- 而**豁免註解正是這道守衛的核心語意** —— 判不準它，守衛不是誤殺就是全綠。

`typescript` 已是 devDependency（`npm run typecheck` 在用），不新增依賴。

**對照組是必要的**（`naming.test.mjs` 的教訓：少了對照組，`git grep` 的 ANSI 顏色碼曾讓路徑
比對靜默失準而全綠）：守衛的測試必須包含一份**刻意含 CJK 字串**的 fixture，並斷言它**被抓到**。
一道抓不到任何東西的守衛，與沒有守衛是同一件事。

**豁免**：`en.json`（不是 TS，不掃）、`scripts/`（探針輸出是開發工具）、`*.test.ts`
（測試可以用中文描述測什麼）。

### D7 — `Ctrl+T` 的 querySelector 改用 `t` 組出，機制不動

**不改機制。** `Ctrl+T` 走「啟動既有的建立入口」（`querySelector` 找到那顆按鈕並觸發它）是
`session-navigation-and-labels` 的**刻意設計** —— 鍵盤叫出的選單與滑鼠點出來的錨定在同一個地方，
spawn 選單的狀態不必從 `SessionTabs` 搬出來。改成 context 或 custom event 會為了躲開一個字串
而拆掉一個好的設計。

改的是 selector 的**字串來源**：`[aria-label="${i18n.t('sessions.new')}"]`。於是文案再怎麼改，
`Ctrl+T` 自動跟上 —— **那個靜默失效的坑被結構性地填掉了**，不是靠記得。

### D8 — 相對時間：locale 交給 i18n，格式仍走 `Intl`

i18next 不處理相對時間。`relative-time.ts` 維持用 `Intl.RelativeTimeFormat`，但 locale 由
`i18n.language` 供應（不再寫死 `'zh-TW'`），fallback 的 `剛剛` 進字典（`"just now"`）。

**這條非改不可**：檔案樹每一列都在顯示修改時間，locale 沒改的話，一個全英文的 UI 裡會混著
「3 分鐘前」。

### D9 — 終端的重播分隔線：只有文字進字典，ANSI 留在程式碼

`── 以上為上次的內容 · spekterm 已重新啟動 ──` 是**寫給使用者看的一行字**，只是載體是 pty 串流
而不是 DOM。文字進字典；`\x1b[2m` / `\x1b[0m` 與框線字元留在 `TerminalView.tsx`（它們是呈現，
不是文案）。

### D10 — `index.html` 的 `lang="zh-Hant"` → `en`

不只是形式：`lang` 影響字型 fallback 與螢幕閱讀器的發音。

## Risks / Trade-offs

- **62 處 selector + `Ctrl+T` 的 querySelector 靜默失效** → D5 與 D7：兩者都從字典取字串，
  結構性消滅，而非依賴紀律。
- **i18next 進 renderer bundle**（ESM min 約 40kB） → 可接受。`measure:bundle` 的守衛是針對
  Monaco 的語言服務 worker，不受影響；但 tasks 仍要量一次，確認沒有意外。
- **i18next 必須進 `dependencies`（不是 devDependencies）** → main 的 build 用
  `externalizeDepsPlugin()`，i18next 不會被 bundle 進 main，而是在執行期 require。Phase 6 的
  electron-builder 只會把 `dependencies` 打進 asar —— **放錯區塊，打包後的 app 一啟動就
  `MODULE_NOT_FOUND`，而 dev 模式完全正常**。
- **守衛誤殺** → 註解豁免（D6 的 AST）；`*.test.ts` 與 `scripts/` 豁免。
- **文案品質是這個 change 唯一無法自動驗的東西** → 直譯會很糟。文案重寫，並在 dogfooding
  時逐頁看過（這也是它必須是**英文**而非「可切換」的理由之一：只有一份文案時，它就是被天天
  看著的那一份）。

## Migration Plan

一次性，無資料遷移、無使用者設定受影響（`workspace.json` / `sessions.json` 不含任何文案）。
rollback 即 revert。

**順序上唯一的硬性約束**：字典與 i18n 模組必須先於任何文案改寫落地；probe 的 selector 必須與
產品文案**在同一個 commit 內**同步 —— 中間任何一個 commit 都會讓 6 支 probe 全紅。

## Open Questions

無。（選型、範圍、主行程的處置皆已由使用者裁決。）
