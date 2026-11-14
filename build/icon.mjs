// Renders build/icon.svg to build/icon.png (1024 px), which electron-builder turns into the
// macOS and Windows icons. Run after editing the SVG: npx electron build/icon.mjs
import { app, BrowserWindow } from 'electron'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1024, height: 1024, show: false, transparent: true, frame: false, webPreferences: { offscreen: true } })
  win.webContents.setFrameRate(1)
  const frame = new Promise((resolve) => win.webContents.on('paint', (_e, _dirty, image) => resolve(image)))
  await win.loadFile(join(import.meta.dirname, 'icon.svg'))
  const image = await frame
  writeFileSync(join(import.meta.dirname, 'icon.png'), image.resize({ width: 1024, height: 1024 }).toPNG())
  app.quit()
})
