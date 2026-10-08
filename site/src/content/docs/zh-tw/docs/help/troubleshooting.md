---
title: 疑難排解
description: 最常遇到的問題與處理方式。
sidebar:
  order: 1
---

## AppImage 開不起來

如果啟動時印出 `dlopen(): error loading libfuse.so.2`，表示系統缺少 AppImage 需要的 `libfuse2`
（Ubuntu 22.04 起預設不再安裝）。安裝它：

```bash
sudo apt install libfuse2
```

或不經 FUSE 執行 AppImage：

```bash
./Spekterm-<version>.AppImage --appimage-extract-and-run
```

## 從桌面選單啟動 spekterm 時找不到 `claude`

從桌面選單啟動的程式不會繼承你終端的環境。spekterm 在啟動時讀一次你的登入 shell 的環境，並用其中的
`PATH` 尋找 `claude`。所以：

- 確認含有 `claude` 的目錄有在 shell 的啟動檔裡加進 `PATH`（zsh 是 `.zshrc` 或 `.zprofile`）；
- 改完之後**重新啟動 spekterm** —— 環境只在啟動時讀一次，開一個新的 session 不夠。

## 改了 shell 的環境卻沒有生效

同一個原因：spekterm 只在啟動時讀一次你的環境。結束 spekterm 再重新啟動。

## 側欄或檔案樹停止更新

多半是 inotify 的監看上限太低（錯誤 `ENOSPC` 只會出現在 spekterm 的標準錯誤輸出）。查看目前的值：

```bash
cat /proc/sys/fs/inotify/max_user_watches
```

若是 8192，調高它：

```bash
echo 'fs.inotify.max_user_watches=524288' | sudo tee /etc/sysctl.d/60-inotify.conf
sudo sysctl --system
```

## 我在跑的是哪一份建置？

**設定 → 關於** 列出版本、建置時間與 commit。在 [GitHub](https://github.com/spekhq/spekterm/issues)
回報問題時請附上它們。
