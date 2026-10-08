# spekterm

[English](README.md) | **繁體中文**

一個以 agent 為核心的本地開發工作台。spekterm 在同一個視窗裡為每個 repo 跑
[Claude Code](https://code.claude.com/docs) session，旁邊再放一塊懂 [OpenSpec](https://github.com/Fission-AI/OpenSpec)
的側欄 —— 讓你不必另開 IDE，就能一邊駕駛 agent、一邊讀它正在做的那個 change。

**官網與文件：[spekterm.com](https://spekterm.com/zh-tw/)** —— 使用說明在
[spekterm.com/docs](https://spekterm.com/docs/)（[繁體中文版](https://spekterm.com/zh-tw/docs/)）。

![spekterm：Claude Code session 以對話檢視呈現，旁邊的側欄顯示它正在做的 OpenSpec change 的 tasks](site/src/assets/screenshots/zh-TW/hero.png)

> **現況：** 早期版本。目前提供 Linux 版本，macOS 與 Windows 尚未支援。自動更新與程式碼簽章都還沒有。

## 為什麼

同時跑好幾個 agent，通常代表一疊終端機分頁，外加一個只為了讀 spec 而切過去的編輯器。spekterm 相對於
「開四個終端機分頁」的價值在側欄：它懂 OpenSpec —— session 正在做的 change、它的 artifact、tasks 與
spec —— 並且在 agent 寫入磁碟時跟著更新。

## 它做什麼

- **工作區** —— 一個視窗放任意多個 repo，外加一個給其他所有事情用的全域 session。
- **真正的終端** —— `claude` 與你的 shell 跑在真正的 pty 裡，每個 repo 可開多個；session 重開 app 也還在，
  也能休眠。
- **OpenSpec 側欄** —— session 正在做的 change、它的 artifact 與 tasks，瀏覽、關係圖、時間軸，含 worktree。
- **對話檢視、收件匣與交接** —— 以訊息形式讀 agent；Slack 提及會變成收件匣項目；agent 可以把工作交給
  另一個 repo。

完整說明都在[文件](https://spekterm.com/zh-tw/docs/)，包括[快捷鍵](https://spekterm.com/zh-tw/docs/reference/keyboard-shortcuts/)、
[疑難排解](https://spekterm.com/zh-tw/docs/help/troubleshooting/)，以及
[spekterm 會連到哪裡](https://spekterm.com/zh-tw/docs/reference/data-and-network/)。

## 需求

- Linux x64，並安裝 `libfuse2`（執行 AppImage 需要；Ubuntu 22.04 起預設不再安裝）。
  少了它，AppImage 會以 `dlopen(): error loading libfuse.so.2` 失敗；可改為不經 FUSE 執行：
  `./Spekterm-<version>.AppImage --appimage-extract-and-run`。
- [Claude Code](https://code.claude.com/docs)（`claude` 在 `PATH` 上），用於 agent session。spekterm
  執行的是真正的 CLI、用你自己的訂閱 —— 從不要求 API key。

## 安裝

從 [Releases 頁面](https://github.com/spekhq/spekterm/releases)下載最新的 `Spekterm-<version>.AppImage`，然後：

```bash
chmod +x Spekterm-<version>.AppImage
./Spekterm-<version>.AppImage
```

## 從原始碼安裝

需要 Node.js 22（見 [`.nvmrc`](.nvmrc)）。第一次打包需要網路：它會下載 Electron 的執行檔。

```bash
git clone https://github.com/spekhq/spekterm.git
cd spekterm
npm install
npm run build && npx electron-builder --linux   # → release/Spekterm-<version>.AppImage
npm run install:desktop                          # → ~/.local/bin ＋ 應用程式選單
```

`install:desktop` 可以在 spekterm 開著時重跑，執行中的 app 不受影響。移除用 `npm run uninstall:desktop`。

## 文件

- [spekterm.com/docs](https://spekterm.com/zh-tw/docs/) —— 使用說明，有英文與繁體中文。
- [`docs/PRD.md`](docs/PRD.md) —— 產品需求、路線圖與架構決策。
- [`docs/workspace-mockup.html`](docs/workspace-mockup.html) —— 互動式 UI 雛型。
- [`CLAUDE.md`](CLAUDE.md) 與 [`docs/lessons/`](docs/lessons/) —— 給貢獻者與 agent 的工作筆記，包含那些
  第一次發生時是靜默的失敗。
- [`openspec/`](openspec/) —— 規格與完整的 change 歷史。

既有的文件多數是繁體中文；新的文件以英文撰寫。

## 與 spek 的關係

[spek](https://github.com/spekhq/spek) 是開源的 OpenSpec 檢視器。spekterm 是獨立的 repo，透過兩個 npm
套件重用 spek 的掃描引擎與視覺化元件：[`@spekjs/core`](https://www.npmjs.com/package/@spekjs/core) 與
[`@spekjs/ui`](https://www.npmjs.com/package/@spekjs/ui)。

## 參與貢獻

歡迎貢獻 —— 請見 [CONTRIBUTING.md](CONTRIBUTING.md)（英文）。資安問題請依 [SECURITY.md](SECURITY.md)
私下回報。

## 授權

[MIT](./LICENSE)。打包出的產物另附 `THIRD_PARTY_LICENSES.txt`，列出被打包進 app 的每一個第三方套件
與它的授權。

## 聲明

spekterm 是獨立的開源專案，與 Anthropic 沒有隸屬、背書或贊助關係。Claude 與 Claude Code 是 Anthropic, PBC
的商標。OpenSpec 是另一群作者的獨立專案。
