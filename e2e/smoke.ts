// End-to-end smoke test of the real, built app (run `npm run build` first). STEVE is pointed at a mock
// OpenAI-compatible server and driven the way a user would drive it: typed questions, clicks in visuals,
// the real mouse and the push-to-talk keys. It moves your mouse and presses keys: don't touch the
// computer while it runs. On macOS the terminal needs Screen Recording and Accessibility permission.
//   npm run build && npm run e2e
import { existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs'
import { createServer, type ServerResponse } from 'node:http'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import electronPath from 'electron'
import { _electron as electron, type Page } from 'playwright-core'

const nut = await import('@nut-tree-fork/nut-js')
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

// ---------- Mock model server: OpenAI Chat Completions, or the Responses API with E2E_API=responses ----------
const RESPONSES = process.env.E2E_API === 'responses'
type Msg = { role: string; content: any; tool_calls?: any[] }
type Seen = { system: string; lastUser: string; last: Msg; messages: Msg[]; path: string }
type Reply = { text?: string; tool?: { name: string; args: object } }
const seen: Seen[] = []
let callId = 0

const textOf = (m?: Msg) =>
  !m ? '' : typeof m.content === 'string' ? m.content : (m.content ?? []).map((p: any) => p.text ?? '').join(' ')
const isChat = (s: Seen) => s.system.startsWith('You are STEVE, a friendly')
const isControl = (s: Seen) => s.system.startsWith('You are STEVE, operating')

const VISUAL_HTML = `<!doctype html><html><body><h1>Test chart</h1><canvas id="c" width="400" height="200"></canvas>
<script src="steve://lib/chart/chart.umd.min.js"></script>
<script>
  window.chartOK = typeof Chart === 'function'
  new Chart(document.getElementById('c'), { type: 'bar', data: { labels: ['A', 'B'], datasets: [{ label: 'v', data: [3, 5] }] }, options: { animation: false } })
  fetch('https://example.com').then(() => (window.net = 'open'), () => (window.net = 'blocked'))
  window.stepsOK = !!steve.steps(3, (i) => (document.querySelector('h1').textContent = 'Step ' + i))
</script>
<script type="module">
  import * as THREE from 'three'
  import { OrbitControls } from 'three/addons/controls/OrbitControls.js'
  window.threeOK = typeof THREE.Scene === 'function' && typeof OrbitControls === 'function'
</script>
<script src="steve://lib/mermaid/mermaid.min.js"></script><script>window.mermaidOK = typeof mermaid === 'object'</script>
<link rel="stylesheet" href="steve://lib/katex/katex.min.css"><script src="steve://lib/katex/katex.min.js"></script>
<script>window.katexOK = katex.renderToString('x^2').includes('katex')</script>
</body></html>`

async function route(s: Seen): Promise<Reply> {
  if (s.system.startsWith('You create one interactive visual')) return { text: '```html\n' + VISUAL_HTML + '\n```' }
  if (s.system.startsWith('You are a background agent')) return { text: 'Report: Filament, Bevy and three.js compared.' }
  if (isControl(s)) {
    const actions = s.messages.filter((m) => m.role === 'tool').length
    if (actions === 0) return { tool: { name: 'click', args: { x: 640, y: 360 } } }
    if (textOf(s.messages[1]).includes('wait')) await sleep(5000) // time for the user to take over
    return { text: 'Clicked the middle of the screen.' }
  }
  if (s.last.role === 'tool') return { text: `Done. ${textOf(s.last).slice(0, 120)}` }
  const u = s.lastUser
  if (u.includes('Where is')) {
    const [, w, h] = u.match(/(\d+)x(\d+) pixels/) ?? ['', '1280', '720']
    return { text: `It's right here [POINT:${+w / 2},${+h / 2}:Center] in the middle. Anything else?` }
  }
  if (u.includes('long story')) return { text: 'One. Two. Three. Four. Five. Six. Seven. Eight.' }
  if (u.includes('chart')) return { tool: { name: 'show_visual', args: { title: 'Test chart', brief: 'A bar chart of A and B' } } }
  if (u.includes('I clicked')) return { text: 'That bar is the first value.' }
  if (u.includes('caffeine')) return { tool: { name: 'show_molecule', args: { name: 'caffeine' } } }
  if (u.includes('remember')) return { tool: { name: 'remember', args: { fact: 'likes cats' } } }
  if (u.includes('research')) return { tool: { name: 'start_task', args: { goal: 'Compare open-source rendering engines' } } }
  if (u.includes('control')) return { tool: { name: 'control_computer', args: { goal: u.includes('wait') ? 'Click and wait' : 'Click the middle' } } }
  return { text: 'Okay.' }
}

/** Responses API request items -> the chat-style messages the routes and checks look at. */
function fromResponses(body: any): Msg[] {
  const msgs: Msg[] = body.instructions ? [{ role: 'system', content: body.instructions }] : []
  for (const it of body.input ?? []) {
    if (it.type === 'function_call_output') msgs.push({ role: 'tool', content: typeof it.output === 'string' ? it.output : JSON.stringify(it.output) })
    else if (it.role) {
      msgs.push({ role: it.role, content: typeof it.content === 'string' ? it.content : it.content.map((c: any) =>
        c.type === 'input_image' ? { type: 'image_url', image_url: { url: c.image_url } } : { type: 'text', text: c.text ?? '' }) })
    }
  }
  return msgs
}

function sendResponses(res: ServerResponse, stream: boolean, r: Reply) {
  const id = ++callId
  const usage = { input_tokens: 10, output_tokens: 5 }
  const item = r.tool
    ? { type: 'function_call', id: `fc_${id}`, call_id: `call_${id}`, name: r.tool.name, arguments: JSON.stringify(r.tool.args), status: 'completed' }
    : { type: 'message', role: 'assistant', id: `msg_${id}`, status: 'completed', content: [{ type: 'output_text', text: r.text, annotations: [] }] }
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: `resp_${id}`, created_at: 0, model: 'mock', output: [item], usage }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const ev = (e: object) => res.write(`data: ${JSON.stringify(e)}\n\n`)
  ev({ type: 'response.created', response: { id: `resp_${id}`, created_at: 0, model: 'mock' } })
  if (r.tool) {
    ev({ type: 'response.output_item.added', output_index: 0, item: { ...item, arguments: '', status: 'in_progress' } })
    ev({ type: 'response.function_call_arguments.delta', item_id: item.id, output_index: 0, delta: (item as any).arguments })
    ev({ type: 'response.output_item.done', output_index: 0, item })
  } else {
    ev({ type: 'response.output_item.added', output_index: 0, item: { type: 'message', id: item.id } })
    for (const piece of r.text!.match(/[\s\S]{1,9}/g)!) ev({ type: 'response.output_text.delta', item_id: item.id, output_index: 0, delta: piece })
    ev({ type: 'response.output_item.done', output_index: 0, item: { type: 'message', id: item.id } })
  }
  ev({ type: 'response.completed', response: { usage } })
  res.end()
}

