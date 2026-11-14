// The visuals window: shows one AI-made visual at a time, with back/forward through every visual
// made this session, and Save to keep one as a web page.
import './theme.css'

const { steve } = window
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const frame = $<HTMLIFrameElement>('frame')
const history = $<HTMLSelectElement>('history')

let index = 0, count = 0
steve.on('visual', (v: { title: string; doc: string; index: number; titles: string[] }) => {
  index = v.index
  count = v.titles.length
  $('title').textContent = v.title
  frame.srcdoc = v.doc
  history.replaceChildren(...v.titles.map((t, i) => Object.assign(document.createElement('option'), { value: String(i), textContent: `${i + 1}. ${t}` })))
  history.value = String(index)
  history.hidden = count < 2
  $<HTMLButtonElement>('back').disabled = index === 0
  $<HTMLButtonElement>('forward').disabled = index >= count - 1
  $('saved').textContent = ''
})

const go = (i: number) => { if (i >= 0 && i < count && i !== index) steve.send('board:go', i) }
$('back').addEventListener('click', () => go(index - 1))
$('forward').addEventListener('click', () => go(index + 1))
history.addEventListener('change', () => go(Number(history.value)))
addEventListener('keydown', (e) => {
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
  if (e.source !== frame.contentWindow || e.data?.type !== 'steve-select') return
  if (Date.now() - last < 800) return // one question per click, not per frame of a drag
  last = Date.now()
  steve.send('visual-select', { label: String(e.data.label), detail: String(e.data.detail ?? '') })
})

export {}
