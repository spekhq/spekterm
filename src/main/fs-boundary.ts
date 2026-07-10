import { realpath } from 'node:fs/promises'
import path from 'node:path'

export type FsBoundaryCode = 'ABSOLUTE_PATH' | 'ESCAPES_ROOT' | 'NOT_FOUND'

export class FsBoundaryError extends Error {
  constructor(
    readonly code: FsBoundaryCode,
    message: string,
  ) {
    super(message)
    this.name = 'FsBoundaryError'
  }
}

/**
 * target 是否位於 root 之內（root 自身視為在內）。
 *
 * 以 `path.relative` 判定，**不可**改寫成 `target.startsWith(root)` ——
 * 前綴比對會把 `/a/bc` 誤判為位於 `/a/b` 之內。
 */
export function isWithin(root: string, target: string): boolean {
  const rel = path.relative(root, target)
  if (rel === '') return true
  if (path.isAbsolute(rel)) return false
  return rel !== '..' && !rel.startsWith(`..${path.sep}`)
}

async function realpathOrThrow(target: string): Promise<string> {
  try {
    return await realpath(target)
  } catch {
    throw new FsBoundaryError('NOT_FOUND', `path does not exist: ${target}`)
  }
}

/**
 * 把 workspace folder 內的相對路徑解析成真實的絕對路徑，並保證它沒有離開該 folder。
 *
 * 兩道檢查缺一不可：先看字面解析的結果（擋 `..` 逃逸），再看解析 symlink 之後的
 * 真實路徑（擋「folder 內的 symlink 指向 folder 外」）。只做前者會被 symlink 繞過；
 * 只做後者則會讓一個指向 folder 外、但當下不存在的路徑回報成 NOT_FOUND 而非越界。
 */
export async function resolveWithinRoot(root: string, relPath: string): Promise<string> {
  if (path.isAbsolute(relPath)) {
    throw new FsBoundaryError('ABSOLUTE_PATH', `relPath must be relative: ${relPath}`)
  }

  const realRoot = await realpathOrThrow(root)

  const lexical = path.resolve(realRoot, relPath)
  if (!isWithin(realRoot, lexical)) {
    throw new FsBoundaryError('ESCAPES_ROOT', `path escapes workspace folder: ${relPath}`)
  }

  const realTarget = await realpathOrThrow(lexical)
  if (!isWithin(realRoot, realTarget)) {
    throw new FsBoundaryError('ESCAPES_ROOT', `path escapes workspace folder via symlink: ${relPath}`)
  }

  return realTarget
}
