## 1. 實作：取得時捕捉，釋放時歸還

- [x] 1.1 於 `src/renderer/src/shell/terminal/xterm.ts` 的 GPU 啟用路徑，在
      `term.loadAddon(addon)` **前後**各取一次該終端 `.xterm-screen` 底下的 canvas，**取差集**；
      於新增的節點中挑不帶 `xterm-link-layer` class 的那一個，連同其 `getContext('webgl2')`
      與 `WEBGL_lose_context` extension 一併存入該終端的閉包。
      **查詢根必須是該終端自己的元素，不得是 `document`** —— 所有終端同時掛載，以文件為範圍
      會命中另一個正在顯示的終端（design D1）
- [x] 1.2 差集為空、挑不到節點、或取不到 extension 時 `console.warn` 一次。訊息**英文**、
      不進字典。**在取得的路徑發聲，不是在釋放的路徑** —— 每次切到該 session 都會經過取得，
      問題因此會反覆出現而非只在關閉時出現一次
- [x] 1.3 `setGpuRenderer(false)`：`webgl.dispose()` **之後**呼叫 `loseContext()`，並清掉閉包中
      的參照
- [x] 1.4 `dispose()`（整個終端銷毀）：同 1.3
- [x] 1.5 `onContextLoss` 的 handler **不呼叫** `loseContext()` —— context 已失效，再 lose 無意義。
      （已查證 `dispose()` 會解除 addon 的 DOM listener，因此 1.3／1.4 的順序不會觸發它。）

## 2. 驗收：`probe:terminal` 的 GPU 段落

**`npm test` 沒有 DOM 也沒有 WebGL，這兩條驗收無法落在單元測試**（design D5）。

- [x] 2.1 新增斷言：切換前把即將被隱藏的那個終端的 context 參照存進 renderer 的全域，
      切換後斷言 `isContextLost() === true`。**探針持有參照這件事是承重的** —— 它讓觀察不受
      GC 時機影響（現行實作正是靠 GC 碰巧沒出事）
- [x] 2.1b 同一條斷言**一併涵蓋「釋放的是自己的資源」**：切換後**顯示中**那個終端的 context
      SHALL 仍未失效。這是 spec「釋放的參照取自該終端自己」唯一的載體 —— 少了它，一個以
      `document` 為查詢範圍、誤釋放別人的實作**會讓 2.1 照樣通過**（被隱藏的那個確實也失效了，
      只是順帶把顯示中的一起弄壞了）
- [x] 2.2 **對照組**：拿掉 1.3 的 `loseContext()`，確認 2.1 變紅（必為 `false`），再還原。
      **對照組沒跑過就不算做完這一條**
- [x] 2.3 新增斷言：取不到參照時 console 出現該訊息。以 CDP 覆寫
      `WebGLRenderingContext.prototype.getExtension`（對 `WEBGL_lose_context` 回 `null`）製造情境，
      再建立 session 並切換，經 `sectionConsole()` 斷言訊息出現
      （`probe-keyboard.mjs` 已有把它當斷言來源的先例）
- [x] 2.4 **對照組**：不覆寫時該訊息 SHALL NOT 出現 —— 否則 2.3 分不出「有發聲」與「一直在發聲」
- [x] 2.5 新增斷言：反覆切換 session 數十次後，**顯示中的終端仍走程式化繪製路徑**
      （`renderPathOf()` 現成）。**「終端仍可顯示與輸入」擋不住這個迴歸** —— 退回 DOM renderer
      的終端一樣顯示正常，而「主動 lose 之後再也拿不回 GPU 路徑」正是本 change 最可能引入的迴歸

## 3. 回歸

- [x] 3.1 `npm test` 全綠
- [x] 3.2 `npm run typecheck` 與 `npm run lint` 通過
- [x] 3.3 `npm run probe:terminal` 全綠 —— 特別是「切回的終端重新取得渲染資源且內容完整」
      與「GPU 的渲染資源只給顯示中的終端」

## 4. 文件與登記

- [x] 4.1 `docs/lessons/terminal.md` 的 GPU 段落補一條：**解除掛載不等於歸還額度**；
      記下 capture-at-creation 的作法與「查詢根不得為 `document`」的理由（會主動弄壞正在顯示的
      終端）；並更正「dispose 後一個 canvas 都不剩」的說法 —— 確定被移除的只有主 canvas 與
      link layer，`_tmpCanvas` 取決於誰最後光柵化過
- [x] 4.2 issue #24 補一則說明：實際採用 capture-at-creation 而非釋放時查詢（含理由）。
      **關閉留到 archive 時**（與 commit 同步）
- [x] 4.3 在 #19／#21 各補一句：本 change 歸還了額度，但**未宣稱**能解釋那些紅燈與慢

## 5. 封存前的稽核結果

- [x] 5.1 `/openspec-verify-change` 稽核：17/17 tasks、8/8 scenario 有載體、design D1–D5 全部遵循。
      唯一的 WARNING —— **終端銷毀路徑（`dispose()`）的釋放沒有驗收攔得住**（實測：拿掉那一行，
      探針仍 74/74 全綠）—— **本 change 不做，已轉為 issue #26**。實作本身正確，缺的是擋住
      未來回歸的那道網