function send(res: ServerResponse, stream: boolean, r: Reply) {
  const toolCall = r.tool && { id: `call_${++callId}`, type: 'function', function: { name: r.tool.name, arguments: JSON.stringify(r.tool.args) } }
  const usage = { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 }
  const finish = r.tool ? 'tool_calls' : 'stop'
  if (!stream) {
    res.writeHead(200, { 'content-type': 'application/json' })
    res.end(JSON.stringify({ id: 'c', object: 'chat.completion', created: 0, model: 'mock', usage,
      choices: [{ index: 0, finish_reason: finish, message: { role: 'assistant', content: r.text ?? null, tool_calls: toolCall && [toolCall] } }] }))
    return
  }
  res.writeHead(200, { 'content-type': 'text/event-stream' })
  const chunk = (delta: object, finish_reason: string | null = null, extra = {}) =>
    res.write(`data: ${JSON.stringify({ id: 'c', object: 'chat.completion.chunk', created: 0, model: 'mock', choices: [{ index: 0, delta, finish_reason }], ...extra })}\n\n`)
  if (toolCall) chunk({ role: 'assistant', tool_calls: [{ index: 0, ...toolCall }] })
  else for (const piece of r.text!.match(/[\s\S]{1,9}/g)!) chunk({ content: piece }) // small pieces split tags across chunks
  chunk({}, finish, { usage })
  res.end('data: [DONE]\n\n')
}

