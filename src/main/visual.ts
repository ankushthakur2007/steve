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

const json = (v: unknown) => JSON.stringify(v).replace(/</g, '\\u003c')

/** A 3D scene as a page: the kit's player draws `lines`, then (with an `id`) the lines STEVE streams in. */
export const sceneHtml = (lines: string[], id = '') =>
  `<script type="module">\nimport { player } from 'steve3d'\nplayer(${json(lines)}, ${json(id)})\n</script>`

/**
 * Pulls every complete top-level {...} object out of streamed text, whatever is around it (newlines,
 * commas, an enclosing [ ], code fences, prose). The unfinished object at the end comes back as `rest`.
 */
export function takeObjects(buf: string): { objects: string[]; rest: string } {
  const objects: string[] = []
  let depth = 0, start = -1, inString = false, escaped = false
  for (let i = 0; i < buf.length; i++) {
    const c = buf[i]
    if (inString) {
      if (escaped) escaped = false
      else if (c === '\\') escaped = true
      else if (c === '"') inString = false
    } else if (c === '"') inString = depth > 0 // quotes in prose outside an object don't matter
    else if (c === '{') { if (depth++ === 0) start = i }
    else if (c === '}' && depth > 0 && --depth === 0) objects.push(buf.slice(start, i + 1))
  }
  return { objects, rest: depth > 0 ? buf.slice(start) : '' }
}

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

// Apple-style base: system font, dark card, and a frosted playback bar with STEVE's yellow play button.
const FONT = `-apple-system,BlinkMacSystemFont,'SF Pro Text','Segoe UI Variable','Segoe UI',system-ui,sans-serif`
const BASE_CSS = `html,body{margin:0;min-height:100%;background:#1c1c1e;color:#f5f5f7;font:15px/1.45 ${FONT};-webkit-font-smoothing:antialiased}
#steve-steps{position:fixed;left:50%;bottom:14px;transform:translateX(-50%);display:flex;gap:4px;align-items:center;max-width:calc(100% - 24px);background:rgba(44,44,46,.78);-webkit-backdrop-filter:blur(20px) saturate(180%);backdrop-filter:blur(20px) saturate(180%);border:.5px solid rgba(255,255,255,.14);color:#f5f5f7;padding:6px 14px 6px 6px;border-radius:999px;box-shadow:0 1px 1px rgba(0,0,0,.2),0 10px 30px rgba(0,0,0,.35);z-index:9999;font:13px/1.3 ${FONT}}
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
