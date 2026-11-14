// STEVE's 3D kit for AI-made visuals. It owns everything that makes a scene look finished (studio
// lighting, materials, soft shadows, camera framing, an assembling intro) and everything that makes
// it explain (named clickable parts, tag labels, arrows, cutaways, camera moves, exploded views,
// guided tours), so the model only has to build the object.
// Runs inside the sandboxed visual as the bare module 'steve3d' (served by src/main/board.ts).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'

export { THREE }

const v3 = (p) => (p?.isVector3 ? p.clone() : new THREE.Vector3(...(p ?? [0, 0, 0])))
const isPoint = (p) => p?.isVector3 || (Array.isArray(p) && typeof p[0] === 'number')

/** Anything round (hubs, nozzles, bottles, bolts): profile is [[radius, y], ...] from bottom to top. */
export const lathe = (profile, segments = 64) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments)
export const roundedBox = (w, h, d, r = Math.min(w, h, d) * 0.12) => new RoundedBoxGeometry(w, h, d, 4, r)
export const tube = (points, radius = 0.05, closed = false) =>
  new THREE.TubeGeometry(new THREE.CatmullRomCurve3(points.map(v3), closed), Math.max(48, points.length * 16), radius, 16, closed)

// [colour, metalness, roughness]
const MATS = {
  steel: [0xb9c0c8, 1, 0.32], aluminium: [0xd6dadf, 1, 0.42], aluminum: [0xd6dadf, 1, 0.42], iron: [0x5a5f66, 0.9, 0.55],
  chrome: [0xf2f2f2, 1, 0.08], brass: [0xd2a64c, 1, 0.33], copper: [0xc97b4c, 1, 0.33], gold: [0xe6b94f, 1, 0.22],
  plastic: [0xedede8, 0, 0.42], rubber: [0x2b2c30, 0, 0.88], clay: [0xe8e2d6, 0, 0.82], wood: [0xb3834f, 0, 0.72],
  pcb: [0x2e7d55, 0, 0.5], concrete: [0xb9b6ae, 0, 0.9], bone: [0xeee3cc, 0, 0.6], muscle: [0xd9776f, 0, 0.55], white: [0xf4f4f1, 0, 0.5], black: [0x2a2b2f, 0, 0.5],
  red: [0xe2615a, 0, 0.5], orange: [0xf0954a, 0, 0.5], yellow: [0xf3c94c, 0, 0.5], green: [0x5bb48a, 0, 0.5],
  teal: [0x46b2ae, 0, 0.5], blue: [0x5b8fd9, 0, 0.5], purple: [0x9478d6, 0, 0.5], pink: [0xe68fb0, 0, 0.5],
}
// Tag and arrow colours: [fill, line, text]
const INK = {
  green: ['#cdf2da', '#2f9e5b', '#0f3d22'], yellow: ['#fff1b8', '#e0a800', '#4a3800'], blue: ['#d3e3ff', '#3b7be0', '#0d2c5c'],
  pink: ['#ffd6e3', '#e0457b', '#5c0d2a'], orange: ['#ffdfc6', '#ea7a2c', '#5c2a05'], purple: ['#e5dbff', '#7c5cdb', '#2b1a66'],
  teal: ['#ccf2ef', '#1f9e98', '#0b3d3b'], red: ['#ffd5d3', '#e0443e', '#5c0d0b'],
}
const CYCLE = Object.keys(INK)

const CSS = `html,body{overflow:hidden}canvas{display:block}
.s3d-labels{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.s3d-labels svg{position:absolute;inset:0;width:100%;height:100%}
.s3d-tag{position:absolute;left:0;top:0;pointer-events:auto;cursor:pointer;font:600 12px/1.2 system-ui,sans-serif;padding:4px 9px;border-radius:7px;background:var(--bg);color:var(--ink);border:1.5px solid var(--line);box-shadow:0 2px 8px #0005;white-space:nowrap;user-select:none}
.s3d-tip{position:fixed;z-index:2;pointer-events:none;font:600 12px/1.2 system-ui,sans-serif;padding:4px 9px;border-radius:7px;background:#221f2ef0;color:#fff;transform:translate(14px,14px)}
.s3d-error{position:fixed;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:10px;background:#221f2e;color:#fff;font:14px/1.4 system-ui,sans-serif}`

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
const easeOut = (k) => 1 - (1 - k) ** 3

