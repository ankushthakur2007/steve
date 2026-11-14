// The board: a borderless window that floats over the user's work and shows AI-generated HTML visuals
// in a sandboxed iframe (no network, no Node, opaque origin). 3D visuals have no background, so the
// model sits right on the screen. Bundled libraries and STEVE's 3D kit are served from steve://lib/.
import { app, BrowserWindow, dialog, protocol, screen } from 'electron'
import { readFile, writeFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import STAGE_JS from '../visual/steve3d.js?raw'
import { log } from './log'
import { parseSdf } from './sdf'
import { sceneHtml, usesStage, wrapVisual } from './visual'
import { loadPage, PRELOAD } from './windows'

protocol.registerSchemesAsPrivileged([
  { scheme: 'steve', privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true } },
])

const LIBS: Record<string, string> = { three: 'three', chart: 'chart.js/dist', mermaid: 'mermaid/dist', katex: 'katex/dist' }
const TYPES: Record<string, string> = {
  '.js': 'text/javascript', '.mjs': 'text/javascript', '.css': 'text/css', '.json': 'application/json',
  '.woff2': 'font/woff2', '.woff': 'font/woff', '.ttf': 'font/ttf',
}

export function registerLibProtocol() {
  protocol.handle('steve', async (req) => {
    const url = new URL(req.url) // steve://lib/three/build/three.module.js
    const [, lib, ...rest] = decodeURIComponent(url.pathname).split('/')
    if (url.host === 'lib' && lib === 'steve3d') return new Response(STAGE_JS, { headers: { 'content-type': 'text/javascript', 'access-control-allow-origin': '*' } })
    const root = LIBS[lib]
    if (url.host !== 'lib' || !root) return new Response('Not found', { status: 404 })
    const base = join(app.getAppPath(), 'node_modules', root)
    const file = normalize(join(base, ...rest))
    if (!file.startsWith(base + sep)) return new Response('Forbidden', { status: 403 })
    try {
      const body = await readFile(file)
      return new Response(body, {
        headers: { 'content-type': TYPES[extname(file)] ?? 'application/octet-stream', 'access-control-allow-origin': '*' },
      })
    } catch {
      return new Response('Not found', { status: 404 })
    }
  })
}

let board: BrowserWindow | null = null
let ready: Promise<unknown> = Promise.resolve()
export let currentVisual = ''

// Every visual made this session, for back/forward and Save.
// shortcut: kept in memory only, so the gallery empties when STEVE quits; store them on disk if people want them back.
const visuals: { title: string; html: string }[] = []
let shown = -1

export async function showVisual(title: string, html: string) {
  visuals.push({ title, html })
  if (visuals.length > 50) visuals.shift()
  await present(visuals.length - 1)
}

const SIZES = [{ width: 720, height: 560 }, { width: 1100, height: 780 }]
let big = false

/** Puts the board on the side of the cursor's screen away from the cursor, where the user isn't working. */
function place(win: BrowserWindow, keepCenter = false) {
  const cursor = screen.getCursorScreenPoint()
  const old = win.getBounds()
  const area = (keepCenter ? screen.getDisplayMatching(old) : screen.getDisplayNearestPoint(cursor)).workArea
  const width = Math.min(SIZES[+big].width, area.width), height = Math.min(SIZES[+big].height, area.height)
  let x = cursor.x < area.x + area.width / 2 ? area.x + area.width - width - 40 : area.x + 40
  let y = area.y + (area.height - height) / 2
  if (keepCenter) { x = old.x + (old.width - width) / 2; y = old.y + (old.height - height) / 2 }
  x = Math.max(area.x, Math.min(x, area.x + area.width - width))
  y = Math.max(area.y, Math.min(y, area.y + area.height - height))
  win.setBounds({ x: Math.round(x), y: Math.round(y), width, height })
}

