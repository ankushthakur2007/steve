// The visuals window: floats over the user's work and shows one AI-made visual at a time, with
// back/forward through every visual made this session, and Save to keep one as a web page.
import './theme.css'

const { steve } = window
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const frame = $<HTMLIFrameElement>('frame')
const history = $<HTMLSelectElement>('history')

let index = 0, count = 0, freshTimer = 0, readyTimer = 0
steve.on('visual', (v: { title: string; doc: string; clear: boolean; index: number; titles: string[] }) => {
  index = v.index
  count = v.titles.length
  $('title').textContent = v.title
  // 3D visuals have no background of their own, so the model sits right on the user's screen.
  frame.classList.toggle('clear', v.clear)
  $('failed').hidden = true
  clearTimeout(readyTimer)
  // An invisible, broken 3D visual would just be a patch of screen that eats clicks: say so instead.
  if (v.clear) readyTimer = window.setTimeout(() => ($('failed').hidden = false), 8000)
  frame.srcdoc = v.doc
  history.replaceChildren(...v.titles.map((t, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: `${i + 1}. ${t}` })))
  history.value = String(index)
  history.hidden = count < 2
  $<HTMLButtonElement>('back').disabled = index === 0
  $<HTMLButtonElement>('forward').disabled = index >= count - 1
  $('saved').textContent = ''
  // Show the toolbar for a moment so people see where to move, save or close the visual.
  document.body.classList.add('fresh')
  clearTimeout(freshTimer)
  freshTimer = window.setTimeout(() => document.body.classList.remove('fresh'), 3000)
})

const go = (i: number) => { if (i >= 0 && i < count && i !== index) steve.send('board:go', i) }
$('back').addEventListener('click', () => go(index - 1))
$('forward').addEventListener('click', () => go(index + 1))
history.addEventListener('change', () => go(Number(history.value)))
$('close').addEventListener('click', () => steve.send('board:close'))
$('size').addEventListener('click', () => {
  steve.send('board:size')
  const big = $('size').title === 'Make bigger'
  $('size').title = big ? 'Make smaller' : 'Make bigger'
  $('size').setAttribute('aria-label', $('size').title)
})
addEventListener('keydown', (e) => {
  if (e.key === 'Escape') steve.send('board:close')
  if (e.key === 'ArrowLeft' && (e.metaKey || e.altKey)) go(index - 1)
  if (e.key === 'ArrowRight' && (e.metaKey || e.altKey)) go(index + 1)
})
$('save').addEventListener('click', async () => {
  const path = await steve.invoke<string | null>('board:save')
  if (path) $('saved').textContent = `Saved to ${path.split(/[\\/]/).pop()}`
})

// Clicks inside the visual arrive as messages from the sandboxed frame.
let last = 0
addEventListener('message', (e) => {
  if (e.source !== frame.contentWindow) return
  if (e.data?.type === 'steve-stage-ready') { clearTimeout(readyTimer); $('failed').hidden = true; return }
  if (e.data?.type !== 'steve-select') return
  if (Date.now() - last < 800) return // one question per click, not per frame of a drag
  last = Date.now()
  steve.send('visual-select', { label: String(e.data.label), detail: String(e.data.detail ?? '') })
})

export {}
