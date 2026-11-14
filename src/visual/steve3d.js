// STEVE's 3D scene engine for AI-made visuals, built on Three.js. It owns everything that makes a
// scene look finished (studio lighting, materials, hairline edges, soft shadows, camera framing, an
// assembling intro) and everything that makes it explain (named clickable parts, tags, arrows,
// cutaways, camera moves, exploded views, guided tours).
// Two ways in: model-written code calls stage() directly, or the model streams a short scene
// description (one JSON object per line) that player() draws part by part as it arrives, using a
// library of detailed ready-made shapes (gears, fans, chips, ports, wheels...).
// Runs inside the sandboxed visual as the bare module 'steve3d' (served by src/main/board.ts).
import * as THREE from 'three'
import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js'
import { RoundedBoxGeometry } from 'three/addons/geometries/RoundedBoxGeometry.js'
import { mergeGeometries } from 'three/addons/utils/BufferGeometryUtils.js'

export { THREE }

const v3 = (p) => (p?.isVector3 ? p.clone() : new THREE.Vector3(...(p ?? [0, 0, 0])))
const isPoint = (p) => p?.isVector3 || (Array.isArray(p) && typeof p[0] === 'number')
const TAU = Math.PI * 2

/** Anything round (hubs, nozzles, bottles, bolts): profile is [[radius, y], ...] from bottom to top. */
export const lathe = (profile, segments = 64) =>
  new THREE.LatheGeometry(profile.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y)), segments)
export const roundedBox = (w, h, d, r = Math.min(w, h, d) * 0.12) => new RoundedBoxGeometry(w, h, d, 4, Math.min(r, Math.min(w, h, d) / 2 - 1e-4))
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
  // Names models reach for that aren't in the list above.
  silver: [0xe6e8eb, 1, 0.18], titanium: [0x8b9097, 1, 0.38], carbon: [0x222326, 0.3, 0.32], ceramic: [0xf3f1ec, 0, 0.22],
  skin: [0xe9b99c, 0, 0.55], leaf: [0x4f9a4a, 0, 0.6], sand: [0xdcc79a, 0, 0.9], stone: [0x9b9a95, 0, 0.85],
  grey: [0x8e8e93, 0, 0.5], gray: [0x8e8e93, 0, 0.5], metal: [0xb9c0c8, 1, 0.32],
}
// Accent colours for tags and arrows: Apple's system colours.
const INK = {
  green: '#34c759', yellow: '#f5b800', blue: '#007aff', pink: '#ff2d55',
  orange: '#ff9500', purple: '#af52de', teal: '#30b0c7', red: '#ff3b30',
}
const CYCLE = Object.keys(INK)

// Apple-style finish: system font, frosted material, hairline borders, layered soft shadows.
const FONT = `-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI Variable','Segoe UI',system-ui,sans-serif`
const CSS = `html,body{overflow:hidden}canvas{display:block}
.s3d-labels{position:fixed;inset:0;pointer-events:none;overflow:hidden}
.s3d-labels svg{position:absolute;inset:0;width:100%;height:100%}
.s3d-tag{position:absolute;left:0;top:0;display:flex;align-items:center;gap:6px;pointer-events:auto;cursor:pointer;font:600 12px/1.25 ${FONT};letter-spacing:-.01em;padding:4px 10px 4px 8px;border-radius:8px;background:rgba(255,255,255,.84);-webkit-backdrop-filter:blur(16px) saturate(180%);backdrop-filter:blur(16px) saturate(180%);color:#1d1d1f;border:.5px solid rgba(0,0,0,.16);box-shadow:0 1px 1px rgba(0,0,0,.08),0 4px 14px rgba(0,0,0,.16);white-space:nowrap;user-select:none}
.s3d-tag span{max-width:220px;overflow:hidden;text-overflow:ellipsis}
.s3d-tag::before{content:'';flex:none;width:8px;height:8px;border-radius:50%;background:var(--accent);box-shadow:inset 0 0 0 .5px rgba(0,0,0,.18)}
.s3d-tip{position:fixed;z-index:2;pointer-events:none;font:600 12px/1.25 ${FONT};padding:4px 9px;border-radius:7px;background:rgba(28,28,30,.82);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:#f5f5f7;border:.5px solid rgba(255,255,255,.14);transform:translate(14px,14px)}
.s3d-error{position:fixed;left:16px;right:16px;bottom:16px;margin:0;padding:10px 14px;border-radius:12px;background:rgba(28,28,30,.9);-webkit-backdrop-filter:blur(16px);backdrop-filter:blur(16px);color:#f5f5f7;border:.5px solid rgba(255,255,255,.14);font:13px/1.4 ${FONT}}`

const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - (-2 * k + 2) ** 3 / 2)
const easeOut = (k) => 1 - (1 - k) ** 3

/**
 * Sets up the scene. Options: background (CSS colour; default transparent so the model floats on the
 * user's screen), intro ('assemble' | 'grow' | false), view ([x, y, z] direction the camera looks from),
 * edges (hairline outlines on every part; default true), stream (parts will keep arriving: frame the
 * model as it grows instead of giving up when it starts empty).
 */