/**
 * Sets up the scene. Options: background (CSS colour; default transparent so the model floats on the
 * user's screen), intro ('assemble' | 'grow' | false), view ([x, y, z] direction the camera looks from).
 */
export function stage(opts = {}) {
  const { background = null, intro = 'assemble', view = [1, 0.55, 1.35] } = opts
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches
  document.head.append(Object.assign(document.createElement('style'), { textContent: CSS }))
  for (const el of [document.documentElement, document.body]) el.style.background = background ?? 'transparent'
  // Every problem is shown on the visual (a transparent window would otherwise just look empty) and
  // printed to the console, which STEVE's debug log records.
  const fail = (msg) => {
    console.error('[3D] ' + msg)
    parent.postMessage({ type: 'steve-stage-failed' }, '*')
    if (document.querySelector('.s3d-error')) return
    document.body.append(Object.assign(document.createElement('p'), { className: 's3d-error', textContent: msg }))
  }
  addEventListener('error', (e) => fail(`This visual hit an error: ${e.message}`))

  const scene = new THREE.Scene()
  const camera = new THREE.PerspectiveCamera(35, innerWidth / innerHeight, 0.01, 1000)
  let renderer
  try { renderer = new THREE.WebGLRenderer({ antialias: true, alpha: true }) } catch (e) {
    fail("3D needs WebGL, which this computer's graphics driver doesn't provide.")
    throw e
  }
  renderer.setPixelRatio(Math.min(devicePixelRatio, 2))
  renderer.setSize(innerWidth, innerHeight)
  renderer.setClearColor(0x000000, 0)
  renderer.toneMapping = THREE.NeutralToneMapping
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap
  renderer.localClippingEnabled = true
  document.body.append(renderer.domElement)
  const gl = renderer.getContext(), gpuInfo = gl.getExtension('WEBGL_debug_renderer_info')
  const gpu = gpuInfo ? gl.getParameter(gpuInfo.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
  // Laptops that switch graphics chips, or a busy GPU, can drop the 3D drawing.
  renderer.domElement.addEventListener('webglcontextlost', (e) => {
    e.preventDefault() // lets the browser restore it
    fail('The graphics card stopped the 3D drawing. Close this and ask STEVE to show it again.')
  })
  renderer.domElement.addEventListener('webglcontextrestored', () => { console.info('[3D] graphics restored'); document.querySelector('.s3d-error')?.remove() })
  // Tags are laid out on screen each frame (not in 3D) so they can be kept apart and inside the window.
  const NS = 'http://www.w3.org/2000/svg'
  const layer = Object.assign(document.createElement('div'), { className: 's3d-labels' })
  const lines = document.createElementNS(NS, 'svg')
  layer.append(lines)
  document.body.append(layer)

  // Studio lighting: a soft room for reflections plus one shadow-casting key light. Without a real
  // graphics chip (software rendering) the room takes seconds to prepare, so a tiny sky gradient stands in.
  const software = /swiftshader|llvmpipe|softpipe|software|basic render/i.test(gpu)
  if (software) {
    const px = new Uint8Array(32 * 16 * 4)
    for (let y = 0; y < 16; y++) {
      const v = Math.round(255 * (1 - 0.65 * (y / 15))) // bright above, darker below
      for (let x = 0; x < 32; x++) px.set([v, v, v, 255], (y * 32 + x) * 4)
    }
    const sky = new THREE.DataTexture(px, 32, 16)
    sky.mapping = THREE.EquirectangularReflectionMapping
    sky.colorSpace = THREE.SRGBColorSpace
    sky.needsUpdate = true
    scene.environment = sky
  } else scene.environment = new THREE.PMREMGenerator(renderer).fromScene(new RoomEnvironment(), 0.04, 0.1, 100, { size: 128 }).texture
  const key = new THREE.DirectionalLight(0xffffff, 1.4)
  key.castShadow = true
  key.shadow.mapSize.set(2048, 2048)
  key.shadow.bias = -0.0004
  key.shadow.radius = 4
  scene.add(key, key.target)

  const model = new THREE.Group() // everything the visual builds; cut and exploded
  const notes = new THREE.Group() // arrows; never cut
  scene.add(model, notes)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.autoRotate = !reduced
  controls.autoRotateSpeed = 0.7
  controls.addEventListener('start', () => (controls.autoRotate = false))

  const parts = [], labels = [], tweens = [], frameFns = []
  let center = new THREE.Vector3(), size = 1, laidOut = false, pendingStep = null
  const cutPlane = new THREE.Plane(new THREE.Vector3(0, 0, -1), 1e9)
  let cutOn = false
  const glowing = new Set()
  let hovered = null

  const find = (t) => {
    if (t == null) return null
    if (t.isObject3D) return t
    const n = String(t).toLowerCase()
    return parts.find((p) => p.name.toLowerCase() === n)?.object ?? model.getObjectByName(String(t)) ?? null
  }
  const boxOf = (o) => new THREE.Box3().setFromObject(o)
  const tween = (ms, fn, delay = 0) => {
    if (reduced || ms <= 0) return fn(1)
    tweens.push({ start: performance.now() + delay, ms, fn })
  }

  // Hover and highlight glow in STEVE yellow.
  const setGlow = (obj, on) => obj.traverse((m) => {
    if (!m.isMesh) return
    for (const mat of [].concat(m.material)) {
      if (!mat.emissive) continue
      mat.userData.base ??= { color: mat.emissive.getHex(), k: mat.emissiveIntensity }
      if (on) { mat.emissive.setHex(0xffc928); mat.emissiveIntensity = 0.32 } else { mat.emissive.setHex(mat.userData.base.color); mat.emissiveIntensity = mat.userData.base.k }
    }
  })
  const refreshGlow = () => { for (const p of parts) setGlow(p.object, glowing.has(p) || hovered === p) }

  const s = {
    THREE, scene, camera, renderer, controls, model, parts, labels, ready: false,

    /** A material by name (steel, aluminium, iron, chrome, brass, copper, gold, plastic, rubber, glass, clay, wood, pcb, concrete, bone, muscle, white, black, red, orange, yellow, green, teal, blue, purple, pink) or any CSS colour. */
    mat(name = 'plastic', extra = {}) {
      if (name === 'glass') {
        return new THREE.MeshPhysicalMaterial({ color: 0xe6f4ff, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, ...extra })
      }
      const [color, metalness, roughness] = MATS[String(name).toLowerCase()] ?? [name, 0, 0.5]
      return new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: metalness ? 0 : 0.2, clearcoatRoughness: 0.5, ...extra })
    },

    /** Adds a named, clickable part: it glows on hover and a click asks STEVE about it. */
    part(name, object, o = {}) {
      object.name = name
      ;(find(o.parent) ?? model).add(object)
      object.traverse((m) => {
        if (!m.isMesh) return
        m.castShadow = m.receiveShadow = true
        m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone() // own glow
      })
      const p = { name, object, info: o.info ?? '', dir: o.explode ? v3(o.explode).normalize() : null, home: null }
      parts.push(p)
      object.userData.part = p
      if (o.label) s.label(object, o.label === true ? name : o.label, { color: o.color })
      return object
    },

    /** A coloured tag with a leader line, on a part (or its name) or at a point [x, y, z]. */
    label(target, text, o = {}) {
      const obj = isPoint(target) ? null : find(target)
      const color = INK[o.color] ? o.color : CYCLE[labels.length % CYCLE.length]
      const [bg, line, ink] = INK[color]
      const el = document.createElement('div')
      el.className = 's3d-tag'
      el.textContent = text ?? obj?.name ?? ''
      el.style.cssText = `--bg:${bg};--line:${line};--ink:${ink};display:none`
      const lead = document.createElementNS(NS, 'line')
      const dot = document.createElementNS(NS, 'circle')
      lead.setAttribute('stroke', line)
      lead.setAttribute('stroke-width', '1.5')
      dot.setAttribute('r', '3.5')
      dot.setAttribute('fill', line)
      dot.setAttribute('stroke', '#fff')
      dot.setAttribute('stroke-width', '1.5')
      lines.append(lead, dot)
      layer.append(el)
      const at = obj ? null : isPoint(target) ? v3(target) : new THREE.Vector3() // unknown name: pin it to the origin rather than fail
      const L = { text: el.textContent, obj, at, offset: o.offset ? v3(o.offset) : null, local: null, shown: true, el, lead, dot, x: 0, y: 0, w: 0, h: 0, placed: false }
      const part = obj?.userData.part
      if (part) {
        el.addEventListener('click', () => choose(part))
        el.addEventListener('mouseenter', () => { hovered = part; refreshGlow() })
        el.addEventListener('mouseleave', () => { hovered = null; refreshGlow() })
      }
      labels.push(L)
      if (laidOut) placeLabel(L)
      return L
    },

    /** A thick arrow for forces and flows: arrow(from, to, opts) or arrow([p1, p2, p3...], opts) for a curve. */
    arrow(a, b, o) {
      const curved = Array.isArray(a) && !isPoint(a)
      const pts = (curved ? a : [a, b]).map(v3)
      o = (curved ? b : o) ?? {}
      const [, line] = INK[o.color] ?? INK.orange
      const r = o.radius ?? Math.max(boxOf(model).getSize(new THREE.Vector3()).length() * 0.012, 0.005)
      const curve = new THREE.CatmullRomCurve3(pts)
      const len = curve.getLength(), head = Math.min(r * 5, len * 0.4)
      const shaftEnd = 1 - head / len
      const shaftPts = Array.from({ length: 24 }, (_, i) => curve.getPointAt((i / 23) * shaftEnd))
      const mat = new THREE.MeshStandardMaterial({ color: line, roughness: 0.4, emissive: line, emissiveIntensity: 0.25 })
      const g = new THREE.Group()
      const shaft = new THREE.Mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(shaftPts), 64, r, 16), mat)
      const tip = new THREE.Mesh(new THREE.ConeGeometry(r * 2.4, head, 24), mat)
      const dir = curve.getTangentAt(1)
      tip.position.copy(curve.getPointAt(1)).addScaledVector(dir, -head / 2)
      tip.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir)
      g.add(shaft, tip)
      if (o.flow !== false && !reduced) {
        // Bright bands travelling along the shaft show the direction of flow.
        const c = Object.assign(document.createElement('canvas'), { width: 64, height: 4 })
        const x = c.getContext('2d')
        const grad = x.createLinearGradient(0, 0, 64, 0)
        grad.addColorStop(0, '#000'); grad.addColorStop(0.55, '#000'); grad.addColorStop(0.8, '#fff'); grad.addColorStop(1, '#000')
        x.fillStyle = grad
        x.fillRect(0, 0, 64, 4)
        const map = new THREE.CanvasTexture(c)
        map.wrapS = THREE.RepeatWrapping
        map.repeat.x = Math.max(1, (len * shaftEnd) / (r * 10))
        shaft.material = mat.clone()
        Object.assign(shaft.material, { emissiveMap: map, emissiveIntensity: 0.9 })
        shaft.material.emissive.set('#ffffff')
        s.onFrame((t, dt) => (map.offset.x -= dt * 0.9))
      }
      notes.add(g)
      if (o.label) s.label(curve.getPointAt(0.5), o.label, { color: o.color ?? 'orange', offset: o.offset })
      return g
    },

    /** Cuts the model open to show the inside: cut({ axis: 'x' | 'y' | 'z', at }) removes the +axis side; cut(false) closes it. */
    cut(o = {}) {
      const box = boxOf(model)
      if (o === false) {
        if (!cutOn) return
        cutOn = false
        const from = cutPlane.constant, to = from + size * 3
        return tween(700, (k) => (cutPlane.constant = from + (to - from) * ease(k)))
      }
      const axis = { x: 0, y: 1, z: 2 }[o.axis ?? 'z']
      const n = new THREE.Vector3().setComponent(axis, -1)
      const at = o.at ?? box.getCenter(new THREE.Vector3()).getComponent(axis)
      const target = find(o.part) ?? model
      target.traverse((m) => {
        if (!m.isMesh) return
        for (const mat of [].concat(m.material)) Object.assign(mat, { clippingPlanes: [cutPlane], clipShadows: true, side: THREE.DoubleSide })
      })
      const was = cutOn && cutPlane.normal.equals(n) ? cutPlane.constant : box.max.getComponent(axis) + size * 0.01
      cutPlane.normal.copy(n)
      cutOn = true
      tween(1000, (k) => (cutPlane.constant = was + (at - was) * ease(k)))
    },

    /** Flies the camera to a part (or its name); null frames the whole model. */
    focus(target, o = {}) {
      const obj = find(target) ?? model
      const sphere = boxOf(obj).getBoundingSphere(new THREE.Sphere())
      const half = THREE.MathUtils.degToRad(camera.fov / 2)
      const fit = Math.min(half, Math.atan(Math.tan(half) * camera.aspect))
      // Never closer than half the model, so a focused part keeps its context.
      const dist = Math.max(sphere.radius * (o.distance ?? 1.1), size * 0.55) / Math.sin(fit)
      const dir = camera.position.clone().sub(controls.target).normalize()
      const p0 = camera.position.clone(), t0 = controls.target.clone()
      const p1 = sphere.center.clone().addScaledVector(dir, dist), t1 = sphere.center.clone()
      controls.autoRotate = false
      tween(o.duration ?? 900, (k) => {
        const e = ease(k)
        camera.position.lerpVectors(p0, p1, e)
        controls.target.lerpVectors(t0, t1, e)
      })
    },

    /** Moves the parts apart (1) or back together (0). */
    explode(amount = 1) {
      const from = parts.map((p) => p.object.position.clone())
      tween(800, (k) => parts.forEach((p, i) => {
        if (!p.home) return
        p.object.position.lerpVectors(from[i], p.home.clone().addScaledVector(p.dir, amount * size * 0.6), ease(k))
      }))
    },

    /** Keeps something turning, e.g. spin(fan, { axis: 'z', speed: 6 }) in radians per second. */
    spin(object, o = {}) {
      const obj = find(object)
      if (obj) s.onFrame((t, dt) => (obj.rotation[o.axis ?? 'y'] += (o.speed ?? 1) * dt))
    },

    /** Runs fn(seconds, deltaSeconds) every frame for custom animation. */
    onFrame(fn) { frameFns.push(fn) },

    /** Glows the named parts until the next call. */
    highlight(names = []) {
      glowing.clear()
      for (const n of names) { const o = find(n); if (o?.userData.part) glowing.add(o.userData.part) }
      refreshGlow()
    },

    /**
     * A guided tour with the step bar. Each step is a complete state:
     * { caption, focus, explode, cut, labels: [names], highlight: [names], run(s) }.
     */
    tour(steps, o = {}) {
      const showLabels = (st) => { for (const L of labels) L.shown = !st.labels || st.labels.some((n) => L.text === n || L.obj?.name === n) }
      const apply = (st) => {
        s.focus(st.focus ?? null, { duration: 1100, distance: 1.1 + (st.explode ?? 0) * 0.7 }) // room for the parts to spread
        s.explode(st.explode ?? 0)
        if (st.cut) s.cut(st.cut === true ? {} : st.cut)
        else s.cut(false)
        showLabels(st)
        s.highlight(st.highlight ?? [])
        st.run?.(s)
      }
      if (steps[0]) showLabels(steps[0]) // no flash of every label during the intro
      window.steve?.steps(steps.length, (i) => (s.ready ? apply(steps[i]) : (pendingStep = () => apply(steps[i]))), {
        captions: steps.map((x) => x.caption ?? ''), interval: o.interval ?? 4500,
      })
    },

    /** Frames the model again; call it if you add parts after a delay. */
    frame: () => layout(),
  }

  function placeLabel(L) {
    if (L.obj) L.local = L.obj.worldToLocal(boxOf(L.obj).getCenter(new THREE.Vector3()))
  }

  const toScreen = (v) => {
    const p = v.clone().project(camera)
    return { x: ((p.x + 1) / 2) * innerWidth, y: ((1 - p.y) / 2) * innerHeight, behind: p.z > 1 }
  }
  /** Tags go outward from the model's centre on screen, then get pushed apart and kept inside the window. */
  function layoutLabels() {
    const mid = toScreen(boxOf(model).getCenter(new THREE.Vector3()))
    const reach = 40 + Math.min(innerWidth, innerHeight) * 0.09
    const items = []
    for (const L of labels) {
      const anchor = L.obj ? L.obj.localToWorld(L.local.clone()) : L.at
      const a = toScreen(anchor)
      const vis = L.shown && (!L.obj || L.obj.visible) && !a.behind
      for (const el of [L.el, L.lead, L.dot]) el.style.display = vis ? '' : 'none'
      if (!vis) { L.placed = false; continue }
      if (!L.w) { L.w = L.el.offsetWidth; L.h = L.el.offsetHeight }
      let tx, ty
      if (L.offset) ({ x: tx, y: ty } = toScreen(anchor.clone().add(L.offset)))
      else {
        let dx = a.x - mid.x, dy = a.y - mid.y
        const d = Math.hypot(dx, dy)
        if (d < 8) { dx = 0; dy = -1 } else { dx /= d; dy = dy / d - 0.5 } // and a little upward
        const n = Math.hypot(dx, dy)
        tx = a.x + (dx / n) * reach
        ty = a.y + (dy / n) * reach
      }
      items.push({ L, a, tx, ty })
    }
    const bottom = innerHeight - (document.getElementById('steve-steps') ? 70 : 10)
    for (let pass = 0; pass < 8; pass++) {
      for (let i = 0; i < items.length; i++) for (let j = i + 1; j < items.length; j++) {
        const p = items[i], q = items[j]
        const gapY = (p.L.h + q.L.h) / 2 + 4 - Math.abs(p.ty - q.ty)
        if (Math.abs(p.tx - q.tx) >= (p.L.w + q.L.w) / 2 + 6 || gapY <= 0) continue
        const [up, down] = p.ty <= q.ty ? [p, q] : [q, p]
        up.ty -= gapY / 2
        down.ty += gapY / 2
      }
      for (const it of items) {
        it.tx = Math.max(it.L.w / 2 + 8, Math.min(innerWidth - it.L.w / 2 - 8, it.tx))
        it.ty = Math.max(it.L.h / 2 + 8, Math.min(bottom - it.L.h / 2, it.ty))
      }
    }
    for (const { L, a, tx, ty } of items) {
      // Ease towards the new spot so tags glide rather than jump while the model turns.
      L.x = L.placed ? L.x + (tx - L.x) * 0.25 : tx
      L.y = L.placed ? L.y + (ty - L.y) * 0.25 : ty
      L.placed = true
      L.el.style.transform = `translate(${L.x - L.w / 2}px,${L.y - L.h / 2}px)`
      L.lead.setAttribute('x1', a.x); L.lead.setAttribute('y1', a.y); L.lead.setAttribute('x2', L.x); L.lead.setAttribute('y2', L.y)
      L.dot.setAttribute('cx', a.x); L.dot.setAttribute('cy', a.y)
    }
  }

  function layout() {
    model.updateMatrixWorld(true)
    const box = boxOf(model)
    if (box.isEmpty()) return false
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius)) return 'broken'
    center = sphere.center
    size = sphere.radius || 1
    controls.target.copy(center)
    camera.near = size / 200
    camera.far = size * 200
    camera.updateProjectionMatrix()
    camera.position.copy(center).addScaledVector(v3(view).normalize(), size * 2.5)
    s.focus(null, { duration: 0, distance: 1.25 })
    controls.minDistance = size * 0.25
    controls.maxDistance = size * 10
    key.position.copy(center).add(new THREE.Vector3(size * 1.4, size * 2.6, size * 1.8))
    key.target.position.copy(center)
    Object.assign(key.shadow.camera, { left: -size * 1.6, right: size * 1.6, top: size * 1.6, bottom: -size * 1.6, near: size * 0.1, far: size * 8 })
    key.shadow.camera.updateProjectionMatrix()
    key.shadow.normalBias = size * 0.004
    for (const p of parts) {
      p.home = p.object.position.clone()
      if (!p.dir) {
        p.dir = boxOf(p.object).getCenter(new THREE.Vector3()).sub(center)
        if (p.dir.lengthSq() < size * size * 1e-4) p.dir.set(0, 1, 0)
        p.dir.normalize()
      }
    }
    for (const L of labels) placeLabel(L)
    laidOut = true
    return true
  }

  function playIntro(done) {
    if (reduced || !intro) return done()
    if (intro === 'grow') {
      return tween(750, (k) => {
        const e = 0.6 + 0.4 * easeOut(k)
        model.scale.setScalar(e)
        model.position.copy(center).multiplyScalar(1 - e)
        if (k === 1) done()
      })
    }
    // 'assemble': parts fly in from an exploded position, one after another.
    const step = Math.min(70, 700 / Math.max(1, parts.length))
    parts.forEach((p) => p.object.position.copy(p.home).addScaledVector(p.dir, size * 0.8))
    if (!parts.length) return done()
    parts.forEach((p, i) => tween(850, (k) => {
      p.object.position.lerpVectors(p.home.clone().addScaledVector(p.dir, size * 0.8), p.home, easeOut(k))
      if (k === 1 && i === parts.length - 1) done()
    }, i * step))
  }

  // Clicks (not drags) on a part ask STEVE about it; hovering shows its name.
  const ray = new THREE.Raycaster(), ndc = new THREE.Vector2()
  const tip = Object.assign(document.createElement('div'), { className: 's3d-tip', hidden: true })
  document.body.append(tip)
  const partAt = (e) => {
    ndc.set((e.clientX / innerWidth) * 2 - 1, -(e.clientY / innerHeight) * 2 + 1)
    ray.setFromCamera(ndc, camera)
    for (const hit of ray.intersectObject(model, true)) {
      if (cutOn && cutPlane.distanceToPoint(hit.point) < 0) continue // that bit is cut away
      for (let o = hit.object; o; o = o.parent) if (o.userData.part) return o.userData.part
    }
    return null
  }
  function choose(p) {
    window.steve?.select(p.name, p.info)
    glowing.add(p)
    refreshGlow()
    setTimeout(() => { glowing.delete(p); refreshGlow() }, 900)
  }
  let down = null
  renderer.domElement.addEventListener('pointerdown', (e) => (down = [e.clientX, e.clientY]))
  renderer.domElement.addEventListener('pointerup', (e) => {
    if (down && Math.hypot(e.clientX - down[0], e.clientY - down[1]) < 5) { const p = partAt(e); if (p) choose(p) }
    down = null
  })
  renderer.domElement.addEventListener('pointermove', (e) => {
    if (e.buttons) return
    const p = partAt(e)
    if (p !== hovered) { hovered = p; refreshGlow() }
    renderer.domElement.style.cursor = p ? 'pointer' : ''
    const labelled = p && labels.some((L) => L.shown && L.obj === p.object)
    tip.hidden = !p || labelled
    if (p && !labelled) { tip.textContent = p.name; tip.style.left = e.clientX + 'px'; tip.style.top = e.clientY + 'px' }
  })
  renderer.domElement.addEventListener('pointerleave', () => { hovered = null; tip.hidden = true; refreshGlow() })

  addEventListener('resize', () => {
    camera.aspect = innerWidth / innerHeight
    camera.updateProjectionMatrix()
    renderer.setSize(innerWidth, innerHeight)
  })

  let last = performance.now(), started = false, waited = 0
  renderer.setAnimationLoop((now) => {
    const dt = Math.min(0.1, (now - last) / 1000)
    last = now
    if (!started) {
      // The visual's own code builds the model synchronously after stage(), so lay out on the first frame.
      const laid = layout()
      if (laid === 'broken') {
        fail('Some shapes in this model have impossible sizes (not a number), so it can\'t be drawn. Ask STEVE to try again.')
        return renderer.setAnimationLoop(null)
      }
      if (!laid) {
        if ((waited += dt) > 3) { fail('This visual has nothing to show: no parts were added to the model.'); renderer.setAnimationLoop(null) }
        return
      }
      started = true
      console.info(`[3D] ready after ${Math.round(performance.now())} ms: ${parts.length} parts, ${labels.length} tags, size ${size.toPrecision(3)}, ${innerWidth}x${innerHeight} px, graphics: ${gpu}${software ? ' (software, simple lighting)' : ''}`)
      parent.postMessage({ type: 'steve-stage-ready' }, '*')
      playIntro(() => { s.ready = true; pendingStep?.(); pendingStep = null })
    }
    for (const t of tweens.slice()) {
      const k = Math.min(1, Math.max(0, (now - t.start) / t.ms))
      if (now < t.start) continue
      t.fn(k)
      if (k === 1) tweens.splice(tweens.indexOf(t), 1)
    }
    for (const fn of frameFns) fn(now / 1000, dt)
    controls.update()
    renderer.render(scene, camera)
    layoutLabels()
  })

  window.__stage = s // for STEVE's end-to-end test
  return s
}
