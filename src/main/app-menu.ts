import { t } from '@shared/i18n'

/**
 * The application menu, per platform (`workspace-app-shell`: "應用程式視窗不呈現原生 menu bar", and its
 * macOS exception).
 *
 * - **Linux and Windows: none.** The app defines no menu content there, and an empty bar would only cover
 *   the window — `null` removes it entirely (not `autoHideMenuBar`, which still surfaces on `Alt`).
 * - **macOS: the minimal menu.** There the menu bar belongs to the system, not the window, and the standard
 *   text-editing shortcuts (`Cmd+C`, `Cmd+V`, `Cmd+X`, `Cmd+A`, undo, redo) and `Cmd+Q` come from its items.
 *   Without an Edit menu, copy and paste stop working in ordinary text fields.
 *
 * Two deliberate absences on macOS:
 * - **No Quit role.** The role quits through `before-quit` first, which the close guard reads as a quit
 *   that did not start with the window, and it would end every running session without asking. Quit is a
 *   custom item that closes the window first (`close-guard.ts`, `closeForQuit`).
 * - **No Window menu and no `Cmd+W`.** Closing the window ends every session; one key for that is not
 *   offered. `Ctrl+Shift+W` closes a session, as on Linux.
 *
 * **No Electron import**, so the template is unit-tested as data (`app-menu.test.ts`). Every label comes
 * from the dictionaries — the menu is drawn by the operating system, outside the window, which is exactly
 * where a hard-coded label would go unnoticed (`ui-localization`, the sixth kind of user-visible copy).
 */

/** The part of Electron's `MenuItemConstructorOptions` this menu uses. */
export interface MenuItemSpec {
  label?: string
  role?: 'about' | 'hide' | 'hideOthers' | 'unhide' | 'undo' | 'redo' | 'cut' | 'copy' | 'paste' | 'selectAll'
  accelerator?: string
  type?: 'separator'
  click?: () => void
  submenu?: MenuItemSpec[]
}

export interface MenuOptions {
  platform: NodeJS.Platform
  /** The name the system shows for the application (the bundle's name, `productName`). */
  appName: string
  /** The Quit item: close the window first, then quit (or quit at once with no window). */
  onQuit: () => void
}

/** The menu template for this platform, or `null` for no menu at all. */
export function applicationMenuTemplate({ platform, appName, onQuit }: MenuOptions): MenuItemSpec[] | null {
  if (platform !== 'darwin') return null
  const name = { name: appName }
  return [
    {
      // The application menu's own title is the bundle's name; the system draws it and ignores this label.
      label: appName,
      submenu: [
        { role: 'about', label: t('appMenu.about', name) },
        { type: 'separator' },
        { role: 'hide', label: t('appMenu.hide', name) },
        { role: 'hideOthers', label: t('appMenu.hideOthers') },
        { role: 'unhide', label: t('appMenu.showAll') },
        { type: 'separator' },
        { label: t('appMenu.quit', name), accelerator: 'Command+Q', click: onQuit },
      ],
    },
    {
      label: t('appMenu.edit'),
      submenu: [
        { role: 'undo', label: t('appMenu.undo') },
        { role: 'redo', label: t('appMenu.redo') },
        { type: 'separator' },
        { role: 'cut', label: t('appMenu.cut') },
        { role: 'copy', label: t('appMenu.copy') },
        { role: 'paste', label: t('appMenu.paste') },
        { role: 'selectAll', label: t('appMenu.selectAll') },
      ],
    },
  ]
}
