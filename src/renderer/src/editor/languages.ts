/**
 * Monaco 的語法高亮（monarch tokenizer）來源。
 *
 * Each language definition only calls `registerLanguage({ loader: () => import("./<lang>.js") })` —
 * the grammar itself is a dynamic import, so the bundler emits one lazily loaded chunk per language,
 * loaded only when a file in that language is opened. Registering all of them costs almost nothing
 * at startup, so there is no reason to pick languages by hand; `register.all` is the supported entry
 * point for that (monaco-editor ≥ 0.56).
 *
 * **Do not** import `monaco-editor/languages/features/*` here (the TypeScript / JSON / CSS / HTML
 * language services). Those are worker-driven semantic analysis a read-mostly viewer does not need —
 * the user cannot fix a diagnostic here — and `ts.worker` alone is about 12.65 MB, more than every
 * other asset combined. `npm run measure:bundle` fails if one appears.
 */
import 'monaco-editor/languages/definitions/register.all'