export function stage(opts = {}) {
  const { background = null, intro = 'assemble', edges = true, stream = false } = opts
  let view = opts.view ?? [1, 0.55, 1.35]
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
  // At least 1.5x, so edges stay crisp on non-Retina screens too.
  renderer.setPixelRatio(Math.min(Math.max(devicePixelRatio, 1.5), 2))
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

  // Studio lighting: a soft room for reflections, a shadow-casting key light and a rim light that
  // traces the silhouette. Without a real graphics chip (software rendering) the room takes seconds
  // to prepare, so a tiny sky gradient stands in.
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
  const rim = new THREE.DirectionalLight(0xffffff, 0.9)
  scene.add(key, key.target, rim, rim.target)

  const model = new THREE.Group() // everything the visual builds; cut and exploded
  const notes = new THREE.Group() // arrows; never cut
  scene.add(model, notes)

  const controls = new OrbitControls(camera, renderer.domElement)
  controls.enableDamping = true
  controls.autoRotate = !reduced
  controls.autoRotateSpeed = 0.7
  let userMoved = false
  controls.addEventListener('start', () => { controls.autoRotate = false; userMoved = true })

  const parts = [], labels = [], tweens = [], frameFns = []
  let center = new THREE.Vector3(), size = 1, laidOut = false, pendingStep = null, touring = false
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

  /** Shadows, an own material (for the glow) and hairline edges on every mesh under obj. */
  function prepare(obj, edgeMat) {
    const meshes = []
    obj.traverse((m) => { if (m.isMesh && !m.userData.prepared) meshes.push(m) })
    for (const m of meshes) {
      m.userData.prepared = true
      m.castShadow = m.receiveShadow = true
      m.material = Array.isArray(m.material) ? m.material.map((x) => x.clone()) : m.material.clone()
      // Edges where faces meet at 30 degrees or more: the crisp outline of a product drawing. Smooth
      // curves stay clean because their facets meet at small angles.
      if (edges && edgeMat && !m.isInstancedMesh && !m.userData.noEdges) {
        const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry, 30), edgeMat)
        e.raycast = () => {} // edges are drawing, not something to click
        m.add(e)
      }
    }
  }
  const edgeMaterial = () => new THREE.LineBasicMaterial({ color: 0x1d1d1f, transparent: true, opacity: 0.32 })

  const s = {
    THREE, scene, camera, renderer, controls, model, parts, labels, ready: false,

    /** A material by name (steel, aluminium, iron, chrome, brass, copper, gold, plastic, rubber, glass, clay, wood, pcb, concrete, bone, muscle, white, black, red, orange, yellow, green, teal, blue, purple, pink) or any CSS colour. */
    mat(name = 'plastic', extra = {}) {
      const n = String(name).toLowerCase()
      if (n === 'glass' || n === 'water' || n === 'transparent') {
        return new THREE.MeshPhysicalMaterial({ color: n === 'water' ? 0x6cb8ff : 0xe6f4ff, roughness: 0.05, transparent: true, opacity: 0.25, depthWrite: false, side: THREE.DoubleSide, clearcoat: 1, ...extra })
      }
      const [color, metalness, roughness] = MATS[n] ?? [name, 0, 0.5]
      return new THREE.MeshPhysicalMaterial({ color, metalness, roughness, clearcoat: metalness ? 0 : 0.2, clearcoatRoughness: 0.5, ...extra })
    },

    /** Adds a named, clickable part: it glows on hover and a click asks STEVE about it. */
    part(name, object, o = {}) {
      object.name = name
      ;(find(o.parent) ?? model).add(object)
      const edgeMat = edgeMaterial()
      prepare(object, edgeMat)
      const p = { name, object, info: o.info ?? '', dir: o.explode ? v3(o.explode).normalize() : null, home: null, edgeMat }
      parts.push(p)
      object.userData.part = p
      if (o.label) s.label(object, o.label === true ? name : o.label, { color: o.color })
      if (started) arrive(p)
      return object
    },

    /** Adds more meshes to an existing part (or a new one with that name). */
    addTo(name, object) {
      const owner = find(name)
      if (!owner?.userData.part) return s.part(String(name), object)
      owner.add(object)
      prepare(object, owner.userData.part.edgeMat)
      if (started) grow()
      return object
    },

    /** A tag with a leader line, on a part (or its name) or at a point [x, y, z]. Colours: green, yellow, blue, pink, orange, purple, teal, red. */
    label(target, text, o = {}) {
      const obj = isPoint(target) ? null : find(target)
      const accent = INK[o.color] ?? INK[CYCLE[labels.length % CYCLE.length]]
      const el = document.createElement('div')
      el.className = 's3d-tag'
      el.append(Object.assign(document.createElement('span'), { textContent: String(text ?? obj?.name ?? '') }))
      el.title = el.textContent // long tags are cut short; the full text shows on hover
      el.style.cssText = `--accent:${accent};display:none`
      const lead = document.createElementNS(NS, 'line')
      const dot = document.createElementNS(NS, 'circle')
      lead.setAttribute('stroke', accent)
      lead.setAttribute('stroke-width', '1.25')
      dot.setAttribute('r', '3.5')
      dot.setAttribute('fill', accent)
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
      if (pts.length < 2) return null
      const line = INK[o.color] ?? INK.orange
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
      const axis = { x: 0, y: 1, z: 2 }[o.axis ?? 'z'] ?? 2
      const n = new THREE.Vector3().setComponent(axis, -1)
      const at = o.at ?? box.getCenter(new THREE.Vector3()).getComponent(axis)
      const target = find(o.part) ?? model
      target.traverse((m) => {
        if (m.isMesh) for (const mat of [].concat(m.material)) Object.assign(mat, { clippingPlanes: [cutPlane], clipShadows: true, side: THREE.DoubleSide })
        else if (m.isLineSegments) m.material.clippingPlanes = [cutPlane] // the edges go with the surface
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
      if (target != null) controls.autoRotate = false
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

    /** Keeps something turning about one of its own axes, e.g. spin(fan, { axis: 'z', speed: 6 }) in radians per second. */
    spin(object, o = {}) {
      const obj = find(object)
      const axis = new THREE.Vector3().setComponent({ x: 0, y: 1, z: 2 }[o.axis ?? 'y'] ?? 1, 1)
      if (obj && !reduced) s.onFrame((t, dt) => obj.rotateOnAxis(axis, (o.speed ?? 1) * dt))
    },

    /** Runs fn(seconds, deltaSeconds) every frame for custom animation. */
    onFrame(fn) { frameFns.push(fn) },

    /** Glows the named parts until the next call. */
    highlight(names = []) {
      glowing.clear()
      for (const n of [].concat(names)) { const o = find(n); if (o?.userData.part) glowing.add(o.userData.part) }
      refreshGlow()
    },

    /**
     * A guided tour with the step bar. Each step is a complete state:
     * { caption, focus, explode, cut, labels: [names], highlight: [names], run(s) }.
     */
    tour(steps, o = {}) {
      const showLabels = (st) => {
        const want = st.labels == null ? null : [].concat(st.labels) // a single name works too
        for (const L of labels) L.shown = !want || want.some((n) => L.text === n || L.obj?.name === n)
      }
      const apply = (st) => {
        touring = true
        controls.autoRotate = false
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

    /** Sets the side the camera starts from, before the first part is drawn. */
    setView(v) { if (isPoint(v)) view = v },

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
      if (!L.local && L.obj) placeLabel(L)
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

  /** Measures the model and fits lights, shadows and camera limits to it. */
  function measure() {
    model.updateMatrixWorld(true)
    const box = boxOf(model)
    if (box.isEmpty()) return false
    const sphere = box.getBoundingSphere(new THREE.Sphere())
    if (!Number.isFinite(sphere.radius)) return 'broken'
    center = sphere.center
    size = sphere.radius || 1
    camera.near = size / 200
    camera.far = size * 200
    camera.updateProjectionMatrix()
    controls.minDistance = size * 0.25
    controls.maxDistance = size * 10
    key.position.copy(center).add(new THREE.Vector3(size * 1.4, size * 2.6, size * 1.8))
    key.target.position.copy(center)
    rim.position.copy(center).add(new THREE.Vector3(-size * 1.8, size * 1.2, -size * 2.2))
    rim.target.position.copy(center)
    Object.assign(key.shadow.camera, { left: -size * 1.6, right: size * 1.6, top: size * 1.6, bottom: -size * 1.6, near: size * 0.1, far: size * 8 })
    key.shadow.camera.updateProjectionMatrix()
    key.shadow.normalBias = size * 0.004
    return true
  }

  function layout() {
    const m = measure()
    if (m !== true) return m
    controls.target.copy(center)
    camera.position.copy(center).addScaledVector(v3(view).normalize(), size * 2.5)
    s.focus(null, { duration: 0, distance: 1.25 })
    for (const p of parts) setHome(p)
    for (const L of labels) placeLabel(L)
    laidOut = true
    return true
  }

  function setHome(p) {
    p.home = p.object.position.clone()
    p.dir = p.dir ?? boxOf(p.object).getCenter(new THREE.Vector3()).sub(center)
    if (p.dir.lengthSq() < size * size * 1e-4) p.dir.set(0, 1, 0)
    p.dir.normalize()
  }

  // While a scene streams in, each new part flies into place and the camera widens to keep it all in view.
  function arrive(p) {
    setHome(p)
    const from = p.home.clone().addScaledVector(p.dir, size * 0.5)
    p.object.position.copy(from)
    tween(600, (k) => p.object.position.lerpVectors(from, p.home, easeOut(k)))
    grow()
  }
  let growTimer = 0
  function grow() {
    if (growTimer) return
    growTimer = setTimeout(() => {
      growTimer = 0
      const before = size, c0 = center.clone()
      // Measure with every part at home, not where it is mid-flight.
      const now = parts.map((p) => p.object.position.clone())
      parts.forEach((p) => p.home && p.object.position.copy(p.home))
      const ok = measure()
      parts.forEach((p, i) => p.object.position.copy(now[i]))
      if (ok !== true) return
      for (const L of labels) placeLabel(L)
      // Re-frame when the model got noticeably bigger or moved, unless the user is looking around themselves.
      if (!userMoved && !touring && (size > before * 1.04 || center.distanceTo(c0) > before * 0.05)) s.focus(null, { duration: 700, distance: 1.25 })
    }, 250)
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
      if (!hit.object.isMesh) continue
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
      // A streamed scene lays out as soon as its first part arrives.
      const laid = layout()
      if (laid === 'broken') {
        fail('Some shapes in this model have impossible sizes (not a number), so it can\'t be drawn. Ask STEVE to try again.')
        return renderer.setAnimationLoop(null)
      }
      if (!laid) {
        if (!stream && (waited += dt) > 3) { fail('This visual has nothing to show: no parts were added to the model.'); renderer.setAnimationLoop(null) }
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

// ---------------------------------------------------------------------------------------------
// Parts library: detailed, parametric shapes the scene format names. Each builder gets the line's
// parameters, the part's main material and the stage, and returns an object at the origin. Round
// shapes are built around the y axis; "axis" in the scene line turns them to x or z.
// ---------------------------------------------------------------------------------------------
const mesh = (g, m) => new THREE.Mesh(g, m)
// The model's numbers are not trusted: strings like "0.5" are read, anything else falls back to a
// default, and counts are capped so a typo like "blades": 100000 can't freeze the app.
const num = (v, d) => {
  const n = typeof v === 'string' && v.trim() !== '' ? Number(v) : v
  return typeof n === 'number' && Number.isFinite(n) ? n : d
}
const count = (v, d, min, max) => Math.min(max, Math.max(min, Math.round(num(v, d))))
const pair = (v, d) => (Array.isArray(v) && v.length >= 2 ? d.map((x, i) => num(v[i], x)) : d)
/** [x, y, z] from the model, or null: needs at least two numbers; a missing z is 0. */
export function vec3(v) {
  if (!Array.isArray(v) || v.length < 2) return null
  const out = [0, 1, 2].map((i) => num(v[i], i === 2 ? 0 : NaN))
  return out.every(Number.isFinite) ? out : null
}
const points3 = (v) => (Array.isArray(v) ? v.map(vec3).filter(Boolean) : [])
const points2 = (v) => (Array.isArray(v) ? v.map((q) => vec3(q)?.slice(0, 2)).filter(Boolean) : [])

/** A blade along +x from the origin, chord along z, twisted about its length: rotors, fans, turbines. */
function blade(len, chord, thick, twistDeg) {
  const g = new THREE.BoxGeometry(len, thick, chord, 10, 1, 3)
  const pos = g.attributes.position, v = new THREE.Vector3()
  for (let i = 0; i < pos.count; i++) {
    v.fromBufferAttribute(pos, i)
    const t = v.x / len + 0.5 // 0 at the root, 1 at the tip
    const z = v.z * (1 - 0.35 * t) // a little narrower towards the tip
    const a = THREE.MathUtils.degToRad(twistDeg) * (0.75 - t) // steeper at the root
    pos.setXYZ(i, v.x, v.y * Math.cos(a) - z * Math.sin(a), v.y * Math.sin(a) + z * Math.cos(a))
  }
  g.translate(len / 2, 0, 0)
  g.computeVertexNormals()
  return g
}
/** n copies of a geometry spread around the y axis, merged into one geometry. */
function around(g, n, offset = 0) {
  const all = []
  for (let i = 0; i < n; i++) all.push(g.clone().translate(offset, 0, 0).rotateY((i / n) * TAU))
  return mergeGeometries(all)
}
function helixPoints(r, turns, length, phase = 0, perTurn = 32) {
  const pts = []
  for (let i = 0; i <= turns * perTurn; i++) {
    const a = (i / perTurn) * TAU + phase
    pts.push(new THREE.Vector3(r * Math.cos(a), -length / 2 + (length * i) / (turns * perTurn), r * Math.sin(a)))
  }
  return pts
}
const between = (a, b, r, m) => {
  const d = b.clone().sub(a), c = mesh(new THREE.CylinderGeometry(r, r, d.length(), 12), m)
  c.position.copy(a).add(b).multiplyScalar(0.5)
  c.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), d.normalize())
  return c
}

const SHAPES = {
  box: (p, m) => {
    const [w, h, d] = pair(p.size, [1, 1, 1])
    const r = num(p.round, Math.min(w, h, d) * 0.06) // a slight bevel, like anything manufactured
    return mesh(r > 0 ? roundedBox(w, h, d, r) : new THREE.BoxGeometry(w, h, d), m)
  },
  cylinder: (p, m) => mesh(new THREE.CylinderGeometry(num(p.r2, num(p.r, 0.5)), num(p.r, 0.5), num(p.h, 1), count(p.sides, 64, 3, 128)), m),
  cone: (p, m) => mesh(new THREE.ConeGeometry(num(p.r, 0.5), num(p.h, 1), 64), m),
  sphere: (p, m) => mesh(new THREE.SphereGeometry(num(p.r, 0.5), 64, 40), m),
  capsule: (p, m) => mesh(new THREE.CapsuleGeometry(num(p.r, 0.3), num(p.h, 1), 12, 32), m),
  torus: (p, m) => mesh(new THREE.TorusGeometry(num(p.r, 0.5), num(p.thickness, 0.1), 32, 96).rotateX(Math.PI / 2), m),
  lathe: (p, m) => { const pr = points2(p.profile); return mesh(lathe(pr.length > 1 ? pr.slice(0, 200) : [[0, -0.5], [0.5, -0.5], [0.5, 0.5], [0, 0.5]], 96), m) },
  tube: (p, m) => { const pts = points3(p.points); return mesh(tube(pts.length > 1 ? pts.slice(0, 200) : [[0, 0, 0], [1, 0, 0]], num(p.r, 0.05)), m) },
  extrude: (p, m) => {
    const given = points2(p.points), pts = given.length > 2 ? given.slice(0, 500) : [[-0.5, -0.5], [0.5, -0.5], [0, 0.5]]
    const depth = num(p.depth, 0.2), bevel = num(p.bevel, depth * 0.12)
    const g = new THREE.ExtrudeGeometry(new THREE.Shape(pts.map(([x, y]) => new THREE.Vector2(x, y))), { depth, bevelEnabled: bevel > 0, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 3 })
    return mesh(g.translate(0, 0, -depth / 2), m)
  },
  gear: (p, m) => {
    const r = num(p.r, 0.5), teeth = count(p.teeth, 20, 6, 200), t = num(p.thickness, r * 0.25), depth = num(p.depth, r * 0.12)
    const shape = new THREE.Shape()
    for (let i = 0; i < teeth; i++) {
      const a = (i / teeth) * TAU, w = TAU / teeth
      const pts = [[r - depth, a], [r, a + w * 0.18], [r, a + w * 0.42], [r - depth, a + w * 0.6]]
      pts.forEach(([rr, aa], j) => (i === 0 && j === 0 ? shape.moveTo : shape.lineTo).call(shape, rr * Math.cos(aa), rr * Math.sin(aa)))
    }
    shape.closePath()
    const hole = num(p.hole, r * 0.25)
    if (hole > 0) shape.holes.push(new THREE.Path().absarc(0, 0, hole, 0, TAU, true))
    const bevel = t * 0.08
    const g = new THREE.ExtrudeGeometry(shape, { depth: t, bevelEnabled: true, bevelSize: bevel, bevelThickness: bevel, bevelSegments: 2, curveSegments: 24 })
    return mesh(g.translate(0, 0, -t / 2).rotateX(-Math.PI / 2), m)
  },
  fan: (p, m) => {
    const r = num(p.r, 0.5), n = count(p.blades, 12, 2, 64), hub = Math.min(num(p.hub, r * 0.28), r * 0.8)
    const g = new THREE.Group()
    g.add(mesh(lathe([[0, -hub * 0.7], [hub, -hub * 0.6], [hub, hub * 0.25], [hub * 0.7, hub * 0.75], [hub * 0.3, hub * 0.98], [0, hub * 1.05]], 64), m))
    const len = r - hub * 0.85
    g.add(mesh(around(blade(len, num(p.chord, r * 0.3), num(p.thickness, r * 0.025), num(p.twist, 35)), n, hub * 0.85), m))
    return g
  },
  discs: (p, m) => {
    const n = count(p.count, 5, 1, 40), r = num(p.r, 0.5), length = num(p.length, 1), bladesN = count(p.blades, 0, 0, 96)
    const g = new THREE.Group(), gap = n > 1 ? length / (n - 1) : 0
    const thick = num(p.thickness, Math.max(length / n * 0.35, r * 0.04))
    const disc = bladesN > 0
      ? mergeGeometries([new THREE.CylinderGeometry(r * 0.55, r * 0.55, thick, 64).toNonIndexed(), around(blade(r * 0.45, thick * 1.6, thick * 0.25, 30), bladesN, r * 0.53).toNonIndexed()])
      : new THREE.CylinderGeometry(r, r, thick, 64)
    for (let i = 0; i < n; i++) { const d = mesh(disc, m); d.position.y = -length / 2 + i * gap; g.add(d) }
    g.add(mesh(new THREE.CylinderGeometry(r * 0.12, r * 0.12, length + thick * 2, 32), m))
    return g
  },
  spring: (p, m) => {
    const r = num(p.r, 0.2), turns = count(p.turns, 8, 1, 60), length = num(p.length, 1)
    return mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPoints(r, turns, length)), Math.round(turns * 48), num(p.wire, r * 0.12), 12), m)
  },
  bolt: (p, m) => {
    const r = num(p.r, 0.05), len = num(p.length, r * 8), g = new THREE.Group()
    const head = mesh(new THREE.CylinderGeometry(r * 1.9, r * 1.9, r * 1.3, 6), m)
    head.position.y = len / 2 + r * 0.65
    g.add(head, mesh(new THREE.CylinderGeometry(r, r, len, 32), m))
    const thread = mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(helixPoints(r * 0.98, len * 0.7 / (r * 0.7), len * 0.7)), 200, r * 0.14, 6), m)
    thread.position.y = -len * 0.15
    thread.userData.noEdges = true
    g.add(thread)
    return g
  },
  wheel: (p, m, s) => {
    const r = num(p.r, 0.4), w = num(p.width, r * 0.45), n = count(p.spokes, 5, 0, 24), g = new THREE.Group()
    const rim = r * 0.68
    const tyre = [[rim, -w * 0.45], [r * 0.93, -w / 2], [r, -w * 0.3], [r, w * 0.3], [r * 0.93, w / 2], [rim, w * 0.45], [rim, -w * 0.45]]
    g.add(mesh(lathe(tyre, 96), s.mat('rubber')))
    g.add(mesh(new THREE.CylinderGeometry(rim, rim, w * 0.8, 64, 1, true), m))
    const hubM = mesh(new THREE.CylinderGeometry(r * 0.16, r * 0.16, w * 0.85, 32), m)
    g.add(hubM)
    if (n) g.add(mesh(around(new THREE.BoxGeometry(rim - r * 0.14, w * 0.18, r * 0.09).translate((rim - r * 0.14) / 2, 0, 0), n, r * 0.14), m))
    else g.add(mesh(new THREE.CylinderGeometry(rim, rim, w * 0.12, 64), m))
    return g
  },
  board: (p, m) => {
    const [w, d] = pair(p.size, [8.5, 5.6]), t = num(p.thickness, Math.min(w, d) * 0.03), g = new THREE.Group()
    g.add(mesh(roundedBox(w, t, d, Math.min(w, d) * 0.05), m))
    if (p.holes !== false) {
      const ring = new THREE.TorusGeometry(Math.min(w, d) * 0.035, Math.min(w, d) * 0.012, 12, 32).rotateX(Math.PI / 2)
      const inset = Math.min(w, d) * 0.07
      for (const [x, z] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
        const h = mesh(ring, new THREE.MeshPhysicalMaterial({ color: 0xe6b94f, metalness: 1, roughness: 0.25 }))
        h.position.set(x * (w / 2 - inset), t / 2, z * (d / 2 - inset))
        g.add(h)
      }
    }
    return g
  },
  chip: (p, m, s) => {
    const [w, d] = pair(p.size, [1, 1]), h = num(p.h, Math.min(w, d) * 0.12), n = count(p.pins, 8, 0, 64)
    const g = new THREE.Group()
    g.add(mesh(roundedBox(w, h, d, h * 0.25), p.mat || p.color ? m : s.mat('black')))
    const mark = mesh(new THREE.CylinderGeometry(Math.min(w, d) * 0.05, Math.min(w, d) * 0.05, h * 0.05, 24), s.mat('#3a3b40'))
    mark.position.set(-w * 0.35, h / 2, -d * 0.35)
    g.add(mark)
    if (n) {
      const pin = new THREE.BoxGeometry(Math.min(w, d) * 0.06, h * 0.25, Math.min(w, d) * 0.12)
      const all = []
      for (const side of [0, 1, 2, 3]) {
        const along = side % 2 ? d : w
        for (let i = 0; i < n; i++) {
          const k = -along / 2 + (along * (i + 0.5)) / n
          const q = pin.clone().translate(k, -h * 0.35, (side % 2 ? w : d) / 2 + Math.min(w, d) * 0.04)
          all.push(q.rotateY((side * Math.PI) / 2))
        }
      }
      g.add(mesh(mergeGeometries(all), s.mat('steel')))
    }
    return g
  },
  header: (p, m, s) => {
    const rows = count(p.rows, 2, 1, 4), cols = count(p.cols, 20, 1, 80), pitch = num(p.pitch, 0.254)
    const g = new THREE.Group()
    g.add(mesh(roundedBox(cols * pitch, pitch, rows * pitch, pitch * 0.1), s.mat('black')))
    const pin = new THREE.BoxGeometry(pitch * 0.25, pitch * 2.4, pitch * 0.25), all = []
    for (let r = 0; r < rows; r++) for (let c = 0; c < cols; c++) all.push(pin.clone().translate((c - (cols - 1) / 2) * pitch, pitch * 0.9, (r - (rows - 1) / 2) * pitch))
    g.add(mesh(mergeGeometries(all), p.mat || p.color ? m : s.mat('gold')))
    return g
  },
  port: (p, m, s) => {
    const kind = String(p.kind ?? 'usb').toLowerCase()
    const SIZES = { usb: [1.4, 0.55, 1.4], usbc: [0.9, 0.34, 0.75], hdmi: [1.5, 0.6, 1.1], ethernet: [1.6, 1.35, 2.1], audio: [0.6, 0.6, 1.2] }
    const [w, h, d] = pair(p.size, SIZES[kind] ?? SIZES.usb)
    const g = new THREE.Group(), dark = s.mat('#111214', { roughness: 0.9 })
    if (kind === 'audio') {
      g.add(mesh(new THREE.CylinderGeometry(w / 2, w / 2, d, 48).rotateX(Math.PI / 2), p.mat || p.color ? m : s.mat('black')))
      const hole = mesh(new THREE.CylinderGeometry(w * 0.2, w * 0.2, 0.02, 32).rotateX(Math.PI / 2), dark)
      hole.position.z = d / 2 + 0.005
      g.add(hole)
      return g
    }
    g.add(mesh(roundedBox(w, h, d, kind === 'usbc' ? h * 0.48 : Math.min(w, h) * 0.08), p.mat || p.color ? m : s.mat('steel')))
    const opening = mesh(roundedBox(w * 0.78, h * (kind === 'ethernet' ? 0.6 : 0.55), 0.04, kind === 'usbc' ? h * 0.26 : 0.01), dark)
    opening.position.set(0, kind === 'ethernet' ? -h * 0.08 : 0, d / 2 - 0.015)
    g.add(opening)
    if (kind === 'ethernet') {
      for (const [x, c] of [[-w * 0.36, 0x34c759], [w * 0.36, 0xff9500]]) {
        const led = mesh(new THREE.BoxGeometry(w * 0.12, h * 0.08, 0.03), new THREE.MeshStandardMaterial({ color: c, emissive: c, emissiveIntensity: 0.8 }))
        led.position.set(x, h * 0.38, d / 2 + 0.005)
        g.add(led)
      }
    }
    return g
  },
  screen: (p, m, s) => {
    const [w, h] = pair(p.size, [1.6, 1]), depth = num(p.depth, Math.min(w, h) * 0.04), bezel = num(p.bezel, Math.min(w, h) * 0.035)
    const g = new THREE.Group()
    g.add(mesh(roundedBox(w, h, depth, Math.min(w, h) * 0.05), p.mat || p.color ? m : s.mat('black')))
    const c = Object.assign(document.createElement('canvas'), { width: 4, height: 64 })
    const x = c.getContext('2d'), grad = x.createLinearGradient(0, 0, 0, 64)
    grad.addColorStop(0, '#2b5fd9'); grad.addColorStop(1, '#0c1a3a')
    x.fillStyle = grad
    x.fillRect(0, 0, 4, 64)
    const tex = new THREE.CanvasTexture(c)
    tex.colorSpace = THREE.SRGBColorSpace
    const panel = mesh(new THREE.PlaneGeometry(w - bezel * 2, h - bezel * 2), new THREE.MeshPhysicalMaterial({ map: tex, emissive: 0xffffff, emissiveMap: tex, emissiveIntensity: 0.6, roughness: 0.15, clearcoat: 1 }))
    panel.position.z = depth / 2 + 0.002
    panel.userData.noEdges = true
    g.add(panel)
    return g
  },
  helix: (p, m, s) => {
    const r = num(p.r, 0.5), turns = count(p.turns, 3, 1, 20), length = num(p.length, turns * 1.4), g = new THREE.Group()
    const a = helixPoints(r, turns, length, 0), b = helixPoints(r, turns, length, Math.PI * 0.8)
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(a), Math.round(turns * 64), r * 0.09, 12), m))
    g.add(mesh(new THREE.TubeGeometry(new THREE.CatmullRomCurve3(b), Math.round(turns * 64), r * 0.09, 12), p.mat2 ? s.mat(p.mat2) : s.mat('orange')))
    const bases = [s.mat('red'), s.mat('yellow'), s.mat('green'), s.mat('blue')]
    for (let i = 0; i < a.length; i += 3) {
      const mid = a[i].clone().add(b[i]).multiplyScalar(0.5), k = (i / 3) % 4
      g.add(between(a[i], mid, r * 0.05, bases[k]), between(mid, b[i], r * 0.05, bases[(k + 2) % 4]))
    }
    return g
  },
  planet: (p, m, s) => {
    const r = num(p.r, 1), g = new THREE.Group()
    g.add(mesh(new THREE.SphereGeometry(r, 96, 64), p.mat || p.color ? m : s.mat('blue', { roughness: 0.7 })))
    if (p.ring) {
      const ring = mesh(new THREE.RingGeometry(r * 1.35, r * 2.2, 128).rotateX(-Math.PI / 2), s.mat('#d8c9a8', { side: THREE.DoubleSide, transparent: true, opacity: 0.75 }))
      ring.userData.noEdges = true
      g.add(ring)
    }
    return g
  },
}
SHAPES.pipe = SHAPES.tube
SHAPES.disc = SHAPES.discs
SHAPES.propeller = SHAPES.fan
SHAPES.rotor = SHAPES.fan
SHAPES.pcb = SHAPES.board
SHAPES.dna = SHAPES.helix
SHAPES.display = SHAPES.screen
export const SHAPE_NAMES = Object.keys(SHAPES)

