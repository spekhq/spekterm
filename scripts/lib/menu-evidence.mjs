/**
 * 「開一個選單並點其中一項」失敗時的**現場**。
 *
 * ## 為什麼是共用的一份，而不是各站點自己寫
 *
 * 這個現場的價值只在**失敗那一次**兌現，而那一次是偶發的。issue #17 的建議 1（失敗前 dump
 * 選單診斷）提出之後，那個站點又中斷過至少一次，而**一次現場都沒採到** —— 因為它被想成
 * 「那個站點要加的一段程式碼」，於是其餘七個站點各自要重新記得一次。
 *
 * 共用的前提是結構上的：**選單是共用元件**，八個站點看到的都是同一個 `[role="menu"]` 加底下
 * 一排 `<button>`（分頁右鍵、檔案樹右鍵、spawn 選單、rail 的建立入口都是它）。
 *
 * ## 三條約束（沿用掛載診斷那條 requirement 的既有裁決）
 *
 * - **不得阻塞**：一次 `evaluate`，不等任何回呼。一個為了診斷卡住而寫的探測，自己不能卡住。
 * - **不得留常駐物**：純讀取，不註冊 listener、不掛全域變數。探針不在產品程式碼裡塞測試分支，
 *   該紀律同樣適用於執行期注入。
 * - **失敗不得改變回傳值**：這一條由呼叫它的原語承擔（`retryAction` 會接住它拋的例外）——
 *   「重試最終失敗」最常見的原因就是 renderer 已經不在，而此時對它求值會拋。
 */

/**
 * @param {object} client CDP client
 * @param {object} [options]
 * @param {string} [options.expected] 期待點到的項目文字 —— 用來回答「選單開了，但那一項在不在」
 * @param {{x:number,y:number,width:number,height:number}} [options.clicked] 剛才點的矩形
 * @returns {Promise<string>} 一行現場描述
 */
export async function menuEvidence(client, { expected, clicked } = {}) {
  const at = clicked
    ? { x: Math.round(clicked.x + clicked.width / 2), y: Math.round(clicked.y + clicked.height / 2) }
    : null

  // **求值字串裡不放註解。** 說明寫在這裡：`elementFromPoint` 回答的是「那一下點到了誰」——
  // 座標過期（版面在量測與點擊之間移動）與選單根本沒開，在現有輸出上是同一種症狀，而它們
  // 要修的不是同一件事。
  //
  // 而註解不放進去還有一個更硬的理由：**這是一個 template literal**，註解裡一個反引號就會
  // 提前關閉它，症狀是整支探針在一個看似無關的地方 `SyntaxError`（本檔初版就是這樣紅的，
  // 與 CLAUDE.md 記載的「aria-label 裡的單引號咬掉 probe 選擇器」同一族）。
  const scene = await client.evaluate(`(() => {
    const menu = document.querySelector('[role="menu"]')
    const items = menu ? [...menu.querySelectorAll('button')].map((b) => b.innerText.trim()) : null
    const at = ${JSON.stringify(at)}
    const hitEl = at ? document.elementFromPoint(at.x, at.y) : null
    const describe = (el) => {
      if (!el) return null
      const label = el.getAttribute('aria-label') || el.closest('[aria-label]')?.getAttribute('aria-label')
      const text = (el.innerText || '').trim().slice(0, 40)
      return el.tagName.toLowerCase() + (label ? '[' + label + ']' : '') + (text ? ' «' + text + '»' : '')
    }
    return {
      menu: Boolean(menu),
      items,
      at,
      hit: describe(hitEl),
      dialogs: document.querySelectorAll('[role="dialog"]').length,
      menus: document.querySelectorAll('[role="menu"]').length,
      visibility: document.visibilityState,
    }
  })()`)

  // `dialogs` 在上面被讀出來，是因為「被別的東西蓋住」是這一族的另一種失效方式
  //（overlay 或對話框開著時，選單開不起來，而症狀與「點錯地方」一模一樣）。
  if (!scene) return '（現場取不到 —— evaluate 回傳空值）'

  const parts = [
    `menu=${scene.menu ? 'yes' : 'no'}`,
    scene.menus > 1 ? `menu 數=${scene.menus}` : null,
    scene.items ? `items=${JSON.stringify(scene.items)}` : null,
    expected && scene.items ? `期待的「${expected}」=${scene.items.some((t) => t.includes(expected)) ? '在' : '不在'}` : null,
    scene.at ? `點在 (${scene.at.x},${scene.at.y}) 命中 ${scene.hit ?? '(無)'}` : null,
    scene.dialogs ? `對話框=${scene.dialogs}` : null,
    scene.visibility === 'visible' ? null : `visibilityState=${scene.visibility}`,
  ].filter(Boolean)

  return parts.join('；')
}
