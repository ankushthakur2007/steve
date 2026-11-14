// Wraps AI-generated HTML for the board's sandboxed iframe. Pure, so it is unit tested.

// `src` is where the libraries come from: STEVE's own steve: scheme, or a CDN in a saved copy.
// A saved copy carries the 3D kit inline as a data: module.
const csp = (src: string) => [
  "default-src 'none'",
  `script-src 'unsafe-inline' ${src}${src === 'steve:' ? '' : ' data:'}`,
  `style-src 'unsafe-inline' ${src}`,
  `font-src ${src} data:`,
  `img-src data: blob: ${src}`,
  "connect-src 'none'",
].join('; ')

const importMap = (three: string, steve3d?: string) => JSON.stringify({
  imports: { three: `${three}build/three.module.js`, 'three/addons/': `${three}examples/jsm/`, steve3d },
})

/** True when the visual is built with STEVE's 3D kit, which floats on the screen without a background. */
export const usesStage = (html: string) => /from\s*['"]steve3d['"]/.test(html)

// window.steve inside the visual: select() reports clicks to STEVE; steps() adds a playback bar.
const RUNTIME = `window.steve = {
  select(label, detail) { parent.postMessage({ type: 'steve-select', label: String(label), detail: detail == null ? '' : String(detail) }, '*') },
  steps(count, render, opts = {}) {
    const captions = opts.captions || []; let i = 0, timer = null
    const icon = (d) => '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor">' + d + '</svg>'
    const PLAY = icon('<path d="M8 5v14l11-7z"/>'), PAUSE = icon('<path d="M7 5h4v14H7zM13 5h4v14h-4z"/>')
    const bar = document.createElement('div'); bar.id = 'steve-steps'
    bar.innerHTML = '<button title="Start over" aria-label="Start over">' + icon('<path d="M6 5h2v14H6zM20 5v14L9 12z"/>') + '</button>'
      + '<button title="Back a step" aria-label="Back a step">' + icon('<path d="M17 5v14L6 12z"/>') + '</button>'
      + '<button class="play" title="Play" aria-label="Play">' + PLAY + '</button>'
      + '<button title="Next step" aria-label="Next step">' + icon('<path d="M7 5v14l11-7z"/>') + '</button>'
      + '<input type="range" min="0" step="1" aria-label="Step"><span class="n"></span><span class="c"></span>'
    ;(document.body || document.documentElement).appendChild(bar)
    const [first, prev, play, next] = bar.querySelectorAll('button'), range = bar.querySelector('input'), num = bar.querySelector('.n'), cap = bar.querySelector('.c')
    range.max = String(count - 1)
    const stop = () => { clearInterval(timer); timer = null; play.innerHTML = PLAY; play.title = 'Play' }
    const go = (n) => { i = Math.max(0, Math.min(count - 1, n)); range.value = String(i); num.textContent = (i + 1) + ' of ' + count; cap.textContent = captions[i] || ''; render(i); if (i === count - 1) stop() }
    play.onclick = () => { if (timer) return stop(); if (i === count - 1) go(0); play.innerHTML = PAUSE; play.title = 'Pause'; timer = setInterval(() => go(i + 1), opts.interval || 1200) }
    first.onclick = () => { stop(); go(0) }; prev.onclick = () => { stop(); go(i - 1) }; next.onclick = () => { stop(); go(i + 1) }
    range.oninput = () => { stop(); go(+range.value) }
    go(0)
    return { go, stop }
  },
}`

// The playback bar wears STEVE's colours: ink pill, yellow play button.
const BASE_CSS = `html,body{margin:0;min-height:100%;background:#0f1115;color:#e6e8ee;font:15px/1.4 system-ui,sans-serif}
#steve-steps{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:4px;align-items:center;max-width:calc(100% - 24px);background:#221f2ef2;color:#f2f1f6;padding:6px 14px 6px 6px;border-radius:999px;box-shadow:0 8px 28px #0008;z-index:9999;font:13px system-ui,sans-serif}
#steve-steps button{display:grid;place-items:center;width:32px;height:32px;background:none;color:inherit;border:0;border-radius:50%;cursor:pointer}
#steve-steps button:hover{background:#ffffff1a}
#steve-steps .play{background:#ffd23f;color:#221f2e}
#steve-steps .play:hover{background:#f2b705}
#steve-steps button:focus-visible{outline:2px solid #ffd23f;outline-offset:2px}
#steve-steps input{width:140px;accent-color:#ffd23f;margin:0 6px}
#steve-steps .n{white-space:nowrap;font-variant-numeric:tabular-nums;opacity:.75}
#steve-steps .c{margin-left:8px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis}`

/** Pulls the HTML out of a model reply (which may be wrapped in a code fence). */
export function extractHtml(reply: string): string {
  const fenced = reply.match(/```(?:html)?\s*([\s\S]*?)```/i)
  return (fenced ? fenced[1] : reply).trim()
}

/**
 * Injects the no-network policy, import map and runtime ahead of any model-written code.
 * With `cdn` (library name -> URL ending in /), it makes a copy that works in any browser:
 * steve://lib/ links point at the CDN instead.
 */
export function wrapVisual(html: string, cdn?: Record<string, string>): string {
  const three = cdn?.three ?? 'steve://lib/three/'
  const steve3d = cdn ? cdn.steve3d : 'steve://lib/steve3d/steve3d.js'
  if (cdn) html = html.replace(/steve:\/\/lib\/(\w+)\//g, (m, name: string) => cdn[name] ?? m)
  const clear = usesStage(html) ? 'html,body{background:transparent}' : ''
  const head = `<meta charset="utf-8"><meta http-equiv="Content-Security-Policy" content="${csp(cdn ? 'https://cdn.jsdelivr.net' : 'steve:')}"><script type="importmap">${importMap(three, steve3d)}</script><script>${RUNTIME}</script><style>${BASE_CSS}${clear}</style>`
  const doctype = html.match(/^\s*<!doctype[^>]*>/i)
  return doctype ? doctype[0] + head + html.slice(doctype[0].length) : '<!doctype html>' + head + html
}
