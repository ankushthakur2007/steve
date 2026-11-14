// The board: a normal window showing AI-generated HTML visuals in a sandboxed iframe
// (no network, no Node, opaque origin). Bundled libraries are served from steve://lib/.
import { app, BrowserWindow, protocol } from 'electron'
import { readFile } from 'node:fs/promises'
import { extname, join, normalize, sep } from 'node:path'
import { parseSdf } from './sdf'
import { wrapVisual } from './visual'
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

export async function showVisual(title: string, html: string) {
  if (!board || board.isDestroyed()) {
    board = new BrowserWindow({ width: 980, height: 700, show: false, title: 'STEVE', backgroundColor: '#0f1115', webPreferences: { preload: PRELOAD } })
    // Visuals may only ever show their own srcdoc, never navigate to a website.
    board.webContents.on('will-frame-navigate', (e) => { if (!e.isMainFrame && e.url !== 'about:srcdoc') e.preventDefault() })
    ready = loadPage(board, 'board')
  }
  await ready
  currentVisual = title
  board.setTitle(`STEVE · ${title}`)
  board.webContents.send('visual', { title, doc: wrapVisual(html) })
  board.show()
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
<div style="position:fixed;top:12px;left:16px"><b style="font-size:18px">${json(name).slice(1, -1)}</b><div id="info" style="opacity:.8">Drag to rotate, scroll to zoom, click an atom.</div></div>
<script type="module">
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
const { atoms, bonds } = ${json(mol)}, name = ${json(name)}
const COLORS = { H: 0xffffff, C: 0x8a8a8a, N: 0x3050f8, O: 0xff0d0d, S: 0xffff30, P: 0xff8000, F: 0x90e050, Cl: 0x1ff01f, Br: 0xa62929, I: 0x940094 }
const NAMES = { H: 'hydrogen', C: 'carbon', N: 'nitrogen', O: 'oxygen', S: 'sulfur', P: 'phosphorus', F: 'fluorine', Cl: 'chlorine', Br: 'bromine', I: 'iodine' }
const scene = new THREE.Scene(), camera = new THREE.PerspectiveCamera(50, innerWidth / innerHeight, 0.1, 1000)
let renderer
try { renderer = new THREE.WebGLRenderer({ antialias: true }) } catch (e) {
  document.getElementById('info').textContent = '3D needs WebGL, which is not available on this computer (graphics driver blocked or missing).'
  throw e
}
renderer.setPixelRatio(devicePixelRatio); renderer.setSize(innerWidth, innerHeight)
document.body.appendChild(renderer.domElement)
scene.add(new THREE.HemisphereLight(0xffffff, 0x223344, 2.2)); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(5, 8, 10); scene.add(sun)
const center = atoms.reduce((c, a) => c.add(new THREE.Vector3(a.x, a.y, a.z)), new THREE.Vector3()).divideScalar(atoms.length)
const pos = atoms.map((a) => new THREE.Vector3(a.x, a.y, a.z).sub(center))
const meshes = atoms.map((a, i) => {
  const m = new THREE.Mesh(new THREE.SphereGeometry(a.el === 'H' ? 0.25 : 0.4, 32, 16), new THREE.MeshStandardMaterial({ color: COLORS[a.el] ?? 0xff66cc, roughness: 0.4 }))
  m.position.copy(pos[i]); m.userData.i = i; scene.add(m); return m
})
const up = new THREE.Vector3(0, 1, 0), bondMat = new THREE.MeshStandardMaterial({ color: 0xbbbbbb, roughness: 0.5 })
for (const b of bonds) {
  const p = pos[b.a], q = pos[b.b], len = p.distanceTo(q)
  const m = new THREE.Mesh(new THREE.CylinderGeometry(0.07 * Math.sqrt(b.order), 0.07 * Math.sqrt(b.order), len, 12), bondMat)
  m.position.copy(p).add(q).multiplyScalar(0.5); m.quaternion.setFromUnitVectors(up, q.clone().sub(p).normalize()); scene.add(m)
}
const radius = Math.max(...pos.map((p) => p.length()), 2)
camera.position.set(0, 0, radius * 3); const controls = new OrbitControls(camera, renderer.domElement); controls.enableDamping = true
const ray = new THREE.Raycaster(), mouse = new THREE.Vector2()
let picked = null
renderer.domElement.addEventListener('click', (e) => {
  mouse.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1); ray.setFromCamera(mouse, camera)
  const hit = ray.intersectObjects(meshes)[0]; if (!hit) return
  if (picked) picked.material.emissive.setHex(0); picked = hit.object; picked.material.emissive.setHex(0x335577)
  const i = picked.userData.i, el = atoms[i].el
  const nb = bonds.filter((b) => b.a === i || b.b === i).map((b) => atoms[b.a === i ? b.b : b.a].el)
  document.getElementById('info').textContent = (NAMES[el] ?? el) + ' atom #' + (i + 1) + ', bonded to ' + (nb.join(', ') || 'nothing')
  steve.select((NAMES[el] ?? el) + ' atom #' + (i + 1), 'in ' + name + ', bonded to ' + (nb.join(', ') || 'nothing'))
})
addEventListener('resize', () => { camera.aspect = innerWidth / innerHeight; camera.updateProjectionMatrix(); renderer.setSize(innerWidth, innerHeight) })
renderer.setAnimationLoop(() => { controls.update(); renderer.render(scene, camera) })
</script></body></html>`
}
