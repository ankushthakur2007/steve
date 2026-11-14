const { steve } = window
const frame = document.getElementById('frame') as HTMLIFrameElement
const title = document.getElementById('title')!

steve.on('visual', (v: { title: string; doc: string }) => {
  title.textContent = v.title
  frame.srcdoc = v.doc
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