const AXES = { x: new THREE.Euler(0, 0, -Math.PI / 2), z: new THREE.Euler(Math.PI / 2, 0, 0) }

/** Builds one shape from a scene line: the shape itself, turned, rotated, moved and repeated. */
export function buildShape(s, cmd) {
  const shape = String(cmd.shape ?? 'box').toLowerCase()
  if (!SHAPES[shape]) console.warn(`[3D] unknown shape "${cmd.shape}", drawing a box`)
  const material = cmd.mat || !cmd.color ? s.mat(cmd.mat ?? 'plastic', cmd.color ? { color: cmd.color } : {}) : s.mat(cmd.color)
  const obj = (SHAPES[shape] ?? SHAPES.box)(cmd, material, s)
  const holder = new THREE.Group() // keeps the shape's own turn separate from its placement
  holder.add(obj)
  if (AXES[cmd.axis]) obj.quaternion.setFromEuler(AXES[cmd.axis])
  const rot = vec3(cmd.rot), at = vec3(cmd.at), scale = vec3(cmd.scale)
  if (rot) holder.rotation.set(...rot.map((d) => THREE.MathUtils.degToRad(d)))
  if (num(cmd.scale, 0) > 0) holder.scale.setScalar(num(cmd.scale, 1))
  else if (scale) holder.scale.set(...scale)
  if (shape !== 'tube' && shape !== 'pipe' && at) holder.position.set(...at)
  if (num(cmd.spin, 0) && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const up = new THREE.Vector3(0, 1, 0), speed = num(cmd.spin, 2)
    s.onFrame((t, dt) => obj.rotateOnAxis(up, speed * dt)) // about the shape's own axis
  }
  const built = repeat(holder, cmd)
  const b = new THREE.Box3().setFromObject(built)
  if (![b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)) {
    console.warn(`[3D] skipped a "${shape}" whose size isn't a number`)
    return null
  }
  return built
}

