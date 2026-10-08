/**
 * A bare Electron window on one local HTML file — what the website's capture script uses to show the
 * static spek page it builds (`scripts/capture-screenshots.mjs`, spek shots). The file is the last
 * argument; the capture drives the window over the remote debugging port like the app's.
 */
import { app, BrowserWindow } from 'electron'

const file = process.argv[process.argv.length - 1]

app.whenReady().then(() => {
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    webPreferences: { sandbox: true, contextIsolation: true, nodeIntegration: false },
  })
  window.loadFile(file)
})

app.on('window-all-closed', () => app.quit())