const server = createServer(async (req, res) => {
  res.on('error', () => {}) // aborted requests
  let raw = ''
  for await (const c of req) raw += c
  const body = JSON.parse(raw || '{}')
  const responses = req.url!.endsWith('/responses')
  const messages: Msg[] = responses ? fromResponses(body) : body.messages ?? []
  const s: Seen = {
    system: textOf(messages.find((m) => m.role === 'system' || m.role === 'developer')),
    lastUser: textOf([...messages].reverse().find((m) => m.role === 'user')),
    last: messages.at(-1)!,
    messages,
    path: req.url!,
  }
  seen.push(s)
  try { (responses ? sendResponses : send)(res, !!body.stream, await route(s)) } catch { /* client went away */ }
})
await new Promise<void>((r) => server.listen(0, '127.0.0.1', r))
const port = (server.address() as { port: number }).port

// ---------- Launch STEVE with a throwaway profile ----------
const profile = mkdtempSync(join(tmpdir(), 'steve-e2e-'))
writeFileSync(join(profile, 'settings.json'), JSON.stringify({
  onboarded: true, voice: 'off', memory: true, browserAgent: false,
  // Chat mode uses STEVE's local-server setting; Responses mode keeps STEVE's default OpenAI path and
  // only redirects its base URL through the SDK's OPENAI_BASE_URL variable.
  openaiBaseURL: RESPONSES ? '' : `http://127.0.0.1:${port}/v1`,
}))
console.log(`Mock model speaks the ${RESPONSES ? 'Responses' : 'Chat Completions'} API`)
const app = await electron.launch({
  executablePath: electronPath as unknown as string,
  args: [
    '--no-sandbox', '--password-store=basic', '--use-fake-device-for-media-stream', '--use-fake-ui-for-media-stream',
    // Headless Linux (Xvfb) has no GPU: render WebGL in software.
    // Headless Linux also has no sound card: play audio to a fake output.
    ...(process.platform === 'linux' ? ['--use-angle=swiftshader', '--enable-unsafe-swiftshader', '--disable-audio-output'] : []),
    '.',
  ],
  cwd: join(import.meta.dirname, '..'),
  env: {
    ...process.env, STEVE_PROFILE: profile, OPENAI_API_KEY: 'test-key',
    ...(RESPONSES ? { OPENAI_BASE_URL: `http://127.0.0.1:${port}/v1` } : {}),
  } as Record<string, string>,
})
const logs: string[] = []
app.process().stdout?.on('data', (d) => logs.push(String(d)))
app.process().stderr?.on('data', (d) => logs.push(String(d)))

async function until<T>(what: string, fn: () => T | Promise<T>, ms = 15000): Promise<NonNullable<T>> {
  const end = Date.now() + ms
  let err: unknown
  while (Date.now() < end) {
    try { const v = await fn(); if (v) return v as NonNullable<T> } catch (e) { err = e }
    await sleep(150)
  }
  throw new Error(`timed out waiting for ${what}${err ? ` (${err})` : ''}`)
}
const results: { name: string; ok: boolean; why?: string }[] = []
async function check(name: string, fn: () => Promise<unknown>) {
  try { await fn(); results.push({ name, ok: true }); console.log(`PASS  ${name}`) }
  catch (e) { const why = e instanceof Error ? e.message : String(e); results.push({ name, ok: false, why }); console.log(`FAIL  ${name}: ${why}`) }
}
const windowFor = (name: string) => until(`${name} window`, () => app.windows().find((p) => p.url().includes(`/${name}.html`)))
const overlay = await windowFor('overlay')
const panel = await windowFor('panel')
const display = await app.evaluate(({ screen }) => screen.getPrimaryDisplay().bounds)
const buddyAt = () => overlay.evaluate(() => document.getElementById('buddy')!.style.transform)
const idle = () => panel.evaluate(() => document.getElementById('state')!.textContent!.startsWith('Hold'))

