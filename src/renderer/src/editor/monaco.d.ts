/**
 * monaco-editor 的 `exports` 欄位未涵蓋 `esm/**` 子路徑，Vite 解析得到，
 * 但 TypeScript 的 bundler resolution 找不到型別。這裡把 esm 入口的型別
 * 對應回 package 根的公開型別（兩者是同一份 API）。
 *
 * 之所以走 esm 子路徑而非直接 import 'monaco-editor'：後者會把全部語言的
 * contribution（含 json / css / html 三支 worker）拉進 bundle。
 */
declare module 'monaco-editor/esm/vs/editor/editor.api' {
  export * from 'monaco-editor'
}

/** 以下為純副作用匯入，只註冊功能，不輸出任何 binding */
declare module 'monaco-editor/esm/vs/editor/editor.all.js'
declare module 'monaco-editor/esm/vs/language/typescript/monaco.contribution'
declare module 'monaco-editor/esm/vs/basic-languages/typescript/typescript.contribution'
declare module 'monaco-editor/esm/vs/basic-languages/markdown/markdown.contribution'
