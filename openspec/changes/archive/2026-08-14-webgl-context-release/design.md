## Context

`terminal-sessions` 要求「渲染資源由顯示轉為隱藏時 SHALL 釋放之」。實作呼叫
`WebglAddon.dispose()`，而該套件**不呼叫 `loseContext()`**（原始碼中該字串 0 次）——
context 的回收交給 GC，而瀏覽器的並存額度檢查是即時的。已 dispose 但尚未被 GC 的 context
仍佔著額度，滿了之後新的會擠掉最舊的，**而最舊的可能是正在使用中的那一個**。

### 已查證的實作事實

`@xterm/addon-webgl`（xterm 6）與本 repo 的 spike：

| 事實 | 出處 |
|---|---|
| `dispose()` 移除主 canvas 與 link layer（`_canvas.remove()` / `parentElement?.removeChild`），**不釋放 GL context** | addon 原始碼 |
| 主 canvas 是 `.xterm-screen` 的**直接子節點**且**不帶任何 class**；link layer 帶 `xterm-link-layer` | addon 原始碼 + spike |
| `TextureAtlas._tmpCanvas` 建構時就取得 **2d** context，掛在 `.xterm` 根 | addon 原始碼 |
| `webglcontextlost` 的 handler **不同步** fire `onContextLoss` —— 它 `preventDefault()` 後排一個 **3000ms** 的 timer | addon 原始碼 |
| 該 timer **只有 `webglcontextrestored` 會 `clearTimeout`**，`dispose()` 不清 | addon 原始碼 |
| `dispose()` 會 dispose 其 disposable store，**DOM listener 隨之解除** | addon 原始碼 |
| `handle.open(host)` 的 effect 宣告於 `setGpuRenderer` 的 effect **之前**（`TerminalView.tsx:132` vs `:280`），故 `loadAddon` 時 `term.element` 必定存在 | 本 repo |

**一條先前寫錯、必須更正的觀察**：spike 曾記錄「dispose 之後終端 host 底下一個 canvas 都不剩」。
**那是狀態相依的觀察，不是不變式** —— 確定被移除的只有主 canvas 與 link layer；`_tmpCanvas`
是否還留在該終端底下，取決於誰最後光柵化過新 glyph（它跨終端共用且會遷移，見
`docs/lessons/probes.md` 與 `RENDER_PATH_PRELUDE` 的註解）。**不可依據「一個都不剩」放寬任何選擇。**

## Goals / Non-Goals

**Goals:**

- 終端切換渲染路徑或銷毀時，**歸還**其 WebGL 並存額度，而不只是解除掛載。
- 讓「釋放」在規格與驗收上都指向**額度**，而非 DOM 產物。
- 取不到該資源的參照時**發聲**，不靜默略過。

**Non-Goals:**

- 不改渲染路徑的選擇邏輯、不動自動降級、不碰 GPU 偏好的語意。
- 不修 #19／#21。本 change 只還額度，**不宣稱**那能解釋那些紅燈與慢。

## Decisions

### D1: 在建立 addon 的當下就記住 canvas 與 context，不在釋放時才去找

**初稿的做法（釋放前以選擇器從 DOM 找回）有一個會主動弄壞終端的缺陷，已推翻。**
所有 session 的終端**同時掛載**（隱藏的只是加上 `hidden`），因此 `document.querySelector`
回傳的是**文件順序中第一個**符合的 canvas —— 那極可能屬於**另一個、正在顯示**的終端。
對它 `loseContext()` ＝ 使用者當場看到空白，而且沒有任何錯誤：**正是這條 requirement
存在的理由本身**。`dispose()` 那條路更確定 —— React 的 cleanup 跑在節點移除之後，
該終端已脫離 document，`document.querySelector` **只可能**撿到別人的。

作法：在 `term.loadAddon(addon)` **前後**各取一次該終端 `.xterm-screen` 底下的 canvas，
**取差集**，於新增的節點中挑不帶 `xterm-link-layer` class 的那一個，連同它的
`getContext('webgl2')` 與 `WEBGL_lose_context` extension 一起存入該終端的閉包。

**為什麼是差集而不是選擇器**：差集只看**這一次 `loadAddon` 新增了什麼**，因此
`_tmpCanvas`、overview ruler、或未來新增的任何既有節點在**結構上就不可能入選**。
初稿的 `:not(.xterm-link-layer)` 是黑名單 —— 未來 `.xterm-screen` 下多一顆沒有 context 的
canvas，查詢它的 webgl context **會當場建立一個新的**（多吃一個額度，失效方向與需求相反）。
差集沒有這個分支。

**查詢根 SHALL 為該終端自己的元素，SHALL NOT 為 `document`。** 這條是上面那個缺陷的直接修正，
要寫進 spec 而不只是註解。

**前提（必須在此註明，否則日後會靜默失效）**：`WebglAddon.activate()` 有一條延後路徑
（`term.element` 不存在時改為等 `onWillOpen`）。本 app 一律在 `open()` 之後才開 GPU
（effect 宣告順序如上表），所以走不到；**若日後那個順序改變，capture 會拿到空的差集**。
由 D3 的發聲承接。

### D2: 釋放的順序是 `dispose()` → `loseContext()`

**初稿給的理由是錯的，結論碰巧不變。** 初稿寫「先 loseContext 會觸發 `onContextLoss` →
在 `setGpuRenderer(false)` 執行到一半重入狀態機」。實測原始碼：`webglcontextlost` 的 handler
**不同步** fire，它排一個 3000ms 的 timer。所以不會重入。

