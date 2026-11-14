// Click-through overlay: the cursor buddy, captions, and drawings on the screen.
const { steve } = window
const $ = (id: string) => document.getElementById(id)!
const buddy = $('buddy'), caption = $('caption'), shapes = $('shapes'), banner = $('banner'), flash = $('flash')
const SVG = 'http://www.w3.org/2000/svg'

type Pt = { x: number; y: number }
let cursor: Pt | null = null
let target: Pt | null = null // where the buddy is pointing, if anywhere
let pointTimer = 0, inkTimer = 0, captionTimer = 0

function place() {
  const p = target ?? (cursor && { x: cursor.x + 20, y: cursor.y + 20 })
  buddy.hidden = !p
  if (!p) return
  buddy.style.transform = `translate(${p.x}px, ${p.y}px)`
  buddy.classList.toggle('flip', p.x > innerWidth - 360)
}
buddy.addEventListener('transitionend', () => { if (!target) buddy.classList.remove('flying') })

steve.on('cursor', (p: Pt | null) => { cursor = p; place() })
steve.on('state', (s: string) => { buddy.dataset.state = s })

steve.on('caption', (text: string | null) => {
  caption.textContent = text ?? ''
  clearTimeout(captionTimer)
  if (text) captionTimer = window.setTimeout(() => (caption.textContent = ''), 9000)
})

steve.on('banner', (text: string | null) => { banner.hidden = !text; banner.textContent = text ?? '' })

steve.on('flash', () => { flash.classList.remove('on'); void flash.offsetWidth; flash.classList.add('on') })

function el<K extends keyof SVGElementTagNameMap>(tag: K, attrs: Record<string, string | number>, parent: Element = shapes) {
  const e = document.createElementNS(SVG, tag)
  for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, String(v))
  parent.appendChild(e)
  return e
}

function tagLabel(x: number, y: number, text: string) {
  if (!text) return
  const g = el('g', {})
  const t = el('text', { x: x + 8, y: y + 17 }, g)
  t.textContent = text
  const w = t.getComputedTextLength() + 16
  const bg = el('rect', { x, y, width: w, height: 24, rx: 6, class: 'tagbg' }, g)
  g.insertBefore(bg, t)
}

type Shape =
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'box'; x: number; y: number; w: number; h: number; label: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'clear' }

steve.on('draw', (list: Shape[]) => {
  for (const s of list) {
    switch (s.kind) {
      case 'clear':
        shapes.replaceChildren()
        break
      case 'point':
        target = { x: s.x, y: s.y }
        buddy.classList.add('flying')
        place()
        el('circle', { cx: s.x, cy: s.y, r: 18, class: 'ring' })
        if (s.label) caption.textContent = s.label
        clearTimeout(pointTimer)
        pointTimer = window.setTimeout(() => { target = null; buddy.classList.add('flying'); place() }, 4500)
        break
      case 'box':
        el('rect', { x: s.x - 4, y: s.y - 4, width: s.w + 8, height: s.h + 8, rx: 8, class: 'shape' })
        tagLabel(s.x - 4, s.y - 32, s.label)
        break
      case 'arrow':
        el('line', { x1: s.x1, y1: s.y1, x2: s.x2, y2: s.y2, class: 'shape', 'marker-end': 'url(#head)' })
        tagLabel(s.x1 - 10, s.y1 - 30, s.label)
        break
      case 'label':
        tagLabel(s.x, s.y, s.text)
        break
    }
  }
  clearTimeout(inkTimer)
  inkTimer = window.setTimeout(() => shapes.replaceChildren(), 30000) // drawings fade out on their own
})

export {}
