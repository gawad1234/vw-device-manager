import { app, shell, BrowserWindow, ipcMain } from 'electron'
import { join } from 'path'
import { electronApp, optimizer, is } from '@electron-toolkit/utils'
import icon from '../../resources/icon.png?asset'
import { openStartupProject } from './projects'
import { ensureLibrary } from './library'
import { getDataVersion } from './db'
import { initUpdater } from './updater'
import { registerIpcHandlers } from './ipc'

function createWindow(): void {
  // Create the browser window.
  const mainWindow = new BrowserWindow({
    width: 900,
    height: 670,
    show: false,
    autoHideMenuBar: true,
    ...(process.platform === 'linux' ? { icon } : {}),
    webPreferences: {
      preload: join(__dirname, '../preload/index.js'),
      sandbox: false
    }
  })

  mainWindow.on('ready-to-show', () => {
    mainWindow.show()
  })

  mainWindow.webContents.setWindowOpenHandler((details) => {
    shell.openExternal(details.url)
    return { action: 'deny' }
  })

  // Auto-refresh: `PRAGMA data_version` bumps only when ANOTHER connection (a
  // Vectorworks script) commits — never for our own writes — so this detects
  // external edits without a self-refresh loop. Poll while focused, and re-check
  // whenever the window regains focus (e.g. switching back from Vectorworks).
  let lastDataVersion = -1
  const checkExternalChanges = (): void => {
    try {
      const v = getDataVersion()
      if (lastDataVersion !== -1 && v !== lastDataVersion && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('data-changed')
      }
      lastDataVersion = v
    } catch {
      /* db not ready or mid project-switch */
    }
  }
  const poll = setInterval(() => {
    if (mainWindow.isFocused()) checkExternalChanges()
  }, 1500)
  mainWindow.on('focus', checkExternalChanges)
  mainWindow.on('closed', () => clearInterval(poll))

  // Check GitHub Releases for a newer version (packaged builds only).
  initUpdater(mainWindow)

  // HMR for renderer base on electron-vite cli.
  // Load the remote URL for development or the local html file for production.
  if (is.dev && process.env['ELECTRON_RENDERER_URL']) {
    mainWindow.loadURL(process.env['ELECTRON_RENDERER_URL'])
  } else {
    mainWindow.loadFile(join(__dirname, '../renderer/index.html'))
  }
}

// This method will be called when Electron has finished
// initialization and is ready to create browser windows.
// Some APIs can only be used after this event occurs.
app.whenReady().then(async () => {
  // Set app user model id for windows
  electronApp.setAppUserModelId('com.electron')

  // Default open or close DevTools by F12 in development
  // and ignore CommandOrControl + R in production.
  // see https://github.com/alex8088/electron-toolkit/tree/master/packages/utils
  app.on('browser-window-created', (_, window) => {
    optimizer.watchWindowShortcuts(window)
  })

  // IPC test
  ipcMain.on('ping', () => console.log('pong'))

  await openStartupProject()
  await ensureLibrary() // create/seed the shared cable-type + signal library once
  registerIpcHandlers()

  createWindow()

  app.on('activate', function () {
    // On macOS it's common to re-create a window in the app when the
    // dock icon is clicked and there are no other windows open.
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

// Quit when all windows are closed, except on macOS. There, it's common
// for applications and their menu bar to stay active until the user quits
// explicitly with Cmd + Q.
app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit()
  }
})

// In this file you can include the rest of your app's specific main process
// code. You can also put them in separate files and require them here.