**真正的理由有兩條，都比初稿的嚴重：**

1. 那個 timer **只有 `webglcontextrestored` 會 `clearTimeout`，`dispose()` 不清**。先 lose 的話，
   三秒後仍會 fire 並印出訊息 —— 污染 renderer 的 console 環形緩衝，而 #19／#21 正倚賴它判讀。
2. 若使用者在那三秒內切回來、我們的 `onContextLoss` handler 又還活著，它會把 `webgl = null`
   **蓋掉一個剛建好的新 addon**。

**而先 dispose 是安全的，這也已查證**：`dispose()` 會 dispose 其 disposable store，DOM listener
隨之解除，因此 `loseContext()` 不會觸發 addon 的任何 handler。**tasks 不需要再實測這一條。**

**canvas 脫離 DOM 之後 `getContext()` 仍回傳原本的 context** —— context mode 綁在元素物件上，
與是否在 document 中無關；同型別的後續呼叫回傳同一個物件。初稿把這條列為待驗，實際上由規格
即可答出。**而 D1 改為 capture-at-creation 之後，這件事甚至不再承重**（我們持有的是 context
本身，不是 canvas）。

### D3: 取不到參照時 `console.warn`，且在**取得**的時候就叫

失效方式決定了這條：capture 拿到空差集就什麼都不做，而「什麼都不做」與「正確釋放了」在外部
完全無法區分 —— **這個缺陷本身就是這個形狀**（`dispose()` 看起來做了事，實際沒還額度），
其修復不該再引入同一個盲點。

**在取得時發聲比在釋放時發聲強**：每次切到該 session 都會經過取得路徑，因此問題會**反覆**
出現而不是只在關閉時出現一次；而且它把 D1 的前提（`activate()` 未走延後路徑）變成可觀察的。

訊息走 `console.*`，因此**不進字典、但一律英文**。

### D4: 驗收的觀察量是「該 context 是否已失效」，不是「額度是否被擠掉」

**初稿的驗收設計（建滿 16 個、翻轉建立順序、以 LRU 淘汰為觀察）已推翻 —— 那是調查的形狀，
不是驗收的形狀。** 規格真正在乎的是「這個終端釋放時，它的 context 被歸還」，而
`loseContext()` 依規格**立即**把該 context 設為 lost。因此：

> 切換前抓住即將被隱藏的那個終端的 context 參照，切換後斷言 `gl.isContextLost() === true`。

修正前必為 `false`、修正後必為 `true`。不必建 16 個、不必管 LRU 淘汰順序、不干擾待測狀態；
而且驗收持有參照這件事**反而讓它不受 GC 影響**（現行實作正是靠 GC 才碰巧沒出事）。

**這個換法讓「驗收須具備鑑別力」不必再寫成規格條文** —— 鑑別力來自觀察量本身，而不是來自
一條「請記得把建立順序寫對」的規則。初稿把一次調查踩過的坑升格為永久條文，成本高，
且它仍然倚賴人記得。spec 那條 ADDED requirement 連同其兩條 scenario 隨之刪除。

### D5: 驗收落在 `probe:terminal`，不落在 `npm test`

`npm test` 是 `node --import tsx --test` —— **沒有 DOM、沒有 WebGL**。「以瀏覽器語意驗證釋放」
在那個 realm 寫不出來；寫得出來的只有「對自製 fake DOM 驗我們自己的選擇器」，那是測試與被測物
同源的假綠。

因此兩條驗收都落在 `probe:terminal` 的 GPU 段落：

- **額度歸還**：D4 的 `isContextLost` 斷言。
- **取不到參照時發聲**：探針已在收集 renderer 的 console（`lib/cdp.mjs` → `lib/instrument.mjs`
  的 `sectionConsole()`，`probe-keyboard.mjs` 已有把它當斷言來源的先例）。

**初稿的 tasks 曾寫「若單元測試無法表達，改以獨立 Electron 腳本承擔」—— 那會產出一個不在
`npm test`、也不在 `run-probes.mjs` 的 `ALL_PROBES` 裡的腳本，沒有任何入口會再執行它。**
規格宣稱有驗收、而實際上沒有載體，正是這個 repo 犯過四次的那件事。**登記不是載體。**

## Risks / Trade-offs

- **[capture 依賴 xterm 的 DOM 結構]** → 差集消除了「選錯人」的分支，但仍假設 `loadAddon` 會在
  `.xterm-screen` 下新增節點。緩解：D3 在取得時發聲，且升級 xterm 時 `probe:terminal` 的 GPU
  段落是回歸基準。**這是本 change 主要的殘留風險**，無法以公開 API 消除（addon 不暴露 context）。

- **[`activate()` 的延後路徑]** → 若日後 effect 順序改變、`open()` 晚於開 GPU，capture 會拿到空
  差集。由 D3 的發聲承接，且已寫入 design 供日後查閱。

- **[釋放時機過早]** → 若某條路徑在 `setGpuRenderer(false)` 之後仍預期沿用該 context，主動 lose
  會讓它拿到失效的 context。回歸基準是 `probe:terminal` 的「切回的終端重新取得渲染資源且內容
  完整」，並補一條「反覆切換後顯示中的終端**仍走程式化繪製路徑**」——
  **「終端仍可顯示與輸入」擋不住這個迴歸**，因為退回 DOM renderer 的終端一樣顯示正常。

- **[本 change 不會讓 #19／#21 變綠]** → 它還的是額度，而那兩票的紅燈與慢尚未證明由額度造成。
  不要把它當成那兩票的修復，否則下一輪會誤判。

## Open Questions

無。