async function ask(text: string, withScreen = false) {
  await until('idle before asking', idle)
  const from = seen.length
  await panel.evaluate(([t, s]) => {
    (document.getElementById('with-screen') as HTMLInputElement).checked = s as boolean
    ;(document.getElementById('input') as HTMLTextAreaElement).value = t as string
    document.getElementById('send')!.click()
  }, [text, withScreen])
  return from
}
const nativePoint = (p: { x: number; y: number }) =>
  app.evaluate(({ screen }, q) => (process.platform === 'win32' ? screen.dipToScreenPoint(q) : q), p)
const mouseNear = async (p: { x: number; y: number }) => {
  const m = await nut.mouse.getPosition()
  return Math.abs(m.x - p.x) <= 2 && Math.abs(m.y - p.y) <= 2
}

// ---------- Checks ----------
await check('app starts with overlay, panel and audio windows', async () => {
  await windowFor('audio')
  const failed = logs.join('').match(/Talk keys are unavailable[^\n]*/)
  if (failed) throw new Error(failed[0])
})

await check('cursor buddy follows the real mouse', async () => {
  const p = await nativePoint({ x: display.x + 300, y: display.y + 200 })
  await nut.mouse.setPosition(new nut.Point(p.x, p.y))
  await until('buddy next to cursor', async () => (await buddyAt()) === 'translate(320px, 220px)')
})

await check('typed question with screenshot: model sees the screen and the buddy points at the right pixel', async () => {
  const from = await ask('Where is the center of the screen?', true)
  const req = await until('chat request', () => seen.slice(from).find(isChat))
  const image = (req.last.content as any[]).find((p) => p.type === 'image_url')
  if (!image?.image_url?.url?.startsWith('data:image/jpeg;base64,')) throw new Error('no JPEG screenshot in the request')
  const want = `translate(${display.width / 2}px, ${display.height / 2}px)`
  await until(`buddy at ${want}`, async () => (await buddyAt()) === want)
  await until('target ring drawn', () => overlay.evaluate((x) => document.querySelector('#shapes circle')?.getAttribute('cx') === String(x), display.width / 2))
  await until('reply in transcript without the tag', () => panel.evaluate(() => document.getElementById('log')!.textContent!.includes("It's right here in the middle.")))
})

let board: Page
const visualFrame = () => until('visual frame', () => board.frames().find((f) => f.url() === 'about:srcdoc'))

await check('visual: board opens, bundled Chart.js/Three.js/Mermaid/KaTeX load, step controls, network blocked', async () => {
  await ask('show me a chart')
  board = await windowFor('board')
  await until('libraries loaded', async () => (await visualFrame()).evaluate(() => {
    const w = window as any
    return w.chartOK && w.threeOK && w.mermaidOK && w.katexOK && w.stepsOK && !!document.getElementById('steve-steps')
  }))
  await until('fetch blocked by the sandbox', async () => (await visualFrame()).evaluate(() => (window as any).net === 'blocked'))
})

await check('clicking inside a visual asks STEVE about it', async () => {
  await until('idle', idle)
  const from = seen.length
  await (await visualFrame()).evaluate(() => (window as any).steve.select('Bar A', 'value 3'))
  await until('question about the click', () => seen.slice(from).some((s) => s.lastUser.includes('(I clicked "Bar A" in the visual "Test chart": value 3.)')))
})