/** "array": {count, step} lays copies in a row; "ring": {count, radius, axis} spreads them around a circle. */
function repeat(holder, cmd) {
  const a = cmd.array, r = cmd.ring
  if (a && num(a.count, 0) > 1) {
    const g = new THREE.Group(), step = v3(vec3(a.step) ?? [1, 0, 0])
    for (let i = 0; i < count(a.count, 2, 2, 200); i++) { const c = i ? holder.clone() : holder; c.position.add(step.clone().multiplyScalar(i)); g.add(c) }
    return g
  }
  if (r && num(r.count, 0) > 1) {
    const g = new THREE.Group(), axis = r.axis ?? cmd.axis ?? 'y', radius = num(r.radius, 1), n = count(r.count, 2, 2, 200)
    const center = holder.position.clone()
    holder.position.set(0, 0, 0)
    const offset = axis === 'y' ? new THREE.Vector3(radius, 0, 0) : axis === 'x' ? new THREE.Vector3(0, radius, 0) : new THREE.Vector3(radius, 0, 0)
    const turn = new THREE.Vector3().setComponent({ x: 0, y: 1, z: 2 }[axis] ?? 1, 1)
    for (let i = 0; i < n; i++) {
      const pivot = new THREE.Group(), c = i ? holder.clone() : holder
      c.position.copy(offset)
      pivot.add(c)
      pivot.position.copy(center)
      pivot.setRotationFromAxisAngle(turn, (i / n) * TAU)
      g.add(pivot)
    }
    return g
  }
  return holder
}

