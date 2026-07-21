import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { usePreferences } from '../PreferencesProvider'

// **`fixed` 而非 `absolute`**：這個對話框由 ActivityBar 觸發，而 ActivityBar 活在一個 56px 寬的
// Panel 裡 —— `absolute inset-0` 會相對於那個 Panel 定位，遮罩只有 56px 寬。`fixed` 相對於
// viewport，覆蓋整個視窗。（files 的 dialogs 用 `absolute` 是因為它們掛在寬的 FilesPanel 內。）
const OVERLAY_CLASS =
  'fixed inset-0 z-40 flex items-center justify-center bg-black/50 px-4 text-sm'
const CARD_CLASS = 'w-full max-w-sm rounded border border-hairline bg-panel p-4 shadow-lg'
const INPUT_CLASS =
  'mt-1 rounded border border-hairline bg-stage px-2 py-1 font-mono text-sm text-ink outline-none focus:border-accent'
const BUTTON_CLASS = 'rounded border border-hairline px-2 py-[3px] text-xs hover:bg-stage'

/**
 * 終端字型設定。本輪 Settings 入口的唯一內容（design D7）。
 *
 * `role="dialog"` 不只是無障礙標記 —— 導航快捷鍵以 `[role="dialog"]` 的存在整體不生效
 * （`keyboard-navigation`），開著這個對話框打字時不會被 Ctrl+Tab 切走。
 *
 * free-text 的 family 輸入（不做字型選擇器，design D9）：空白 ＝ 用系統等寬字。size 空白 ＝ 用
 * 字級尺度的預設。兩個欄位一起送（`updateTerminalFont`），主行程清理／夾制後回傳套用後的值。
 */