await check('3D molecule from PubChem renders (WebGL)', async () => {
  await ask('show me caffeine')
  await until('molecule rendered', async () => (await visualFrame()).evaluate(() =>
    !!document.querySelector('canvas') && document.body.textContent!.includes('caffeine')), 30000)
})

await check('memory: remember writes facts.md', async () => {
  await ask('please remember I like cats')
  const facts = join(profile, 'memory', 'facts.md')
  await until('fact saved', () => existsSync(facts) && readFileSync(facts, 'utf8').includes('likes cats'))
})

await check('background task runs and its report shows in Tasks', async () => {
  await ask('research rendering engines for me')
  await until('task report', () => panel.evaluate(() => document.getElementById('tasks')!.textContent!.includes('Report: Filament')))
})

// Native permission dialogs cannot be clicked by the test; answer "Always allow" for it and count them.
await app.evaluate(({ dialog }) => {
  const g = globalThis as any
  g.dialogs = 0
  dialog.showMessageBox = (async () => { g.dialogs++; return { response: 0, checkboxChecked: false } }) as any
})
const dialogs = () => app.evaluate(() => (globalThis as any).dialogs as number)
const center = await nativePoint({ x: display.x + display.width / 2, y: display.y + display.height / 2 })

await check('computer control: banner, real click at the right spot, fresh screenshot after each action', async () => {
  await nut.mouse.setPosition(new nut.Point(50, 50))
  const from = await ask('control the computer: click the middle')
  await until('banner shown', () => overlay.evaluate(() => !document.getElementById('banner')!.hidden))
  await until('mouse at target', () => mouseNear(center))
  await until('control summary reached the chat model', () => seen.slice(from).some((s) => isChat(s) && textOf(s.last).includes('Clicked the middle')))
  const second = seen.slice(from).filter(isControl)[1]
  if (!JSON.stringify(second?.messages ?? []).includes('New screenshot')) throw new Error('no fresh screenshot after the click')
  await until('banner hidden', () => overlay.evaluate(() => document.getElementById('banner')!.hidden))
})

await check('"Always allow" turns on autopilot: the next task starts without asking', async () => {
  if (!JSON.parse(readFileSync(join(profile, 'settings.json'), 'utf8')).autopilot) throw new Error('autopilot not saved')
  const before = await dialogs()
  const from = await ask('control the computer: click the middle')
  await until('control summary reached the chat model', () => seen.slice(from).some((s) => isChat(s) && textOf(s.last).includes('Clicked the middle')))
  if ((await dialogs()) !== before) throw new Error('asked for permission again')
})

await check('computer control stops when the user moves the mouse', async () => {
  const from = await ask('control the computer and wait')
  await until('mouse at target', () => mouseNear(center))
  await sleep(1200)
  await nut.mouse.setPosition(new nut.Point(80, 80))
  await until('stopped', () => seen.slice(from).some((s) => isChat(s) && textOf(s.last).includes('took back control')), 10000)
})

await check('computer control stops on Esc', async () => {
  const from = await ask('control the computer and wait')
  await until('mouse at target', () => mouseNear(center))
  await sleep(1200)
  await nut.keyboard.type(nut.Key.Escape)
  await until('stopped', () => seen.slice(from).some((s) => isChat(s) && textOf(s.last).includes('took back control')), 10000)
})

await check('settings: a key saved in the panel is stored encrypted', async () => {
  await until('idle', idle)
  await panel.evaluate(() => (document.querySelector('nav button[data-tab="settings"]') as HTMLElement).click())
  await until('settings loaded', () => panel.evaluate(() => (document.querySelector('#tab-settings [data-key="deepgram"]') as HTMLInputElement).placeholder !== ''))
  await panel.evaluate(() => {
    (document.querySelector('#tab-settings [data-key="deepgram"]') as HTMLInputElement).value = 'dummy-deepgram-key'
    document.getElementById('save')!.click()
  })
  await until('saved', () => panel.evaluate(() => document.getElementById('saved')!.textContent === 'Saved.'))
  if (readFileSync(join(profile, 'settings.json'), 'utf8').includes('dummy-deepgram-key')) throw new Error('key stored in plain text')
  await panel.evaluate(() => (document.querySelector('nav button[data-tab="chat"]') as HTMLElement).click())
})