const names = (v) => (v == null ? undefined : [].concat(v).filter((x) => typeof x === 'string'))

/** Applies one scene line to the stage. Tour steps are collected in `steps`. */
export function apply(s, cmd, steps) {
  if (!cmd || typeof cmd !== 'object') return
  if (vec3(cmd.view)) s.setView(vec3(cmd.view))
  if (typeof cmd.part === 'string' && !cmd.to) {
    const shape = buildShape(s, cmd)
    if (!shape) return
    const g = new THREE.Group()
    g.add(shape)
    s.part(cmd.part, g, { info: cmd.info, label: cmd.label, color: cmd.tag, explode: vec3(cmd.explode) ?? undefined, parent: cmd.parent })
  } else if (typeof cmd.to === 'string') {
    const shape = buildShape(s, cmd)
    if (shape) s.addTo(cmd.to, shape)
  }
  else if (Array.isArray(cmd.arrow)) s.arrow(points3(cmd.arrow).slice(0, 50), { color: cmd.color, label: cmd.label, radius: num(cmd.radius, undefined) })
  else if (typeof cmd.label === 'string' || vec3(cmd.label)) s.label(vec3(cmd.label) ?? cmd.label, typeof cmd.text === 'string' ? cmd.text : undefined, { color: cmd.tag })
  else if (typeof cmd.step === 'string') {
    steps.push({
      // Lenient about shapes: "labels": "Fan" works like ["Fan"].
      caption: cmd.step, focus: typeof cmd.focus === 'string' ? cmd.focus : null, explode: num(cmd.explode, 0),
      labels: names(cmd.labels), highlight: names(cmd.highlight) ?? [],
      cut: typeof cmd.cut === 'string' ? { axis: cmd.cut } : cmd.cut === true || (cmd.cut && typeof cmd.cut === 'object') ? cmd.cut : false,
    })
  }
}

