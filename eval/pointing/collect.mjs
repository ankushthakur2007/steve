// Builds pointing-benchmark cases from live websites: opens each page at 1920x1080, finds each target
// element's box in the DOM, and saves a 1280x720 screenshot (the size STEVE sends) plus the scaled box.
// Usage: npx electron eval/pointing/collect.mjs      (adds to cases.json; app screenshots you label by hand)
import { app, BrowserWindow } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

const PAGES = [
  { name: 'wikipedia', url: 'https://en.wikipedia.org/wiki/Internal_combustion_engine', targets: [
    { question: 'Where do I search Wikipedia?', find: { placeholder: 'Search Wikipedia' } },
    { question: 'Where is the Talk page for this article?', find: { text: 'Talk' } },
    { question: 'Where can I switch this article to another language?', find: { prefix: '119 languages' } },
  ] },
  { name: 'hackernews', url: 'https://news.ycombinator.com/', targets: [
    { question: 'Where do I log in?', find: { text: 'login' } },
    { question: 'How do I submit a story?', find: { text: 'submit' } },
  ] },
  { name: 'github', url: 'https://github.com/panxinmiao/myth', targets: [
    { question: 'How do I star this repository?', find: { pattern: '^Star\\d' } },
    { question: 'Where do I get the clone URL for this repo?', find: { text: 'Code' } },
    { question: 'Where are the issues?', find: { text: 'Issues' } },
  ] },
  { name: 'npm', url: 'https://www.npmjs.com/package/three', targets: [
    { question: 'Where can I see how many weekly downloads this has?', find: { text: 'Showing weekly downloads' } },
    { question: 'Where is the link to the source repository?', find: { text: 'github.com/mrdoob/three.js' } },
  ] },
  { name: 'python-docs', url: 'https://docs.python.org/3/', targets: [
    { question: 'Where is the search box?', find: { placeholder: 'Quick search' } },
    { question: 'Where is the tutorial?', find: { text: 'Tutorial' } },
  ] },
]

// Runs in the page: the smallest visible element matching by exact text/aria-label, prefix, regex or placeholder.
function locate(find) {
  const norm = (v) => (v ?? '').replace(/\s+/g, ' ').trim()
  let best = null
  for (const e of document.querySelectorAll('body *')) {
    const text = norm(e.textContent)
    const ok = find.placeholder ? (e.getAttribute('placeholder') ?? '').startsWith(find.placeholder)
      : find.prefix ? text.startsWith(find.prefix)
      : find.pattern ? new RegExp(find.pattern).test(text)
      : text === find.text || e.getAttribute('aria-label') === find.text
    if (!ok) continue
    const r = e.getBoundingClientRect()
    if (r.width < 4 || r.height < 4 || r.bottom < 0 || r.top > innerHeight || r.right < 0 || r.left > innerWidth) continue
    if (getComputedStyle(e).visibility === 'hidden') continue
    if (!best || r.width * r.height < best.width * best.height) best = r
  }
  return best && { x: best.left, y: best.top, width: best.width, height: best.height }
}

const dir = import.meta.dirname
const file = join(dir, 'cases.json')
const cases = existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : []

app.whenReady().then(async () => {
  const win = new BrowserWindow({ width: 1920, height: 1080, useContentSize: true, show: true, frame: false })
  for (const page of PAGES) {
    try {
      await win.loadURL(page.url)
      await new Promise((r) => setTimeout(r, 2500)) // let scripts settle
      const shot = await win.webContents.capturePage()
      const scale = 1280 / shot.getSize().width
      const image = `web-${page.name}.png`
      writeFileSync(join(dir, image), shot.resize({ width: 1280, quality: 'best' }).toPNG())
      for (const t of page.targets) {
        const r = await win.webContents.executeJavaScript(`(${locate})(${JSON.stringify(t.find)})`)
        if (!r) { console.log(`skip  ${page.name}: "${t.question}" (target not found)`); continue }
        const box = [r.x, r.y, r.width, r.height].map((v) => Math.round(v * scale))
        const entry = { image, width: 1280, height: Math.round(shot.getSize().height * scale), question: t.question, box }
        const i = cases.findIndex((c) => c.image === image && c.question === t.question)
        if (i >= 0) cases[i] = entry; else cases.push(entry)
        console.log(`ok    ${page.name}: "${t.question}" box ${box.join(',')}`)
      }
    } catch (e) {
      console.log(`fail  ${page.name}: ${e.message}`)
    }
  }
  writeFileSync(file, JSON.stringify(cases, null, 2) + '\n')
  console.log(`${cases.length} cases in cases.json`)
  app.quit()
})
