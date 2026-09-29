# spekterm

[English](README.md) | **繁體中文**

一個以 agent 為核心的本地開發工作台。spekterm 在同一個視窗裡為每個 repo 開一個
[Claude Code](https://code.claude.com/docs) session，旁邊再放一塊懂 [OpenSpec](https://github.com/Fission-AI/OpenSpec)
的側欄 —— 讓你不必另開 IDE，就能一邊駕駛 agent、一邊讀它正在做的那個 change。

> **現況：** 早期版本，目前只支援 Linux。`0.2.1` 是第一個發佈的版本。macOS 與 Windows 的產物、
> 自動更新與程式碼簽章都還沒有。

## 為什麼

同時跑好幾個 agent，通常代表一疊終端機分頁，外加一個只為了讀 spec 而切過去的編輯器。spekterm 相對於
「開四個終端機分頁」的價值在側欄：它懂 OpenSpec —— session 正在做的 change、它的 artifact、tasks 與
spec —— 並且在 agent 寫入磁碟時跟著更新。

## 功能

**工作區**

- 加入任意多個 folder，可排序，常用的可以置頂。
- 一個不屬於任何 repo 的全域 session，給其他所有事情用。

**終端**

- 真正的終端（`node-pty` + xterm.js，WebGL 繪製），每個 repo 可開多個 session，含 git worktree。
- 重開 app 後 session 還在：`claude` session 續接原本的對話，shell 在最後的工作目錄重生並重播畫面。
  沒在看的 session 保持休眠，看到時才喚醒。
- agent session 可以在終端與對話 view 之間切換。對話 view 來自 agent 自己的紀錄與 hooks ——
  從不解析終端畫面。

**OpenSpec 側欄**

- 跟隨當前 session 正在做的 change：每個 artifact 一個分頁、tasks 進度恆常可見、spec delta 標示
  `ADDED` / `MODIFIED`。
- 瀏覽 specs 與 changes（進行中與已封存），包含住在其他 git worktree 裡的 change。
- 全視窗的依賴圖與時間軸，與 [spek](https://github.com/spekhq/spek) 共用。
- 在 spec、change 與底層檔案之間互跳；`Ctrl+P` 快速開檔；一鍵請 agent 繼續寫這個 change。

**檔案**

- 隨磁碟變動即時更新的檔案樹、Markdown 渲染、語法高亮（Monaco）、編輯與檔案操作。

**收件匣與交接**

- **Slack：** 有人在 Slack 提及你，那件事就成為收件匣裡的一則項目。你讀過內容、選好 folder 之後，
  才會開 session。
- **agent 交接：** agent 可以把工作交接給工作區裡的另一個 repo。spekterm 在那裡開好 session 並送出
  第一則 prompt；子 session 記得它的母 session，做完會回報，你會收到通知。

**為渲染不受信任的內容而設計**

- 介面只能存取你加入的 folder 之內的檔案，每一次檔案系統檢查都在主行程執行。
- 嚴格的 Content-Security-Policy 與導航防護，讓 repo 內容與終端輸出無法執行 script 或接管視窗。

## 需求

- Linux x64，並安裝 `libfuse2`（執行 AppImage 需要；Ubuntu 22.04 起預設不再安裝）。
- [Claude Code](https://code.claude.com/docs)（`claude` 在 `PATH` 上），用於 agent session。spekterm
  執行的是真正的 CLI、用你自己的訂閱 —— 從不要求 API key。

## 安裝

從 [Releases 頁面](https://github.com/spekhq/spekterm/releases)下載最新的 `Spekterm-<version>.AppImage`，然後：

```bash
chmod +x Spekterm-<version>.AppImage
./Spekterm-<version>.AppImage
```

## 從原始碼安裝

需要 Node.js 22（見 [`.nvmrc`](.nvmrc)）。

```bash
git clone https://github.com/spekhq/spekterm.git
cd spekterm
npm install
npm run build && npx electron-builder --linux   # → release/Spekterm-<version>.AppImage
npm run install:desktop                          # → ~/.local/bin ＋ 應用程式選單
```

`install:desktop` 可以在 spekterm 開著時重跑，執行中的 app 不受影響。移除用 `npm run uninstall:desktop`。

## 快捷鍵

| 快捷鍵 | 動作 |
| --- | --- |
| `Ctrl+Tab` / `Ctrl+Shift+Tab` | 當前 rail 項目內的下／上一個 session |
| `Ctrl+↓` / `Ctrl+↑` | rail 上的下／上一個項目 |
| `Ctrl+T` | 開啟建立 session 的選單 |
| `Ctrl+Shift+W` | 關閉當前的 session |
| `Shift+↓` / `Shift+↑` | 把選中的 repo 在 rail 上移動一格 |
| `Shift+→` / `Shift+←` | 把當前的 session 在分頁列上移動一格 |
| `Ctrl+P` | 快速開檔（側欄持有焦點時） |
| `Ctrl+Shift+C` / `Ctrl+Shift+V` | 終端的複製／貼上 |
| `Ctrl+S` | 存檔 |
| `Esc` | 關閉 overlay、對話框與選單 |

終端裡的 `Ctrl+C` 永遠是中斷，即使畫面上有選取。

## 疑難排解

- **AppImage 開不起來（`dlopen(): error loading libfuse.so.2`）。** 安裝 `libfuse2`，或不經 FUSE
  執行：`./Spekterm-*.AppImage --appimage-extract-and-run`。
- **側欄或檔案樹停止更新。** 多半是 inotify 的監看上限太低（錯誤 `ENOSPC` 只出現在主行程的 stderr）。
  用 `cat /proc/sys/fs/inotify/max_user_watches` 查看；若是 8192，調高它：

  ```bash
  echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf
  sudo sysctl --system
  ```

- **我在跑的是哪一份？** Settings → About 列出版本、建置時刻與 commit。

## 文件

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
