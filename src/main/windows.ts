import type { BrowserWindow } from 'electron'
import { join } from 'node:path'

export const PRELOAD = join(import.meta.dirname, '../preload/index.cjs')

export function loadPage(win: BrowserWindow, name: string) {
  const dev = process.env.ELECTRON_RENDERER_URL
  return dev ? win.loadURL(`${dev}/${name}.html`) : win.loadFile(join(import.meta.dirname, `../renderer/${name}.html`))
}

export const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))
export const errorText = (e: unknown) => (e instanceof Error ? e.message : String(e))
