import { contextBridge, ipcRenderer } from 'electron'

// The only bridge between STEVE's own pages and the main process. Untrusted visuals run in a
// sandboxed iframe that has no access to this object.
contextBridge.exposeInMainWorld('steve', {
  send: (channel: string, ...args: unknown[]) => ipcRenderer.send(channel, ...args),
  invoke: (channel: string, ...args: unknown[]) => ipcRenderer.invoke(channel, ...args),
  on: (channel: string, cb: (...args: any[]) => void) => { ipcRenderer.on(channel, (_e, ...args) => cb(...args)) },
})
