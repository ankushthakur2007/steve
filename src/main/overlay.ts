// One transparent, always-on-top, fully click-through window per display.
// It never takes mouse input; all interactive UI lives in normal windows.
import { BrowserWindow, screen, type Display } from 'electron'
import type { Shot } from './capture'
import { imageToLocal, imageToLocalSize } from './coords'
import type { Tag } from './tags'
import { loadPage, PRELOAD } from './windows'

const overlays = new Map<number, BrowserWindow>()
let cursorDisplay = -1
let lastCursor = ''

function makeOverlay(d: Display) {
  const win = new BrowserWindow({
    ...d.bounds,
    transparent: true,
    frame: false,
    focusable: false,
    skipTaskbar: true,
    hasShadow: false,
    resizable: false,
    movable: false,
    alwaysOnTop: true,
    enableLargerThanScreen: true,
    show: false,
    ...(process.platform === 'darwin' ? { type: 'panel' } : {}), // NSPanel can float over fullscreen apps
    webPreferences: { preload: PRELOAD },
  })
  win.setIgnoreMouseEvents(true)
  win.setAlwaysOnTop(true, 'screen-saver')
  win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true })
  win.setContentProtection(true) // keep STEVE's own drawings out of its screenshots
  win.once('ready-to-show', () => win.showInactive())
  loadPage(win, 'overlay')
  return win
}

function rebuild() {
  overlays.forEach((w) => w.destroy())
  overlays.clear()
  for (const d of screen.getAllDisplays()) overlays.set(d.id, makeOverlay(d))
  cursorDisplay = -1
  lastCursor = ''
}

function trackCursor() {
  const p = screen.getCursorScreenPoint()
  const key = `${p.x},${p.y}`
  if (key === lastCursor) return
  lastCursor = key
  const d = screen.getDisplayNearestPoint(p)
  if (d.id !== cursorDisplay) { toOverlay(cursorDisplay, 'cursor', null); cursorDisplay = d.id }
  toOverlay(d.id, 'cursor', { x: p.x - d.bounds.x, y: p.y - d.bounds.y })
}

export function createOverlays() {
  rebuild()
  screen.on('display-added', rebuild)
  screen.on('display-removed', rebuild)
  screen.on('display-metrics-changed', (_e, d) => overlays.get(d.id)?.setBounds(d.bounds))
  setInterval(trackCursor, 16)
}

export function toOverlay(displayId: number, channel: string, payload?: unknown) {
  const w = overlays.get(displayId)
  if (w && !w.isDestroyed()) w.webContents.send(channel, payload)
}

export function toOverlays(channel: string, payload?: unknown) {
  overlays.forEach((_w, id) => toOverlay(id, channel, payload))
}

/** Converts tags from screenshot pixels to the overlay's coordinates and draws them on the screenshot's display. */
export function draw(tags: Tag[], shot: Shot) {
  const at = (x: number, y: number) => imageToLocal({ x, y }, shot, shot.bounds)
  const shapes = tags.map((t) => {
    switch (t.kind) {
      case 'point': return { ...t, ...at(t.x, t.y) }
      case 'label': return { ...t, ...at(t.x, t.y) }
      case 'box': {
        const s = imageToLocalSize({ width: t.w, height: t.h }, shot, shot.bounds)
        return { ...t, ...at(t.x, t.y), w: s.width, h: s.height }
      }
      case 'arrow': {
        const a = at(t.x1, t.y1), b = at(t.x2, t.y2)
        return { ...t, x1: a.x, y1: a.y, x2: b.x, y2: b.y }
      }
      default: return t
    }
  })
  if (shapes.length) toOverlay(shot.displayId, 'draw', shapes)
}