await check('push-to-talk: holding Ctrl+Alt listens, records the mic and sends it to Deepgram', async () => {
  await app.evaluate(({ ipcMain }) => { (globalThis as any).chunks = 0; ipcMain.on('mic-chunk', () => (globalThis as any).chunks++) })
  await nut.keyboard.pressKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  await until('listening', () => overlay.evaluate(() => document.getElementById('buddy')!.dataset.state === 'listening'), 5000)
  await sleep(1500)
  await nut.keyboard.releaseKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  const chunks = await app.evaluate(() => (globalThis as any).chunks as number)
  if (chunks < 5) throw new Error(`only ${chunks} audio chunks reached the main process`)
  // The dummy key is rejected, which proves the audio reached the Deepgram request.
  await until('Deepgram answered', () => panel.evaluate(() => document.getElementById('log')!.textContent!.includes('Could not reach Deepgram')), 15000)
})

await check('Ctrl+Alt+<key> shortcuts do not trigger push-to-talk', async () => {
  await until('idle', idle)
  await nut.keyboard.pressKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  await nut.keyboard.pressKey(nut.Key.T)
  await nut.keyboard.releaseKey(nut.Key.T)
  await nut.keyboard.releaseKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  await sleep(800)
  if (!(await idle())) throw new Error('STEVE is not idle after a Ctrl+Alt+T shortcut')
})

// ---------- Voice: Deepgram is faked inside the app; microphone, playback, model and overlay are real ----------
await app.evaluate(({ ipcMain }) => {
  const g = globalThis as any
  const v = (g.voice = { speak: [] as { text: string; auth: string }[], sttUrl: '', sttAuth: '', sttBytes: 0, played: 0, transcript: 'Where is the center of the screen?' })
  ipcMain.on('played', () => v.played++)
  // 0.3 s, 440 Hz, 16-bit mono WAV standing in for Deepgram's speech.
  const rate = 16000, n = rate * 0.3, wav = Buffer.alloc(44 + n * 2)
  wav.write('RIFF', 0); wav.writeUInt32LE(36 + n * 2, 4); wav.write('WAVEfmt ', 8); wav.writeUInt32LE(16, 16)
  wav.writeUInt16LE(1, 20); wav.writeUInt16LE(1, 22); wav.writeUInt32LE(rate, 24); wav.writeUInt32LE(rate * 2, 28)
  wav.writeUInt16LE(2, 32); wav.writeUInt16LE(16, 34); wav.write('data', 36); wav.writeUInt32LE(n * 2, 40)
  for (let i = 0; i < n; i++) wav.writeInt16LE(Math.round(8000 * Math.sin((2 * Math.PI * 440 * i) / rate)), 44 + i * 2)
  const realFetch = g.fetch
  g.fetch = async (url: any, init: any) => {
    if (!String(url).startsWith('https://api.deepgram.com/v1/speak')) return realFetch(url, init)
    v.speak.push({ text: JSON.parse(init.body).text, auth: init.headers.Authorization })
    return new Response(wav, { headers: { 'content-type': 'audio/wav' } })
  }
  g.WebSocket = class extends EventTarget {
    static CONNECTING = 0; static OPEN = 1; static CLOSING = 2; static CLOSED = 3
    readyState = 0
    constructor(url: string, opts: any) {
      super()
      v.sttUrl = url
      v.sttAuth = opts?.headers?.Authorization
      setTimeout(() => { this.readyState = 1; this.dispatchEvent(new Event('open')) }, 50)
    }
    send(m: any) {
      if (typeof m !== 'string') { v.sttBytes += m.byteLength; return }
      if (JSON.parse(m).type !== 'CloseStream') return
      setTimeout(() => {
        const result = { type: 'Results', is_final: true, channel: { alternatives: [{ transcript: v.transcript }] } }
        this.dispatchEvent(new MessageEvent('message', { data: JSON.stringify(result) }))
        this.close()
      }, 100)
    }
    close() { if (this.readyState !== 3) { this.readyState = 3; this.dispatchEvent(new Event('close')) } }
  }
})
const voice = () => app.evaluate(() => (globalThis as any).voice)

