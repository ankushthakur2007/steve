// Wraps AI-generated HTML for the board's sandboxed iframe. Pure, so it is unit tested.

const CSP = [
  "default-src 'none'",
  "script-src 'unsafe-inline' steve:",
  "style-src 'unsafe-inline' steve:",
  'font-src steve: data:',
  'img-src data: blob: steve:',
  "connect-src 'none'",
].join('; ')

const IMPORT_MAP = JSON.stringify({
  imports: { three: 'steve://lib/three/build/three.module.js', 'three/addons/': 'steve://lib/three/examples/jsm/' },
})

// window.steve inside the visual: select() reports clicks to STEVE; steps() adds a playback bar.
const RUNTIME = `window.steve = {
  select(label, detail) { parent.postMessage({ type: 'steve-select', label: String(label), detail: detail == null ? '' : String(detail) }, '*') },
  steps(count, render, opts = {}) {
    const captions = opts.captions || []; let i = 0, timer = null
    const bar = document.createElement('div'); bar.id = 'steve-steps'
    bar.innerHTML = '<button title="First">⏮</button><button title="Back">◀</button><button title="Play">▶</button><button title="Step">▶|</button><input type="range" min="0" step="1"><span></span>'
    ;(document.body || document.documentElement).appendChild(bar)
    const [first, prev, play, next] = bar.querySelectorAll('button'), range = bar.querySelector('input'), cap = bar.querySelector('span')
    range.max = String(count - 1)
    const stop = () => { clearInterval(timer); timer = null; play.textContent = '▶' }
    const go = (n) => { i = Math.max(0, Math.min(count - 1, n)); range.value = String(i); cap.textContent = 'Step ' + (i + 1) + ' / ' + count + (captions[i] ? ' · ' + captions[i] : ''); render(i); if (i === count - 1) stop() }
    play.onclick = () => { if (timer) return stop(); if (i === count - 1) go(0); play.textContent = '⏸'; timer = setInterval(() => go(i + 1), opts.interval || 1200) }
    first.onclick = () => { stop(); go(0) }; prev.onclick = () => { stop(); go(i - 1) }; next.onclick = () => { stop(); go(i + 1) }
    range.oninput = () => { stop(); go(+range.value) }
    go(0)
    return { go, stop }
  },
}`

const BASE_CSS = `html,body{margin:0;min-height:100%;background:#0f1115;color:#e6e8ee;font:15px/1.4 system-ui,sans-serif}
#steve-steps{position:fixed;left:50%;bottom:12px;transform:translateX(-50%);display:flex;gap:6px;align-items:center;background:#1b1f27e6;padding:6px 10px;border-radius:10px;z-index:9999}
#steve-steps button{background:#2a3040;color:#fff;border:0;border-radius:6px;padding:4px 9px;cursor:pointer}
#steve-steps span{min-width:120px;font-size:13px}`

/** Pulls the HTML out of a model reply (which may be wrapped in a code fence). */
export function extractHtml(reply: string): string {
  const fenced = reply.match(/```(?:html)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : reply).trim()
}

/** Injects the no-network policy, import map and runtime ahead of any model-written code. */
export function wrapVisual(html: string): string {
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${CSP}"><script type="importmap">${IMPORT_MAP}</script><script>${RUNTIME}</script><style>${BASE_CSS}</style>`
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)
  return doctype ? doctype[0] + head + html.slice(doctype[0].length) : '<!doctype html>' + head + html
}
