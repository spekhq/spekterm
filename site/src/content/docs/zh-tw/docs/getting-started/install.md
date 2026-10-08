---
title: 安裝
description: 下載 spekterm 的 AppImage，設成可執行，然後啟動它。
sidebar:
  order: 1
---

spekterm 以 AppImage 發佈：一個檔案就能執行，不必在系統裡安裝任何東西。
目前提供 Linux 版本；macOS 與 Windows 尚未支援。

## 系統需求

- **x86_64 的 Linux。** AppImage 需要 `libfuse2` 才能執行。Ubuntu 22.04 起預設不再安裝它 ——
  見[AppImage 無法啟動時](#appimage-無法啟動時)。
- **Claude Code**（agent session 需要）：`claude` 指令必須在你的 `PATH` 上。spekterm 執行的是真正的
  CLI，用的是你自己的登入與訂閱；它不會向你要 API key。只用 shell session 的話不需要它。
- **OpenSpec** 是選用的。側欄直接讀取 repo 裡的 `openspec/` 目錄；少數細節（例如一個 change 的
  artifact 順序）在你裝了 `openspec` CLI 時才取自它。沒有 `openspec/` 目錄的 repo，照樣有終端與
  「檔案」檢視。

## 下載並執行

1. 打開[最新版本](https://github.com/spekhq/spekterm/releases/latest)，下載
   `Spekterm-<version>.AppImage`。
2. 設成可執行並啟動：

   ```bash
   chmod +x Spekterm-<version>.AppImage
   ./Spekterm-<version>.AppImage
   ```

第一次啟動會看到一個空的工作區。接著看[你的第一個工作區](/zh-tw/docs/getting-started/first-workspace/)。

spekterm 在啟動時讀一次你的 shell 環境（login shell 的 `PATH`，以及 agent session 需要的變數）。
改了 `.zshrc` 或 `.bashrc` 之後，要重開 spekterm，新的 session 才會看到改動。

## AppImage 無法啟動時

如果看到 `dlopen(): error loading libfuse.so.2` 之類的錯誤，表示 AppImage 無法掛載自己。
可以安裝那個函式庫：

```bash
sudo apt install libfuse2
```

或是不經 FUSE 執行 AppImage（它會先解開到暫存目錄）：

```bash
./Spekterm-<version>.AppImage --appimage-extract-and-run
```

兩種都可以；裝了 `libfuse2`，每次啟動會比較快。其他問題與解法見[疑難排解](/zh-tw/docs/help/troubleshooting/)。

## 加進應用程式選單

AppImage 放在哪裡就從哪裡執行。如果你從原始碼建置 spekterm，repo 裡有一個指令會把建好的 AppImage
裝進 `~/.local/bin`，並在桌面環境的應用程式選單加上一個帶圖示的項目：

```bash
git clone https://github.com/spekhq/spekterm.git
cd spekterm
npm install
npm run build && npx electron-builder --linux   # → release/Spekterm-<version>.AppImage
npm run install:desktop                          # → ~/.local/bin + 應用程式選單
```

建置需要 Node.js 22。第一次打包會下載 Electron 的執行檔，所以需要網路。要移除選單項目與安裝的那一份，
執行 `npm run uninstall:desktop`。

## spekterm 把資料放在哪裡

spekterm 記得的一切 —— 資料夾清單、session、側欄的位置、偏好設定、收件匣 —— 都在
`~/.config/Spekterm`。它不會往你的 repo 裡寫任何東西。刪掉那個目錄，spekterm 就回到剛安裝的狀態；
你的程式碼不受影響。

## 更新

目前還沒有自動更新。從[最新版本](https://github.com/spekhq/spekterm/releases/latest)下載新的
AppImage，取代舊的那一個執行即可。`~/.config/Spekterm` 裡的資料會沿用。**設定 → 關於**會顯示你正在
執行的版本。
