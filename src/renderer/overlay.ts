// Click-through overlay: the cursor buddy, its speech bubble, and its marker drawings on the screen.
import './theme.css'

const { steve } = window
const $ = (id: string) => document.getElementById(id)!
const buddy = $('buddy'), caption = $('caption'), ink = $('ink'), shapes = $('shapes'), banner = $('banner'), flash = $('flash')
const SVG = 'http://www.w3.org/2000/svg'

type Pt = { x: number; y: number }
let cursor: Pt | null = null
let target: Pt | null = null // where the buddy is pointing, if anywhere
let last: Pt | null = null
let pointTimer = 0, inkTimer = 0, captionTimer = 0

const setVar = (name: string, v: string) => buddy.style.setProperty(name, v)

/** Puts the buddy next to the cursor, or beside the thing it points at, looking towards it. */
function place() {
  const p = target ?? (cursor && { x: cursor.x + 20, y: cursor.y + 20 })
  buddy.hidden = !p
  if (!p) return
  buddy.style.transform = `translate(${p.x}px, ${p.y}px)`
  const flipX = p.x > innerWidth - 380, flipY = !!target && p.y > innerHeight - 90
  const side = target ? 26 : 10
  const cx = flipX && target ? -side : side, cy = flipY ? -side : side
  setVar('--cx', `${cx}px`)
  setVar('--cy', `${cy}px`)
  // Eyes look back at the cursor or the target.
  setVar('--lx', `${-Math.sign(cx) * 1.5}px`)
  setVar('--ly', `${-Math.sign(cy) * 1.5}px`)
  buddy.classList.toggle('flip', flipX)
  // Lean into a flight.
  if (last && buddy.classList.contains('flying')) setVar('--tilt', `${Math.max(-14, Math.min(14, (p.x - last.x) / 25))}deg`)
  last = p
}
buddy.addEventListener('transitionend', (e) => {
  if (e.target !== buddy) return
  setVar('--tilt', '0deg')
  if (!target) buddy.classList.remove('flying')
})

// Blinks now and then.
function blink() {
  buddy.classList.add('blink')
  setTimeout(() => buddy.classList.remove('blink'), 120)
  setTimeout(blink, 2500 + Math.random() * 4000)
}
setTimeout(blink, 3000)

steve.on('cursor', (p: Pt | null) => { cursor = p; place() })
steve.on('state', (s: string) => { buddy.dataset.state = s })

steve.on('caption', (text: string | null) => {
  caption.textContent = text ?? ''
  clearTimeout(captionTimer)
  if (text) captionTimer = window.setTimeout(() => (caption.textContent = ''), 9000)
})

steve.on('banner', (text: string | null) => {
  banner.hidden = !text
  banner.replaceChildren()
  if (!text) return
  const kbd = document.createElement('kbd')
  kbd.textContent = 'Esc'
  banner.append(text, kbd)
})

steve.on('flash', () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on') })

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = shapes) {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent.appendChild(e)
  return e
}

/** One marker stroke: a dark under-stroke so it reads on any background, then the yellow ink on top. */
function stroke<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, top: Record<string, string> = {}) {
  const g = el('g', { filter: 'url(#marker)' })
  el(tag, { ...attrs, pathLength: 1, class: 'under draw' }, g)
  el(tag, { ...attrs, ...top, pathLength: 1, class: 'stroke draw' }, g)
}

function tagLabel(x: number, y: number, text: string) {
  if (!text) return
  const g = el('g', { class: 'tag' })
  const t = el('text', { x: x + 9, y: y + 18 }, g)
  t.textContent = text
  const w = t.getComputedTextLength() + 18
  g.insertBefore(el('rect', { x, y, width: w, height: 26, rx: 8 }, g), t)
}

type Shape =
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'box'; x: number; y: number; w: number; h: number; label: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'clear' }

steve.on('draw', (list: Shape[]) => {
  ink.classList.remove('fade')
  for (const s of list) {
    switch (s.kind) {
      case 'clear':
        shapes.replaceChildren()
        break
      case 'point':
        target = { x: s.x, y: s.y }
        buddy.classList.add('flying')
        place()
        el('circle', { cx: s.x, cy: s.y, r: 6, class: 'spot' })
        el('circle', { cx: s.x, cy: s.y, r: 20, class: 'ring' })
        el('circle', { cx: s.x, cy: s.y, r: 20, class: 'ring' })
        if (s.label) caption.textContent = s.label
        clearTimeout(pointTimer)
        pointTimer = window.setTimeout(() => { target = null; buddy.classList.add('flying'); place() }, 4500)
        break
      case 'box':
        stroke('rect', { x: s.x - 5, y: s.y - 5, width: s.w + 10, height: s.h + 10, rx: 10 })
        tagLabel(s.x - 5, s.y - 36, s.label)
        break
      case 'arrow': {
        // Stop short of the target so the head doesn't cover it.
        const len = Math.hypot(s.x2 - s.x1, s.y2 - s.y1) || 1, k = Math.max(0, (len - 8) / len)
        stroke('line', { x1: s.x1, y1: s.y1, x2: s.x1 + (s.x2 - s.x1) * k, y2: s.y1 + (s.y2 - s.y1) * k }, { 'marker-end': 'url(#head)' })
        tagLabel(s.x1 - 10, s.y1 - 34, s.label)
        break
      }
      case 'label':
        tagLabel(s.x, s.y, s.text)
        break
    }
  }
  clearTimeout(inkTimer)
  // Drawings fade out on their own.
  inkTimer = window.setTimeout(() => {
    ink.classList.add('fade')
    inkTimer = window.setTimeout(() => { shapes.replaceChildren(); ink.classList.remove('fade') }, 650)
  }, 30000)
})

export {}