/**
 * Plays a scene description: the lines given, then (when `id` is set) more lines streamed in from
 * STEVE as {type: 'scene-line', id, line} messages, ending with {type: 'scene-end', id}.
 */
export function player(initial = [], id = '') {
  const live = !!id && !initial.length
  const s = stage({ intro: live ? false : 'assemble', stream: live })
  const steps = []
  let parts = 0, skipped = 0
  const run = (line) => {
    try {
      const cmd = typeof line === 'string' ? JSON.parse(line) : line
      apply(s, cmd, steps)
      if (cmd?.part || cmd?.to) parts++
    } catch (e) {
      skipped++
      console.warn(`[3D] skipped a scene line (${e.message}):`, String(typeof line === 'string' ? line : JSON.stringify(line)).slice(0, 160))
    }
  }
  const end = () => {
    console.info(`[3D] scene complete: ${parts} shapes, ${steps.length} tour steps${skipped ? `, ${skipped} lines skipped` : ''}`)
    if (steps.length) s.tour(steps)
  }
  initial.forEach(run)
  if (!live) end()
  else {
    addEventListener('message', (e) => {
      if (e.source !== parent || e.data?.id !== id) return
      if (e.data.type === 'scene-line') run(e.data.line)
      else if (e.data.type === 'scene-end') end()
    })
    parent.postMessage({ type: 'steve-player-ready', id }, '*')
  }
  return s
}
