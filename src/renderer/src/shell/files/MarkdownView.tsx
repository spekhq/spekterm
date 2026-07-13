import Markdown from 'react-markdown'
import remarkGfm from 'remark-gfm'

/** 只有 http/https 才交給系統瀏覽器。其餘（相對路徑、被清空的 `javascript:`）不可點。 */
function isExternalHref(href: string): boolean {
  return /^https?:\/\//i.test(href)
}

/**
 * BDD 關鍵字的顏色（雛型的 .req-block）。
 *
 * spec 裡的 `**WHEN**` 本來就是 markdown 的 strong —— 因此**不需要第二個 parser**，
 * 依 strong 的文字內容上色即可。認不得的 strong 走預設（一般的強調）。
 */
function bddTone(text: string): string | null {
  switch (text.trim()) {
    case 'WHEN':
      return 'text-blue'
    case 'THEN':
      return 'text-green'
    case 'AND':
      return 'text-ink-faint'
    // 雛型的 --red 與 --danger 同值。
    case 'MUST':
    case 'SHALL':
      return 'text-danger'
    default:
      return null
  }
}

interface MarkdownViewProps {
  text: string
}

/**
 * 渲染使用者 repo 裡的 markdown —— 也就是**不受信任的輸入**。
 *
 * 安全性來自 `react-markdown` 的預設值，而預設值必須被明確保護：
 *
 * - **不加 `rehype-raw`**：預設會把原始 HTML 節點轉成純文字節點。加了它，`.md` 裡的
 *   `<script>` 就會變成真的 script。
 * - **不覆寫 `urlTransform`**：預設的 `defaultUrlTransform` 只放行 `http(s)`／`mailto`
 *   等協定，`javascript:` 會被清成空字串。
 *
 * 連結一律不在 app 內導航：外部連結交給主行程（它會再驗一次協定），其餘一律不可點。
 * 少了這道，一個 markdown 連結就能把 renderer 帶去遠端頁面 —— 而 preload 會跟著注入，
 * 那個頁面將取得完整的 `window.workspace.fs`。
 */
export function MarkdownView({ text }: MarkdownViewProps): React.JSX.Element {
  return (
    <div className="markdown px-1 py-1 text-base leading-relaxed text-ink-dim">
      <Markdown
        remarkPlugins={[remarkGfm]}
        components={{
          strong({ children }) {
            const tone = typeof children === 'string' ? bddTone(children) : null
            if (!tone) return <strong className="font-semibold text-ink">{children}</strong>
            return <strong className={`font-mono font-bold ${tone}`}>{children}</strong>
          },
          a({ href, children }) {
            if (!href || !isExternalHref(href)) {
              // 相對連結（指向 repo 內的其他檔案）留待 Phase 5 的交叉導覽。
              return <span className="text-ink">{children}</span>
            }
            return (
              <a
                href={href}
                className="text-accent underline decoration-dotted underline-offset-2"
                onClick={(event) => {
                  event.preventDefault()
                  void window.workspace.shell.openExternal(href)
                }}
              >
                {children}
              </a>
            )
          },
        }}
      >
        {text}
      </Markdown>
    </div>
  )
}