/** The board window, created on first use and placed beside the user's work when it isn't showing. */
async function openBoard(): Promise<BrowserWindow> {
  if (!board || board.isDestroyed()) {
    board = new BrowserWindow({
      ...SIZES[0], show: false, frame: false, transparent: true, hasShadow: false, alwaysOnTop: true, skipTaskbar: true,
      minWidth: 360, minHeight: 300, title: 'STEVE', webPreferences: { preload: PRELOAD },
    })
    board.setAlwaysOnTop(true, 'floating')
    // macOS: otherwise the window stays on the desktop (Space) where it first opened, and never shows over a
    // full-screen app, so a visual made while you're elsewhere is invisible to you.
    if (process.platform === 'darwin') board.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true, skipTransformProcessType: true })
    // Visuals may only ever show their own srcdoc, never navigate to a website.
    board.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame && e.url !== 'about:srcdoc') e.preventDefault() })
    ready = loadPage(board, 'board')
  }
  await ready
  if (!board.isVisible()) place(board)
  return board
}

// ---------- 3D scenes stream in: the board loads the kit's player, then each line is drawn on arrival ----------
let sceneId = ''

/** Opens the board on an empty 3D player that draws the scene's lines as they are sent. */
export async function startScene(title: string, id: string) {
  const b = await openBoard()
  sceneId = id
  currentVisual = title
  b.setTitle(title)
  log('board', `drawing "${title}" as it streams`, { bounds: b.getBounds() })
  b.webContents.send('scene-start', { title, id, doc: wrapVisual(sceneHtml([], id)) })
  b.showInactive()
}

export function sceneLine(id: string, line: string) {
  if (board && !board.isDestroyed()) board.webContents.send('scene-line', { id, line })
}

/** The scene is complete: keep it for back/forward and Save, and let the player add its tour. */
export function endScene(id: string, title: string, lines: string[]) {
  visuals.push({ title, html: sceneHtml(lines) })
  if (visuals.length > 50) visuals.shift()
  if (!board || board.isDestroyed()) return
  board.webContents.send('scene-end', { id })
  if (sceneId !== id) return // another visual is on the board by now
  shown = visuals.length - 1
  board.webContents.send('visual-meta', { index: shown, titles: visuals.map((v) => v.title) })
}

/** Shows the board straight away with "Making ..." while the model writes the visual, which can take a while. */
export async function showMaking(title: string) {
  const b = await openBoard()
  sceneId = ''
  log('board', `making "${title}"…`, { bounds: b.getBounds() })
  b.webContents.send('making', title)
  b.showInactive()
}

/** The visual could not be made: say why on the board, or (when interrupted) go back to what was showing. */
export function visualFailed(message: string | null) {
  if (!board || board.isDestroyed()) return
  log('board', message ?? 'making the visual was interrupted')
  if (message) board.webContents.send('failed', message)
  else if (visuals[shown]) void present(shown)
  else board.hide()
}

async function present(i: number) {
  const b = await openBoard()
  sceneId = ''
  const { title, html } = visuals[i]
  shown = i
  currentVisual = title
  b.setTitle(title)
  log('board', `showing "${title}" (${i + 1} of ${visuals.length})`, { kit: usesStage(html), bounds: b.getBounds(), visible: b.isVisible() })
  b.webContents.send('visual', { title, doc: wrapVisual(html), clear: usesStage(html), index: i, titles: visuals.map((v) => v.title) })
  b.showInactive() // keep the keyboard in the app the user is working in
}

export const hideBoard = () => { log('board', 'closed'); board?.hide() }
/** Toggles between the normal and the large size, around the same centre. */
export function resizeBoard() {
  if (!board || board.isDestroyed()) return
  big = !big
  place(board, true)
  log('board', big ? 'bigger' : 'smaller', board.getBounds())
}

export const goVisual = (i: number) => { if (Number.isInteger(i) && visuals[i]) void present(i) }