export function TerminalFontDialog({ onClose }: { onClose: () => void }): React.JSX.Element {
  const { t } = useTranslation()
  const {
    terminal,
    updateTerminalFont,
    updateGpuAcceleration,
    gpuEnabled,
    updateAgentStatus,
    agentStatusEnabled,
  } = usePreferences()
  const [family, setFamily] = useState(terminal.fontFamily ?? '')
  const [size, setSize] = useState(terminal.fontSize != null ? String(terminal.fontSize) : '')
  const [lineHeight, setLineHeight] = useState(
    terminal.lineHeight != null ? String(terminal.lineHeight) : '',
  )
  // 系統的等寬字型清單，餵給下拉選單（Linux 有；其他平台為空 → 只剩「系統預設」可選）。
  const [gpu, setGpu] = useState(gpuEnabled)
  const [agentStatus, setAgentStatus] = useState(agentStatusEnabled)
  const [fonts, setFonts] = useState<string[]>([])
  const familyRef = useRef<HTMLSelectElement>(null)

  useEffect(() => {
    familyRef.current?.focus()
  }, [])

  useEffect(() => {
    void window.workspace.settings.listMonospaceFonts().then(setFonts)
  }, [])

  // **兩次更新要串接，不能並行送出。** 字型與 GPU 是兩條不同的 IPC，各自回傳「套用後的完整偏好」
  // 並以之覆寫本地 state —— 並行的話**誰後 resolve，state 就是誰的**，另一項的新值會被它帶回舊值
  // （磁碟是對的，畫面不是）。
  const save = (): void => {
    const trimmedFamily = family.trim()
    const parsedSize = Number.parseInt(size, 10)
    const parsedLineHeight = Number.parseFloat(lineHeight)
    void updateTerminalFont(
      trimmedFamily === '' ? null : trimmedFamily,
      Number.isFinite(parsedSize) ? parsedSize : null,
      Number.isFinite(parsedLineHeight) ? parsedLineHeight : null,
    )
      // `null` ＝回到預設（＝啟用）—— 使用者沒有關掉它時，不要在偏好檔裡留下一個 `true`。
      // **依序 await，不可並行**：三者是不同的 IPC，而每一個都會覆寫本地 state ——
      // 並行的話「誰後 resolve，state 就是誰的」，另外兩項會被帶回舊值（磁碟對、畫面錯）。
      .then(() => updateGpuAcceleration(gpu ? null : false))
      .then(() => updateAgentStatus(agentStatus ? null : false))
    onClose()
  }

  const reset = (): void => {
    void updateTerminalFont(null, null, null)
      .then(() => updateGpuAcceleration(null))
      .then(() => updateAgentStatus(null))
    onClose()
  }

  // Live preview：用當下選取的 family/size 即時渲染範例。與終端同一套字型解析（引號包住含空白的名字 +
  // 系統鏈退路）。
  //
  // **範例刻意不含 box-drawing —— 這條在 GPU renderer 進來之後反過來了。**
  //
  // 從前終端與這塊 preview 都是 xterm 的 DOM renderer，框線一樣靠字型的 glyph 去拼、一樣受行高
  // 影響，於是「preview 裡框線接不接得起來」就是「終端裡表格會不會破」。**現在不是了**：終端的
  // 框線由 GPU renderer 依 cell 的邊界**程式化繪製、不經字型**，而 preview 是純 DOM、用的就是字型。
  // 留著框線，preview 會顯示**終端不會有的縫**，使用者將據此去調一個並不存在的問題。
  //
  // preview 的職責因此收斂為「這個**字型**長什麼樣」—— 範例聚焦在足以判別字型的字符。
  const previewFamily = family.trim()
    ? `"${family.trim().replaceAll('"', '')}", ui-monospace, monospace`
    : 'ui-monospace, monospace'
  const parsedPreviewSize = Number.parseInt(size, 10)
  const previewSize = Number.isFinite(parsedPreviewSize)
    ? Math.min(32, Math.max(8, parsedPreviewSize))
    : 15
  const parsedPreviewLineHeight = Number.parseFloat(lineHeight)
  const previewLineHeight = Number.isFinite(parsedPreviewLineHeight)
    ? Math.min(2, Math.max(1, parsedPreviewLineHeight))
    : 1.0

  // 目前選定的 family 若不在列舉清單裡（例如在另一台機器設的、或 fc-list 沒抓到），補進去讓它
  // 仍能顯示與保留 —— `<select>` 只能選有列出的選項，漏了就等於把使用者的設定弄丟。
  const familyOptions = family && !fonts.includes(family) ? [family, ...fonts] : fonts

  return (
    <div className={OVERLAY_CLASS}>
      <div
        role="dialog"
        aria-label={t('settings.title')}
        className={CARD_CLASS}
        onKeyDown={(event) => {
          if (event.key === 'Escape') onClose()
        }}
      >
        <p className="text-ink">{t('settings.title')}</p>

        <label className="mt-3 block text-xs text-ink-faint" htmlFor="settings-font-family">
          {t('settings.fontFamily')}
        </label>
        {/* 純下拉：直接挑，不能打字（打字後要先清空才能換，很煩）。空值＝系統預設等寬字，放第一個。 */}
        <select
          id="settings-font-family"
          ref={familyRef}
          value={family}
          aria-label={t('settings.fontFamily')}
          onChange={(event) => setFamily(event.target.value)}
          className={`${INPUT_CLASS} block w-full`}
        >
          <option value="">{t('settings.fontFamilyPlaceholder')}</option>
          {familyOptions.map((font) => (
            <option key={font} value={font}>
              {font}
            </option>
          ))}
        </select>

        <label className="mt-3 block text-xs text-ink-faint" htmlFor="settings-font-size">
          {t('settings.fontSize')}
        </label>
        <input
          id="settings-font-size"
          type="number"
          value={size}
          aria-label={t('settings.fontSize')}
          placeholder={t('settings.fontSizePlaceholder')}
          min={8}
          max={32}
          onChange={(event) => setSize(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
          className={`${INPUT_CLASS} block w-24`}
        />

        <label className="mt-3 block text-xs text-ink-faint" htmlFor="settings-line-height">
          {t('settings.lineHeight')}
        </label>
        <input
          id="settings-line-height"
          type="number"
          value={lineHeight}
          aria-label={t('settings.lineHeight')}
          placeholder={t('settings.lineHeightPlaceholder')}
          min={1}
          max={2}
          step={0.1}
          onChange={(event) => setLineHeight(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') save()
          }}
          className={`${INPUT_CLASS} block w-24`}
        />

        {/*
          GPU 加速的逃生口。**預設開啟** —— 這裡呈現的是「關掉它」的能力。
          自動降級只擋得住「渲染資源取不到」；擋不住「取得了、但驅動有缺陷而畫出錯的內容」——
          那不觸發任何事件，只有使用者看得出來，也只有他關得掉（見 `PreferencesProvider`）。
        */}
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={gpu}
            aria-label={t('settings.gpuAcceleration')}
            onChange={(event) => setGpu(event.target.checked)}
            className="accent-accent"
          />
          <span className="text-sm text-ink">{t('settings.gpuAcceleration')}</span>
        </label>
        <p className="mt-1 text-xs text-ink-faint">{t('settings.gpuAccelerationHint')}</p>

        {/*
          與 agent 的狀態橋接。**提示文字要說出「只影響其後建立或重建的 session」** ——
          注入發生在 spawn 當下，少了這句話，使用者切換後看不到變化會以為開關壞了。
        */}
        <label className="mt-3 flex items-center gap-2">
          <input
            type="checkbox"
            checked={agentStatus}
            aria-label={t('settings.agentStatus')}
            onChange={(event) => setAgentStatus(event.target.checked)}
            className="accent-accent"
          />
          <span className="text-sm text-ink">{t('settings.agentStatus')}</span>
        </label>
        <p className="mt-1 text-xs text-ink-faint">{t('settings.agentStatusHint')}</p>

        <p className="mt-3 block text-xs text-ink-faint">{t('settings.preview')}</p>
        <pre
          aria-label={t('settings.preview')}
          className="mt-1 overflow-x-auto whitespace-pre rounded border border-hairline bg-shell px-2 py-2 text-ink"
          // lineHeight 用當下輸入的值（與終端同源）—— preview 才代表得了終端裡的樣子。
          style={{
            fontFamily: previewFamily,
            fontSize: `${previewSize}px`,
            lineHeight: previewLineHeight,
          }}
        >
          {t('settings.previewSample')}
        </pre>

        <div className="mt-4 flex items-center justify-between gap-2">
          <button type="button" onClick={reset} className={`${BUTTON_CLASS} text-ink-faint`}>
            {t('settings.reset')}
          </button>
          <div className="flex gap-2">
            <button type="button" onClick={onClose} className={`${BUTTON_CLASS} text-ink-faint`}>
              {t('common.cancel')}
            </button>
            <button type="button" onClick={save} className={`${BUTTON_CLASS} text-accent`}>
              {t('settings.save')}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
