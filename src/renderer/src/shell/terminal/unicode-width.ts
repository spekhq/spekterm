/**
 * 終端的字元寬度判定 —— 挑選要啟用的 Unicode 版本。
 *
 * xterm 內建的寬度表只有 **Unicode 6**（實測 `term.unicode.versions === ['6']`，且無法以選項換掉），
 * 而 pty 內的程式依現代 wcwidth 排版。兩邊不一致時，每一個認定不同的字元都會使該行其餘內容位移。
 *
 * **判定單位必須是 grapheme cluster，不能是 code point**（design D1，實測 claude 的排版）：
 *
 * | | claude 排版 | 內建 v6 | `addon-unicode11` | `addon-unicode-graphemes` |
 * |---|---|---|---|---|
 * | `✅` U+2705 | 2 | 1 ✗ | 2 ✓ | 2 ✓ |
 * | `⚠️` U+26A0+FE0F | 2 | 1 ✗ | 1 ✗ | 2 ✓ |
 * | `👨‍👩‍👧` ZWJ 序列 | 2 | 3 ✗ | **6 ✗** | 2 ✓ |
 * | `👍🏽` 膚色修飾 | 2 | 2 ✓（碰巧） | **4 ✗** | 2 ✓ |
 *
 * `U+26A0` 本身是 ambiguous——單看它，任何版本的寬度表都回 1；它成為兩格是因為後隨的 VS16。
 * ZWJ 與膚色修飾同理：它們都是「多個 code point 合起來算一個字」，**查表式的實作沒有地方可以
 * 表達這件事**。因此「採用較新版本的寬度表」結構上到不了那三類。
 */

/**
 * 要啟用的寬度判定版本。由 `@xterm/addon-unicode-graphemes` 註冊
 * （它自己也會把 `activeVersion` 設成這個值）。
 */
export const REQUIRED_UNICODE_VERSION = '15-graphemes'

/**
 * 自可用的版本清單中挑出要啟用的那一個。**指名不到即拋錯，不回退。**
 *
 * **這道門的價值有限，說清楚以免它取代真正的防線**（design D4）：xterm 自己已經守了兩道 ——
 * `UnicodeService` 的 `activeVersion` setter 本來就會對未註冊的版本拋錯，而 addon 的
 * `activate()` 自己就把版本設好了。這個函式擋的是**「取陣列最後一個」那種寫法** —— 清單的順序
 * 是註冊順序的副產品、不是 API 保證的語意，哪天順序變了就會靜默選到 `'15'`（於是 VS16／ZWJ／
 * 膚色修飾那三類悄悄壞回去）。
 *
 * **真正會靜默失敗的失效模式不是這個**，而是「載入成功、版本對、寬度表卻答錯」。那一類只有
 * 「一組代表性字元的 cell 佔用逐類別正確」的驗收擋得住，不是這裡。
 */
export function pickUnicodeVersion(available: readonly string[]): string {
  if (!available.includes(REQUIRED_UNICODE_VERSION)) {
    throw new Error(
      `Unicode width provider "${REQUIRED_UNICODE_VERSION}" is not registered ` +
        `(available: ${available.join(', ') || 'none'}). ` +
        'Refusing to fall back: silently using the built-in Unicode 6 table would make every ' +
        'emoji one cell narrower than the pty assumes, which is exactly the defect this guards.',
    )
  }
  return REQUIRED_UNICODE_VERSION
}