/** Asks where to save the visual on screen and writes a copy that opens in any browser. */
export async function saveVisual(): Promise<string | null> {
  const v = visuals[shown]
  if (!v || !board) return null
  const name = v.title.replace(/[\\/:*?"<>|]+/g, ' ').trim() || 'Visual'
  const { canceled, filePath } = await dialog.showSaveDialog(board, {
    defaultPath: join(app.getPath('documents'), `${name}.html`),
    filters: [{ name: 'Web page', extensions: ['html'] }],
  })
  if (canceled || !filePath) return null
  await writeFile(filePath, wrapVisual(v.html, await cdnLinks()))
  return filePath
}

/** The bundled libraries' exact versions on jsDelivr, so a saved visual looks the same in a browser. */
async function cdnLinks() {
  const version = async (pkg: string) => JSON.parse(await readFile(join(app.getAppPath(), 'node_modules', pkg, 'package.json'), 'utf8')).version
  const cdn: Record<string, string> = {}
  for (const [lib, path] of Object.entries(LIBS)) {
    const [pkg, ...rest] = path.split('/')
    cdn[lib] = `https://cdn.jsdelivr.net/npm/${pkg}@${await version(pkg)}/${rest.map((p) => p + '/').join('')}`
  }
  cdn.steve3d = `data:text/javascript;base64,${Buffer.from(STAGE_JS).toString('base64')}`
  return cdn
}

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/** A ready-made 3D viewer for a molecule from PubChem (free, no key). */
export async function moleculeHtml(name: string): Promise<string> {
  const url = (kind: string) =>
    `https://pubchem.ncbi.nlm.nih.gov/rest/pug/compound/name/${encodeURIComponent(name)}/SDF?record_type=${kind}`
  let res = await fetch(url('3d'))
  if (!res.ok) res = await fetch(url('2d'))
  if (!res.ok) throw new Error(`PubChem has no structure for "${name}".`)
  const mol = parseSdf(await res.text())
  return `<!doctype html><html><body>
<script type="module">
import { stage } from 'steve3d'
const { atoms, bonds } = ${json(mol)}, name = ${json(name)}
const COLORS = { H: 0xf4f4f1, C: 0x55595f, N: 0x3b6fe0, O: 0xe2463e, S: 0xf3c94c, P: 0xf0954a, F: 0x5bb48a, Cl: 0x3fae5a, Br: 0xa64036, I: 0x7c4bb0 }
const NAMES = { H: 'hydrogen', C: 'carbon', N: 'nitrogen', O: 'oxygen', S: 'sulfur', P: 'phosphorus', F: 'fluorine', Cl: 'chlorine', Br: 'bromine', I: 'iodine' }
const s = stage({ intro: 'grow' }), { THREE } = s
const pos = atoms.map((a) => new THREE.Vector3(a.x, a.y, a.z))
const neighbours = (i) => bonds.filter((b) => b.a === i || b.b === i).map((b) => NAMES[atoms[b.a === i ? b.b : b.a].el] ?? atoms[b.a === i ? b.b : b.a].el)
atoms.forEach((a, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(a.el === 'H' ? 0.25 : 0.4, 48, 24), s.mat(COLORS[a.el] ?? 0xe68fb0, { roughness: 0.3 }))
  m.position.copy(pos[i])
  const el = NAMES[a.el] ?? a.el
  s.part(el + ' atom #' + (i + 1), m, { info: 'in ' + name + ', bonded to ' + (neighbours(i).join(', ') || 'nothing') })
})
const up = new THREE.Vector3(0, 1, 0), bondMat = s.mat('aluminium', { roughness: 0.45 })
for (const b of bonds) {
  const p = pos[b.a], q = pos[b.b], r = 0.07 * Math.sqrt(b.order)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(r, r, p.distanceTo(q), 16), bondMat)
  m.position.copy(p).add(q).multiplyScalar(0.5)
  m.quaternion.setFromUnitVectors(up, q.clone().sub(p).normalize())
  m.castShadow = m.receiveShadow = true
  s.model.add(m)
}
</script></body></html>`
}
