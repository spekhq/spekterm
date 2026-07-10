/**
 * 樹上的位址一律是「相對於 folder 根目錄、以 `/` 分隔」的字串，根目錄為空字串。
 *
 * renderer 沒有 `node:path`，也不該有 —— 它處理的不是檔案系統路徑，而是主行程發給它的
 * 一組不透明識別碼。主行程負責在邊界上把平台分隔符轉成 `/`。
 */
export const ROOT_PATH = ''

export function joinRelPath(dir: string, name: string): string {
  return dir === ROOT_PATH ? name : `${dir}/${name}`
}

export function parentOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? ROOT_PATH : relPath.slice(0, index)
}

export function baseNameOf(relPath: string): string {
  const index = relPath.lastIndexOf('/')
  return index === -1 ? relPath : relPath.slice(index + 1)
}

const MARKDOWN_EXTENSIONS = ['.md', '.markdown', '.mdown', '.mkd']

export function isMarkdown(relPath: string): boolean {
  const lower = baseNameOf(relPath).toLowerCase()
  return MARKDOWN_EXTENSIONS.some((extension) => lower.endsWith(extension))
}
