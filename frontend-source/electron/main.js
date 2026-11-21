import { app, BrowserWindow, ipcMain, session } from 'electron'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

const PORT = 5173
const DEV_URL = `http://localhost:${PORT}`
const API_ORIGIN = 'https://system-payroll-api.automation-payroll.workers.dev'
const ADMIN_REGISTRATION_FILE = 'admin-registration-state'
const SETTINGS_FILE = 'app-settings.json'

let win
let allowWindowClose = false
let preparingWindowClose = false

async function readSettings() {
  const settingsPath = path.join(app.getPath('userData'), SETTINGS_FILE)

  try {
    const settings = JSON.parse(await readFile(settingsPath, 'utf8'))
    return {
      stayLoggedIn:
        typeof settings.stayLoggedIn === 'boolean' ? settings.stayLoggedIn : true,
    }
  } catch (error) {
    if (error.code === 'ENOENT') return { stayLoggedIn: true }
    throw error
  }
}

async function writeSettings(settings) {
  const userDataPath = app.getPath('userData')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    path.join(userDataPath, SETTINGS_FILE),
    JSON.stringify(settings),
    { mode: 0o600 },
  )
}

function createWindow() {
  win = new BrowserWindow({
    width: 1200,
    height: 700,
    frame: false,
    webPreferences: {
      partition: 'persist:default',
      preload: path.join(__dirname, 'preload.cjs'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false, // required for an ESM preload script
    },
  })

  win.webContents.on('preload-error', (_event, preloadPath, error) => {
    console.error(`Failed to load Electron preload "${preloadPath}":`, error)
  })

  if (!app.isPackaged) {
    win.loadURL(DEV_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }

  win.on('maximize', () => win.webContents.send('window:maximized', true))
  win.on('unmaximize', () => win.webContents.send('window:maximized', false))
  win.on('close', (event) => {
    if (allowWindowClose) return

    event.preventDefault()
    requestWindowClose().catch((error) => {
      console.error('Could not close the app window:', error)
    })
  })
}

async function requestWindowClose() {
  if (!win || win.isDestroyed() || preparingWindowClose) return

  preparingWindowClose = true
  try {
    const { stayLoggedIn } = await readSettings()
    if (stayLoggedIn) {
      allowWindowClose = true
      preparingWindowClose = false
      win.close()
      return
    }

    win.webContents.send('auth:prepare-close')
  } catch (error) {
    preparingWindowClose = false
    win.webContents.send(
      'auth:close-failed',
      error instanceof Error ? error.message : 'Could not read app settings.',
    )
    throw error
  }
}

ipcMain.on('window:minimize', () => win?.minimize())
ipcMain.on('window:maximize', () => {
  if (!win) return
  win.isMaximized() ? win.unmaximize() : win.maximize()
})
ipcMain.handle('window:close', requestWindowClose)
ipcMain.on('auth:close-ready', () => {
  allowWindowClose = true
  preparingWindowClose = false
  win?.close()
})
ipcMain.on('auth:close-failed', (_event, message) => {
  preparingWindowClose = false
  win?.webContents.send(
    'auth:close-failed',
    typeof message === 'string' ? message : 'Could not log out before closing.',
  )
})
ipcMain.handle('settings:get', readSettings)
ipcMain.handle('settings:set-stay-logged-in', async (_event, stayLoggedIn) => {
  if (typeof stayLoggedIn !== 'boolean') {
    throw new TypeError('Stay logged in setting must be a boolean.')
  }

  const settings = await readSettings()
  await writeSettings({ ...settings, stayLoggedIn })
})
ipcMain.handle('auth:get-admin-registered', async () => {
  const markerPath = path.join(app.getPath('userData'), ADMIN_REGISTRATION_FILE)

  try {
    return (await readFile(markerPath, 'utf8')) === 'registered'
  } catch (error) {
    if (error.code === 'ENOENT') return false
    throw error
  }
})
ipcMain.handle('auth:mark-admin-registered', async () => {
  const userDataPath = app.getPath('userData')
  await mkdir(userDataPath, { recursive: true })
  await writeFile(
    path.join(userDataPath, ADMIN_REGISTRATION_FILE),
    'registered',
    { mode: 0o600 },
  )
})

app.whenReady().then(() => {
  const authSession = session.fromPartition('persist:default')
  authSession.webRequest.onBeforeSendHeaders(
    { urls: [`${API_ORIGIN}/*`] },
    (details, callback) => {
      const headers = { ...details.requestHeaders }
      headers.Origin = API_ORIGIN
      headers.Referer = `${API_ORIGIN}/`
      callback({ requestHeaders: headers })
    },
  )

  createWindow()
})

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit()
})