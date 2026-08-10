## Why

側欄的 artifact 分頁呈現為 **Tasks │ Specs │ Design │ Proposal** —— 敘事順序整個倒過來。使用者要讀的是
「這個 change 為什麼存在、打算怎麼做」，而分頁把結論排在最前、動機排在最後。

根因有兩層，而**兩層各自都足以造成這個結果**：

1. **權威順序拿不到。** core 以 `spawn("openspec", ["status", …])` 取得 schema 宣告的順序，而
   `openspec` 只裝在 nvm 的 node bin 底下。自桌面環境啟動的打包產物只繼承系統預設 PATH（實測
   AppImage 主行程的 PATH 不含任何 nvm 路徑）⇒ ENOENT ⇒ `schemaOrder` 為 `undefined`。
2. **拿不到時退回了錯的順序。** 側欄直接沿用 core 交付的順序，而那是 **mtime 由新到舊**（core 的
   設計意圖是讓正在編輯的 artifact 浮到最前）。對一個正常寫下來的 change，那**恰好是敘事順序的
   反序**。

第 2 點還有一個第 1 點修好也不會消失的破口：**core 只對 active change 查權威順序**，archived
change 一律回 `null`。也就是說**每一個封存的 change，順序從來就是反的**，而側欄正是用來讀
`archive/` 的。

**而現在退路有了權威實作。** `@spekjs/core` **1.7.0** 的 `sortArtifacts(artifacts, 'schema', schemaOrder)`
就是這條規則：schemaOrder 可用時照它、不可用時退回敘事順序、未被涵蓋的 artifact 接在其後。那個函式
是本專案回報後上移到 core 的（spek #45 另補上泛型，使它接得住本 repo 自己的 DTO）——
**所以這個 change 不再需要決定「退路怎麼排」，只需要把權威順序正確地交給它。**

## What Changes

- **artifact 分頁改用 core 的 `sortArtifacts`**，模式固定為 `schema`。本 repo **不自行實作排序規則**
  —— 那正是 core 1.6.0／1.7.0 兩次改動要消除的重複。
- **退路生效時向使用者說明原因。** 順序正確之後，使用者仍無從得知眼前這個順序是權威的還是推測的。
  採用上游 spek web 既有的兩句話（archived 一句、其餘一句），文案入字典。
- **主行程取得使用者互動 shell 的 PATH**，使 core spawn 的 `openspec` 在桌面環境啟動時解析得到 ——
  讓權威順序**真的被取用**，而不是永遠落在退路上。
- **`desktop-packaging` 中一句已被實測推翻的宣稱改寫**（詳見 design 的 Context）。

## Capabilities

### New Capabilities

（無）

### Modified Capabilities

- `openspec-panel`：artifact 分頁的排序條款改為「以 core 的排序規則呈現」，並新增「退路生效時說明
  原因」的要求。
- `desktop-packaging`：新增「主行程代表使用者執行的外部程式亦解析使用者的 PATH」，並改寫既有那條
  對 login shell 機制的描述。

## Impact

**依賴**

- `@spekjs/core` `^1.6.0` → **`^1.7.0`**。純型別放寬（`sortArtifacts` 泛型化），無執行期行為變更；
  core 的 CHANGELOG 列出三個 source-level caveat，**已逐一確認對本 repo 皆不成立**。

**程式碼**

- `src/renderer/src/shell/openspec/ChangeView.tsx` —— `orderArtifacts` 整個由 `sortArtifacts` 取代；
  新增退路提示。
- `src/shared/i18n/en.json` —— 兩條提示文案。
- 主行程新增一次性的使用者 PATH 解析。**這會連帶改變 pty 的環境**（`ptyEnv` 整份繼承
  `process.env`）—— 見 design D5，那不是副作用而是必須明說的行為變更。

**驗收**

- `probe:openspec` —— 分頁順序與退路提示。
- **PATH 那半在自動化裡驗不到端到端**：probe 與 `npm run dev` 皆自終端機啟動，PATH 天生完整，
  機制失效也照樣通過。載體是人工驗收（design D7 說明判準）。

**不影響**

- 檔案系統邊界與 `(folderId, relPath)` 詞彙 —— 不新增任何路徑進出 IPC。
- `spek-core-integration` 的任何條款 —— 它要求語意化版本與非本機協定，升版後皆維持。