await check('voice turn: hold to talk, transcript, answer spoken sentence by sentence with pointing in sync', async () => {
  await until('idle', idle)
  await panel.evaluate(() => (document.querySelector('nav button[data-tab="settings"]') as HTMLElement).click())
  await until('settings loaded', () => panel.evaluate(() => (document.querySelector('#tab-settings select[data-setting="voice"]') as HTMLSelectElement).value !== ''))
  await panel.evaluate(() => {
    (document.querySelector('#tab-settings select[data-setting="voice"]') as HTMLSelectElement).value = 'deepgram'
    document.getElementById('saved')!.textContent = ''
    document.getElementById('save')!.click()
  })
  await until('saved', () => panel.evaluate(() => document.getElementById('saved')!.textContent === 'Saved.'))
  await panel.evaluate(() => (document.querySelector('nav button[data-tab="chat"]') as HTMLElement).click())
  await nut.mouse.setPosition(new nut.Point(40, 40))

  await nut.keyboard.pressKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  await sleep(1200)
  await nut.keyboard.releaseKey(nut.Key.LeftControl, nut.Key.LeftAlt)
  await until('both sentences played', async () => (await voice()).played >= 2, 20000)
  const v = await voice()
  if (!v.sttUrl.startsWith('wss://api.deepgram.com/v1/listen?model=nova-3')) throw new Error(`speech-to-text URL ${v.sttUrl}`)
  if (v.sttAuth !== 'Token dummy-deepgram-key' || v.sttBytes < 1000) throw new Error(`speech-to-text got ${v.sttBytes} bytes, auth ${v.sttAuth}`)
  const spoken = v.speak.map((x: { text: string }) => x.text)
  if (JSON.stringify(spoken) !== JSON.stringify(["It's right here in the middle.", 'Anything else?'])) throw new Error(`spoke ${JSON.stringify(spoken)}`)
  if (v.speak[0].auth !== 'Token dummy-deepgram-key') throw new Error('text-to-speech request without the key')
  const want = `translate(${display.width / 2}px, ${display.height / 2}px)`
  if ((await buddyAt()) !== want) throw new Error(`buddy at ${await buddyAt()}, expected ${want}`)
  if (!logs.join('').includes('[latency] key-up to first sentence')) throw new Error('no latency log')
})

await check('Esc stops STEVE mid-answer', async () => {
  await until('idle', idle)
  const before = (await voice()).played
  await ask('tell me a long story')
  await until('first sentence played', async () => (await voice()).played > before, 15000)
  await nut.keyboard.type(nut.Key.Escape)
  await until('idle after Esc', idle, 3000)
  const stoppedAt = (await voice()).played
  await sleep(2500)
  const after = (await voice()).played
  if (after > stoppedAt) throw new Error(`${after - stoppedAt} more sentences played after Esc`)
  if (after - before >= 8) throw new Error('the whole answer played')
})

await check(`every model call used the ${RESPONSES ? 'Responses' : 'Chat Completions'} API`, async () => {
  const want = RESPONSES ? '/v1/responses' : '/v1/chat/completions'
  const other = seen.filter((s) => s.path !== want).map((s) => s.path)
  if (!seen.length || other.length) throw new Error(`unexpected endpoints: ${[...new Set(other)].join(', ')}`)
})

await app.close()
server.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n${results.length - failed.length}/${results.length} checks passed`)
if (failed.length) { console.log('\nApp output:\n' + logs.join('').slice(-4000)); process.exit(1) }
