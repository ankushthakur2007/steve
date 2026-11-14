// The visuals window: floats over the user's work and shows one AI-made visual at a time, with
// back/forward through every visual made this session, and Save to keep one as a web page.
import './theme.css'

const { steve } = window
const $ = <T extends HTMLElement = HTMLElement>(id: string) => document.getElementById(id) as T
const frame = $<HTMLIFrameElement>('frame')
const history = $<HTMLSelectElement>('history')

let index = 0, count = 0, freshTimer = 0, readyTimer = 0

/** A pill in the middle of the window: "Making ..." (pulsing) or what went wrong. Messages also reach the debug log. */
function status(text: string | null, error = false) {
  $('status').hidden = !text
  $('status').classList.toggle('error', error)
  $('status-text').textContent = text ?? ''
  if (error) console.warn(text)
}
function freshBar() {
  // Show the toolbar for a moment so people see where to move, save or close the visual.
  document.body.classList.add('fresh')
  clearTimeout(freshTimer)
  freshTimer = window.setTimeout(() => document.body.classList.remove('fresh'), 3000)
}

steve.on('making', (title: string) => {
  sceneId = ''
  clearTimeout(readyTimer)
  $('title').textContent = title
  frame.hidden = true
  status(`Making "${title}"…`)
  freshBar()
})
steve.on('failed', (message: string) => {
  clearTimeout(readyTimer)
  frame.hidden = true
  status(message, true)
  freshBar()
})

/** The list of this session's visuals, and which one is showing. */
function setHistory(i: number, titles: string[]) {
  index = i
  count = titles.length
  history.replaceChildren(...titles.map((t, k) => Object.assign(document.createElement('option'), { value: String(k), textContent: `${k + 1}. ${t}` })))
  history.value = String(index)
  history.hidden = count < 2
  $<HTMLButtonElement>('back').disabled = index === 0
  $<HTMLButtonElement>('forward').disabled = index >= count - 1
}

// A 3D scene streams in: lines wait here until the player inside the frame says it's listening.
let sceneId = '', playerReady = false, pending: object[] = []
const toPlayer = (msg: object) => { if (playerReady) frame.contentWindow?.postMessage(msg, '*'); else pending.push(msg) }

steve.on('scene-start', (v: { title: string; id: string; doc: string }) => {
  sceneId = v.id
  playerReady = false
  pending = []
  clearTimeout(readyTimer)
  $('title').textContent = v.title
  frame.classList.add('clear')
  frame.hidden = false
  status(`Making "${v.title}"…`) // until the first part is drawn
  frame.srcdoc = v.doc
  $('saved').textContent = ''
  freshBar()
})
steve.on('scene-line', (v: { id: string; line: string }) => { if (v.id === sceneId) toPlayer({ type: 'scene-line', id: v.id, line: v.line }) })
steve.on('scene-end', (v: { id: string }) => { if (v.id === sceneId) toPlayer({ type: 'scene-end', id: v.id }) })
steve.on('visual-meta', (v: { index: number; titles: string[] }) => setHistory(v.index, v.titles))

steve.on('visual', (v: { title: string; doc: string; clear: boolean; index: number; titles: string[] }) => {
  sceneId = ''
  $('title').textContent = v.title
  // 3D visuals have no background of their own, so the model sits right on the user's screen.
  frame.classList.toggle('clear', v.clear)
  frame.hidden = false
  clearTimeout(readyTimer)
  // A 3D visual has no background, so until its first frame is drawn the window would look empty:
  // keep "Making ..." up until the kit says it's ready (or shows its own error), and give up after 20 s.
  status(v.clear ? `Making "${v.title}"…` : null)
  if (v.clear) readyTimer = window.setTimeout(() => status("This 3D visual didn't start (its code has a mistake). Ask STEVE to try again.", true), 20000)
  frame.srcdoc = v.doc
  setHistory(v.index, v.titles)
  $('saved').textContent = ''
  freshBar()
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
  if (e.data?.type === 'steve-player-ready' && e.data.id === sceneId) {
    playerReady = true
    for (const m of pending) frame.contentWindow?.postMessage(m, '*')
    pending = []
    return
  }
  if (e.data?.type === 'steve-stage-ready' || e.data?.type === 'steve-stage-failed') { clearTimeout(readyTimer); status(null); return }
  if (e.data?.type !== 'steve-select') return
  if (Date.now() - last < 800) return // one question per click, not per frame of a drag
  last = Date.now()
  steve.send('visual-select', { label: String(e.data.label), detail: String(e.data.detail ?? '') })
})

export {}
