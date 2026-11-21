import { contextBridge, ipcRenderer } from 'electron'

contextBridge.exposeInMainWorld('windowControls', {
  minimize: () => ipcRenderer.send('window:minimize'),
  maximize: () => ipcRenderer.send('window:maximize'),
  close: () => ipcRenderer.invoke('window:close'),
  onMaximizeChange: (cb) => {
    const handler = (_e, isMax) => cb(isMax)
    ipcRenderer.on('window:maximized', handler)
    return () => ipcRenderer.removeListener('window:maximized', handler)
  },
  getAdminRegistered: () => ipcRenderer.invoke('auth:get-admin-registered'),
  markAdminRegistered: () => ipcRenderer.invoke('auth:mark-admin-registered'),
  getSettings: () => ipcRenderer.invoke('settings:get'),
  setStayLoggedIn: (enabled) =>
    ipcRenderer.invoke('settings:set-stay-logged-in', enabled),
  onPrepareClose: (cb) => {
    const handler = () => cb()
    ipcRenderer.on('auth:prepare-close', handler)
    return () => ipcRenderer.removeListener('auth:prepare-close', handler)
  },
  onCloseFailed: (cb) => {
    const handler = (_event, message) => cb(message)
    ipcRenderer.on('auth:close-failed', handler)
    return () => ipcRenderer.removeListener('auth:close-failed', handler)
  },
  closeReady: () => ipcRenderer.send('auth:close-ready'),
  closeFailed: (message) => ipcRenderer.send('auth:close-failed', message),
})