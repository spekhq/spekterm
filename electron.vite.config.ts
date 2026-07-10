import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { defineConfig, externalizeDepsPlugin } from 'electron-vite'

/** `basic-languages/<lang>/<lang>.js` 是 grammar 本體，經動態 import 載入。 */
const LAZY_GRAMMAR = /basic-languages\/[^/]+\/[^/]+\.js$/

/**
 * 把編輯器核心切成獨立 chunk。
 *
 * 理由不是快取，是**可歸因**：`workspace-app-shell` 要求編輯器對 bundle 的體積貢獻可被
 * 辨識。與 app 混在同一個主 chunk 裡時，那個數字只能用「加一次、減一次、再相減」估算。
 *
 * grammar 必須留在原本的動態 chunk 裡 —— 把它們也塞進 `monaco` 這個靜態 chunk，
 * 81 種語言就會全部進入初始載入路徑（約 640 kB），延遲載入的好處會整個消失。
 */
function chunkForModule(id: string): string | undefined {
  if (!id.includes('monaco-editor')) return undefined
  if (LAZY_GRAMMAR.test(id) && !id.endsWith('.contribution.js')) return undefined
  return 'monaco'
}

export default defineConfig({
  // main / preload 執行於 Node 環境，依賴一律 external 而非 bundle：
  // native 模組（node-pty）無法被 bundler 處理。
  main: {
    plugins: [externalizeDepsPlugin()],
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: {
      rollupOptions: {
        output: {
          manualChunks: chunkForModule,
        },
      },
    },
  },
})
