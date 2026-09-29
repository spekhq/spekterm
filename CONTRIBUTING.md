# 參與貢獻

謝謝你願意幫 spekterm 一把。動手之前，有兩件事先講清楚，免得日後有誤會。

## 貢獻的授權

spekterm 以 [MIT 授權](./LICENSE)開源。**你對本 repo 提交的任何貢獻（程式碼、文件、測試、issue 裡附的修補），
都依同一份 MIT 授權提供。** 你保有自己那部分的著作權，但同意任何人依 MIT 的條款使用它。

這與 GitHub 服務條款的預設相同（對有授權的 repo 提交的貢獻，依該授權提供）；這裡只是把它寫明。

## 贊助

repo 上的贊助入口（GitHub Sponsors）是**給維護者個人的支持**，用來支應維護這個專案的時間。

- 它**不是**專案共有的基金。
- 贊助收入**不依貢獻分配**給貢獻者，提交貢獻也不會因此取得任何收入上的權利。

## 開發流程

- 開發指令、測試分層、以及這個 repo 特有的慣例與踩雷紀錄，都在 [CLAUDE.md](./CLAUDE.md)。動到某一類檔案之前，
  先看它的「踩雷指南」表格，裡面指向該讀的 `docs/lessons/*`。
- 所有變更都走 [OpenSpec](https://github.com/Fission-AI/OpenSpec) 工作流程：proposal → design → tasks → 實作。
  小修補可以先開 issue 討論要不要走完整流程。
- 送出之前：`npm run typecheck`、`npm run lint`、`npm test` 全綠。
- 註解與文件用繁體中文（台灣用語），程式碼用英文，UI 文案一律來自字典（見 CLAUDE.md 的「UI 文案與 i18n」）。
