# 收斂前的斷言數基準

**取得時間**：2026-08-14
**HEAD**：`04f427a`（`feat(probe): 探針時序的結構保證`）
**工作區**：`scripts/` 未有任何本 change 的改動（僅 `openspec/changes/probe-retry-guarantees/` 為新增）
**方式**：`npm run build` 一次，其後三支各以 `PROBE_SKIP_BUILD=1` 依序執行（非並行）
**環境**：Node 22.22.0；機器上無其他 spekterm 行程

## 數字

| 探針 | **build** | dev | 兩模式合計 |
|---|---|---|---|
| `probe:openspec` | **225 / 225** | 225 / 225 | 450 / 450 |
| `probe:terminal` | **135 / 135** | 135 / 135 | 270 / 270 |
| `probe:keyboard` | **109 / 109** | 109 / 109 | 218 / 218 |

**R5 的比對對象是 build 欄。** dev 欄一併記錄是因為這一輪兩個模式恰好對稱且都完整執行 ——
若日後收斂後 dev 出現落差而 build 沒有，那個落差本身就是資訊。

## 完整執行的證據（R5 要求基準輪必須完整）

三支的段落狀態**全部為「通過」**，無「失敗」、無「逾時」、無「未執行（前置失敗）」：

- `probe:openspec` —— 10 個段落（build 5 ＋ dev 5）
- `probe:terminal` —— 20 個段落（build 10 ＋ dev 10）
- `probe:keyboard` —— 8 個段落（build 4 ＋ dev 4）

三支的行程結束碼皆為 0。

## 順帶記錄：窗口耗盡的分佈

它們是既有的、與本 change 無關的落空，記在這裡當作收斂後的對照 —— **本 change 會增加輸出中
窗口耗盡的行數**（每輪內層各一行），屆時要能分辨哪些是新的、哪些本來就在。

| 段落 | 窗口耗盡 |
|---|---|
| `terminal` `runMode`（build / dev） | 1 次／8.1s；1 次／8.1s |
| `terminal` `runRestore`（build / dev） | 1 次／8.2s；1 次／8.1s |
| `terminal` `runHealAndCrash`（build / dev） | 2 次／16.1s；2 次／16.2s |
| `keyboard` `runMode`（build / dev） | 1 次／8.1s；2 次／12.3s |
| `openspec` 全部段落 | 0 |

## 原始輸出

`baseline-{openspec,terminal,keyboard}.log`（本次 session 的 scratchpad，未入版控 ——
上表已含判讀所需的全部內容）。
