// STEVE main process: wires push-to-talk -> screenshot + speech-to-text -> model -> speech + pointing.
import { generateText, tool, type ToolSet } from 'ai'
import {
  app, BrowserWindow, clipboard, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, nativeTheme, Notification, screen,
  session, shell, systemPreferences, Tray,
} from 'electron'
import { release } from 'node:os'
import { z } from 'zod'
import { answerTask, initTasks, listTasks, startTask, stopTask } from './agents'
import { currentVisual, goVisual, hideBoard, moleculeHtml, registerLibProtocol, resizeBoard, saveVisual, showMaking, showVisual, visualFailed } from './board'
import { extractHtml, usesStage } from './visual'
import { chat, missingKey, model, note, seedHistory } from './brain'
import { capture, type Shot } from './capture'
import { controlComputer, controlling, stopControl } from './control'
import { startHotkeys, stopHotkeys } from './hotkey'
import { debugOn, keep, log, logDir, logError, short, timed } from './log'
import * as memory from './memory'
import { createOverlays, draw, toOverlays } from './overlay'
import { VISUAL_PROMPT } from './prompts'
import { getKeys, getSettings, loadKeys, saveSettings, setKeys, type KeyName } from './settings'
import { openStt, type Stt } from './stt'
import { createSpeaker } from './tts'
import { addListening, addTokens, onUsageChange, overLimit, usageSummary } from './usage'
import { errorText, loadPage, PRELOAD } from './windows'

type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'pointing'

let panel: BrowserWindow
let audio: BrowserWindow
let tray: Tray
let quitting = false

// ---------- UI helpers ----------
let lastState = ''
function setState(s: State) {
  if (s !== lastState) log('state', s)
  lastState = s
  toOverlays('state', s)
  panel?.webContents.send('state', s)
}
const caption = (text: string | null) => toOverlays('caption', text)
const transcript = (role: 'user' | 'assistant' | 'system' | 'note', text: string, append = false) =>
  panel?.webContents.send('transcript', { role, text, append })

function report(e: unknown) {
  const msg = errorText(e)
  if (debugOn) logError('error', e)
  else console.error('[steve]', msg)
  caption(`⚠ ${msg}`)
  transcript('system', msg)
}

function showPanel(tab?: string) {
  if (tab) panel.webContents.send('tab', tab)
  panel.show()
  panel.focus()
}

// ---------- Speaking ----------
let turn: AbortController | null = null
let played: (() => void) | null = null

function play(buf: ArrayBuffer) {
  return new Promise<void>((resolve) => {
    played = resolve
    audio.webContents.send('play', buf)
  })
}

/** Stops the current reply: model stream, pending speech, playback. */
function interrupt() {
  turn?.abort()
  turn = null
  audio?.webContents.send('stop')
  played?.()
  played = null
}

function chatTools(signal: AbortSignal): ToolSet {
  return {
    show_visual: tool({
      description: 'Show an interactive visual (diagram, chart, graph, timeline, step-by-step animation, 3D model) floating on the user\'s screen.',
      inputSchema: z.object({
        title: z.string(),
        brief: z.string().describe('Everything the visual should show and let the user do, including all data, labels, steps and which parts are clickable.'),
      }),
      execute: async ({ title, brief }, { abortSignal }) => {
        setState('working')
        await showMaking(title)
        log('visual', `asking ${getSettings().models.visual} for "${title}"`, brief)
        try {
          const { text, totalUsage } = await generateText({ model: model('visual'), system: VISUAL_PROMPT, prompt: brief, abortSignal })
          addTokens(getSettings().models.visual, totalUsage)
          const html = extractHtml(text)
          log('visual', `got ${html.length} chars of HTML${usesStage(html) ? ' (3D kit)' : ''}`, { in: totalUsage.inputTokens, out: totalUsage.outputTokens })
          keep('last-visual.html', html) // open it in a browser, or read it, when a visual looks wrong
          if (!/<(script|svg|canvas|body|div|html)\b/i.test(html)) throw new Error('the model replied without a visual')
          await showVisual(title, html)
        } catch (e) {
          visualFailed(abortSignal?.aborted ? null : `Couldn't make "${title}": ${errorText(e)}`)
          throw e
        }
        return `The visual "${title}" is showing on the user's screen.`
      },
    }),
    show_molecule: tool({
      description: 'Show an interactive 3D model of a real molecule (from PubChem) floating on the user\'s screen.',
      inputSchema: z.object({ name: z.string().describe('Common or IUPAC name, e.g. "caffeine"') }),
      execute: async ({ name }) => {
        await showMaking(name)
        try { await showVisual(name, await moleculeHtml(name)) } catch (e) { visualFailed(`Couldn't show ${name}: ${errorText(e)}`); throw e }
        return `A 3D model of ${name} is showing on the user's screen. The user can click atoms.`
      },
    }),
    remember: tool({
      description: 'Save a lasting fact or preference about the user.',
      inputSchema: z.object({ fact: z.string() }),
      execute: async ({ fact }) => {
        if (!getSettings().memory) return 'Memory is turned off in settings.'
        memory.remember(fact)
        return 'Saved.'
      },
    }),
    forget: tool({
      description: 'Delete remembered facts that contain the given words.',
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => `Removed ${memory.forget(text)} memories.`,
    }),
    start_task: tool({
      description: 'Start a background agent for a longer job (research, comparisons, collecting information, multi-step web work).',
      inputSchema: z.object({ goal: z.string().describe('A complete, self-contained description of the job and the expected result.') }),
      execute: async ({ goal }) => {
        const blocked = missingKey('agent')
        if (blocked) return blocked
        const t = startTask(goal)
        panel.webContents.send('tab', 'tasks')
        return `Task ${t.id} started. Progress is in the Tasks tab.`
      },
    }),
    read_clipboard: tool({
      description: 'Read what the user copied (text or an image). Use it when they refer to something they copied or selected, like "explain what I copied" or "translate this".',
      inputSchema: z.object({}),
      execute: async () => {
        transcript('note', 'Read your clipboard.') // the user always sees when STEVE looked
        const text = (await clipboard.readText()).slice(0, 12000)
        if (text.trim()) return { kind: 'text', text }
        const item = (await clipboard.read()).find((i) => i.types.includes('image/png'))
        if (!item) return { kind: 'empty' }
        const img = nativeImage.createFromBuffer(Buffer.from(await (await item.getType('image/png')).arrayBuffer()))
        if (img.isEmpty()) return { kind: 'empty' }
        const jpeg = (img.getSize().width > 1600 ? img.resize({ width: 1600 }) : img).toJPEG(80)
        return { kind: 'image', data: jpeg.toString('base64') }
      },
      toModelOutput: ({ output }: { output: any }) => output.kind === 'image'
        ? { type: 'content' as const, value: [
            { type: 'text' as const, text: 'The clipboard holds this image:' },
            { type: 'file' as const, data: { type: 'data' as const, data: output.data }, mediaType: 'image/jpeg' },
          ] }
        : { type: 'text' as const, value: output.kind === 'text' ? `Clipboard text:\n${output.text}` : 'The clipboard is empty.' },
    }),
    copy_to_clipboard: tool({
      description: 'Put text on the clipboard so the user can paste it, such as a translation or a rewrite. Tell them you copied it.',
      inputSchema: z.object({ text: z.string() }),
      execute: async ({ text }) => {
        await clipboard.writeText(text)
        transcript('note', 'Copied to your clipboard.')
        return 'Copied.'
      },
    }),
    control_computer: tool({
      description: 'Use the mouse and keyboard to do something on this computer for the user.',
      inputSchema: z.object({ goal: z.string() }),
      execute: async ({ goal }) => {
        setState('working')
        return controlComputer(goal, {
          banner: (text) => toOverlays('banner', text),
          point: (x, y, shot) => draw([{ kind: 'point', x, y, label: '' }], shot),
        }, signal)
      },
    }),
  }
}

/** Logs every tool call: what the model asked for, how long it took, and what came back. */
function logged(tools: ToolSet): ToolSet {
  for (const [name, t] of Object.entries(tools)) {
    const run = t.execute as ((input: unknown, opts: unknown) => unknown) | undefined
    if (run) (t as { execute: unknown }).execute = (input: unknown, opts: unknown) =>
      timed('tool', `${name} ${short(input, 200)}`, async () => run(input, opts), (r) => short(r, 200))
  }
  return tools
}

/** One question and its answer. A spoken question (`voice`) is followed by a few seconds of hands-free listening. */
async function runTurn(text: string, shot: Shot | null, { keyUpAt = Date.now(), voice = false } = {}) {
  interrupt()
  pttCancel() // a typed question ends any hands-free listening
  const blocked = missingKey('chat') ?? overLimit()
  if (blocked) { report(blocked); setState('idle'); if (!overLimit()) showPanel('settings'); return }
  let completed = false
  const abort = new AbortController()
  turn = abort
  const t0 = Date.now()
  let said = ''
  log('turn', `${voice ? 'spoken' : 'typed'} question: "${text}"`, { screen: shot ? `${shot.width}x${shot.height}` : 'none' })
  toOverlays('draw', [{ kind: 'clear' }])
  setState('thinking')
  transcript('user', text)
  transcript('assistant', '')
  let first = true
  const speaker = createSpeaker({
    onSentence: (s) => {
      if (first) { first = false; log('latency', `key-up to first sentence: ${Date.now() - keyUpAt} ms`) }
      if (s.tags.length) log('draw', shot ? 'on screen' : 'skipped: no screenshot with this question', s.tags)
      if (shot && s.tags.length) draw(s.tags, shot)
      said += s.text + ' '
      setState(s.tags.some((t) => t.kind === 'point') ? 'pointing' : 'speaking')
      if (s.text) { caption(s.text); transcript('assistant', s.text + ' ', true) }
    },
    play,
    onError: report,
  }, abort.signal)
  try {
    for await (const chunk of chat(text, shot, logged(chatTools(abort.signal)), abort.signal)) speaker.push(chunk)
    await speaker.end()
    completed = !abort.signal.aborted
    log('turn', completed ? `answered in ${Date.now() - t0} ms` : 'interrupted', said.trim())
  } catch (e) {
    if (!abort.signal.aborted) report(e)
  } finally {
    if (turn === abort) {
      turn = null
      setState('idle')
      setTimeout(() => { if (!turn && !listening) caption(null) }, 4000)
    }
  }
  if (completed && voice && !turn && !listening && getSettings().followUps) listen(true)
}

// ---------- Listening: push-to-talk, and hands-free follow-ups ----------
const FOLLOW_UP_MS = 6000 // how long STEVE waits for a reply without the keys
type Listening = {
  id: number; stt: Stt; handsFree: boolean
  shot: Promise<Shot | null> | null // hands-free looks at the screen only once you start talking
  started: number; at: number; timer?: ReturnType<typeof setTimeout>
}
let listening: Listening | null = null
let micId = 0

function listen(handsFree: boolean) {
  const key = getKeys().deepgram
  if (!key) {
    if (!handsFree) { report('Add a Deepgram key in settings to talk to STEVE, or type in the panel.'); showPanel('settings') }
    return
  }
  const limit = overLimit()
  if (limit) { if (!handsFree) report(limit); return }
  log('mic', handsFree ? `listening hands-free for ${FOLLOW_UP_MS / 1000} s` : 'listening (talk keys held)')
  setState('listening')
  caption(null)
  const look = () => { toOverlays('flash'); return capture().catch((e) => { report(e); return null }) } // flash: "screen captured"
  const id = ++micId
  const l: Listening = {
    id, handsFree, started: Date.now(), at: Date.now(), shot: handsFree ? null : look(),
    stt: openStt(key, (t) => {
      if (micId !== id) return // a newer question has started
      caption(t || (handsFree ? null : '…'))
      if (t && !l.shot) {
        l.shot = look()
        clearTimeout(l.timer)
        l.timer = setTimeout(() => endListening(id), 30000) // nobody talks for this long in one go
      }
    }, handsFree ? () => endListening(id) : undefined),
  }
  // Nothing said in time: stop listening quietly.
  if (handsFree) l.timer = setTimeout(() => { if (listening === l && !l.shot) { log('mic', 'no reply heard: stopped listening'); pttCancel() } }, FOLLOW_UP_MS)
  listening = l
  audio.webContents.send('mic-start', id)
}

/** Stops recording and lets the transcript finish (key-up, or the end of a hands-free reply). */
function endListening(id?: number) {
  const l = listening
  if (!l || (id !== undefined && l.id !== id)) return
  clearTimeout(l.timer)
  log('mic', `recording stopped after ${Date.now() - l.started} ms`)
  setState('thinking')
  l.at = Date.now() // the start of the latency budget
  audio.webContents.send('mic-stop', l.id)
}

function pttDown() {
  log('keys', 'talk keys down')
  interrupt()
  stopControl()
  pttCancel() // a new question replaces one still being recorded or transcribed
  listen(false)
}

const pttUp = () => { log('keys', 'talk keys up'); endListening() }

function pttCancel() {
  const l = listening
  if (!l) return
  log('mic', 'listening cancelled')
  clearTimeout(l.timer)
  audio.webContents.send('mic-stop', l.id)
  l.stt.cancel()
  addListening((Date.now() - l.started) / 1000)
  listening = null
  setState('idle')
  caption(null)
}

async function micDone(id: number) {
  const l = listening
  if (!l || l.id !== id) return
  listening = null
  addListening((Date.now() - l.started) / 1000)
  try {
    const text = await l.stt.finish()
    log('mic', text ? `transcript: "${text}"` : 'nothing was heard')
    if (listening) return // the user already started a new question
    if (!text) { if (!l.handsFree) caption("I didn't catch that."); setState('idle'); return }
    await runTurn(text, await l.shot, { keyUpAt: l.at, voice: true })
  } catch (e) {
    report(e)
    setState('idle')
  }
}

// ---------- Windows ----------
function createPanel() {
  const area = screen.getPrimaryDisplay().workArea
  panel = new BrowserWindow({
    width: 420, height: 660, minWidth: 340, minHeight: 420, x: area.x + area.width - 440, y: area.y + area.height - 680,
    show: false, title: 'STEVE', webPreferences: { preload: PRELOAD },
    // Frosted glass on macOS; elsewhere the page's own light or dark background.
    ...(process.platform === 'darwin'
      ? { vibrancy: 'under-window' as const, visualEffectState: 'active' as const, backgroundColor: '#00000000' }
      : { backgroundColor: nativeTheme.shouldUseDarkColors ? '#1b1a22' : '#f5f5f8' }),
  })
  panel.setContentProtection(true)
  panel.on('close', (e) => { if (!quitting) { e.preventDefault(); panel.hide() } })
  loadPage(panel, 'panel')
}

function createAudio() {
  audio = new BrowserWindow({ show: false, webPreferences: { preload: PRELOAD, backgroundThrottling: false } })
  loadPage(audio, 'audio')
}

function trayIcon() {
  // STEVE's face drawn in code, so no image asset is needed: a black template on macOS (the menu bar
  // tints it), yellow with dark eyes elsewhere. Pixels are BGRA.
  const size = 32, mac = process.platform === 'darwin'
  const px = Buffer.alloc(size * size * 4)
  const cover = (d: number) => Math.max(0, Math.min(1, 0.5 - d)) // signed distance -> antialiased coverage
  const eye = (x: number, y: number, cx: number) => cover((Math.hypot((x - cx) / 2.3, (y - 13.5) / 3.1) - 1) * 2.6)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const fx = x + 0.5, fy = y + 0.5
    const body = cover(Math.hypot(fx - 16, (fy - 16.5) * 1.06) - 13.5)
    const eyes = Math.max(eye(fx, fy, 11.6), eye(fx, fy, 20.4))
    const i = (y * size + x) * 4
    if (mac) { px[i + 3] = Math.round(255 * body * (1 - eyes)); continue }
    const [b, g, r] = eyes > 0.5 ? [0x2e, 0x1f, 0x22] : [0x3f, 0xd2, 0xff]
    px[i] = b; px[i + 1] = g; px[i + 2] = r; px[i + 3] = Math.round(255 * body)
  }
  const img = nativeImage.createFromBitmap(px, { width: size, height: size, scaleFactor: 2 })
  img.setTemplateImage(mac)
  return img
}

// ---------- IPC ----------
function settingsView() {
  const keys = getKeys()
  return {
    settings: getSettings(),
    keysSet: Object.fromEntries((['openai', 'anthropic', 'google', 'deepgram', 'elevenlabs'] as KeyName[]).map((k) => [k, !!keys[k]])),
    platform: process.platform,
    memoryDir: memory.memoryDir(),
  }
}

function permissionStatus() {
  if (process.platform !== 'darwin') return null
  return {
    microphone: systemPreferences.getMediaAccessStatus('microphone'),
    screen: systemPreferences.getMediaAccessStatus('screen'),
    accessibility: systemPreferences.isTrustedAccessibilityClient(false) ? 'granted' : 'not-determined',
  }
}

function registerIpc() {
  ipcMain.handle('settings:get', () => settingsView())
  ipcMain.handle('settings:save', (_e, patch) => {
    log('settings', 'saved', patch.mcpServers ? { ...patch, mcpServers: Object.keys(patch.mcpServers) } : patch) // tool servers' env can hold tokens
    saveSettings(patch)
    return settingsView()
  })
  ipcMain.handle('keys:save', async (_e, patch: Partial<Record<KeyName, string>>) => {
    log('settings', 'API keys saved', Object.keys(patch)) // names only, never the keys
    await setKeys(patch)
    return settingsView()
  })
  ipcMain.handle('perm:status', () => permissionStatus())
  ipcMain.handle('perm:request', async (_e, kind: string) => {
    if (kind === 'microphone') await systemPreferences.askForMediaAccess('microphone')
    if (kind === 'screen') {
      await desktopCapturer.getSources({ types: ['screen'] }) // makes macOS list STEVE under Screen Recording
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_ScreenCapture')
    }
    if (kind === 'accessibility') systemPreferences.isTrustedAccessibilityClient(true)
    return permissionStatus()
  })
  ipcMain.handle('memory:open', () => shell.openPath(memory.ensureDir()))
  ipcMain.handle('memory:wipe', () => memory.wipe())
  ipcMain.handle('usage:get', () => usageSummary())
  ipcMain.on('board:go', (_e, i: number) => goVisual(i))
  ipcMain.handle('board:save', () => saveVisual())
  ipcMain.on('board:close', () => hideBoard())
  ipcMain.on('board:size', () => resizeBoard())
  ipcMain.on('open-link', (_e, url: string) => { if (/^https:\/\//.test(String(url))) void shell.openExternal(url) })
  ipcMain.handle('tasks:list', () => listTasks())
  ipcMain.on('tasks:stop', (_e, id: string) => stopTask(id))
  ipcMain.on('tasks:answer', (_e, id: string, text: string) => answerTask(id, text))

  ipcMain.on('ask', async (_e, text: string, withScreen: boolean) => {
    let shot: Shot | null = null
    if (withScreen) { toOverlays('flash'); shot = await capture().catch((e) => { report(e); return null }) }
    void runTurn(text, shot)
  })
  ipcMain.on('ptt', (_e, phase: 'down' | 'up') => (phase === 'down' ? pttDown() : pttUp()))
  ipcMain.on('stop', () => { interrupt(); stopControl(); setState('idle') })
  ipcMain.on('mic-chunk', (_e, id: number, chunk: ArrayBuffer) => { if (listening?.id === id) listening.stt.send(chunk) })
  ipcMain.on('mic-done', (_e, id: number) => void micDone(id))
  ipcMain.on('mic-error', (_e, msg: string) => { report(`Microphone: ${msg}`); pttCancel() })
  ipcMain.on('played', () => { played?.(); played = null })
  ipcMain.on('visual-select', (_e, sel: { label: string; detail: string }) => {
    log('visual', `clicked "${sel.label}"`, sel.detail)
    const label = String(sel.label).slice(0, 200)
    const detail = String(sel.detail ?? '').slice(0, 500)
    void runTurn(`(I clicked "${label}" in the visual "${currentVisual}"${detail ? `: ${detail}` : ''}.) Explain what it is and how it fits in, briefly.`, null)
  })
}

// ---------- App ----------
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
  if (!debugOn) return
  // Every window's console, page errors and crashes go to the log; messages from inside a visual are marked "visual".
  const page = () => wc.getURL().match(/(\w+)\.html/)?.[1] ?? 'window'
  wc.on('console-message', (e) => {
    let where = page()
    try { if (e.frame && e.frame !== wc.mainFrame) where = 'visual' } catch { /* frame already gone */ }
    log(where, `console ${e.level}: ${short(e.message, 400)}`, e.level === 'error' || e.level === 'warning' ? `at ${e.sourceId || 'page'}:${e.lineNumber}` : undefined)
  })
  wc.on('did-fail-load', (_e, code, desc, url) => { if (code !== -3) log(page(), `failed to load ${url}: ${desc} (${code})`) }) // -3: replaced by a newer page
  wc.on('preload-error', (_e, path, err) => logError(page(), err))
  wc.on('render-process-gone', (_e, d) => log(page(), `renderer crashed: ${d.reason} (exit code ${d.exitCode})`))
  wc.on('unresponsive', () => log(page(), 'window stopped responding'))
})
if (debugOn) process.on('unhandledRejection', (e) => logError('unhandled', e))

// A separate profile folder (settings, keys, memory), e.g. for the end-to-end test.
if (process.env.STEVE_PROFILE) app.setPath('userData', process.env.STEVE_PROFILE)
if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  await loadKeys()
  {
    const s = getSettings(), k = getKeys()
    log('app', `STEVE ${app.getVersion()} starting (debug log: ${logDir()}/steve.log)`, {
      os: `${process.platform} ${release()} ${process.arch}`, electron: process.versions.electron, profile: app.getPath('userData'),
    })
    log('app', 'settings', {
      ...s, mcpServers: Object.keys(s.mcpServers), // server names only: their env can hold tokens
      keys: Object.entries(k).filter(([, v]) => v).map(([n]) => n),
    })
  }
  if (process.platform === 'darwin') app.dock?.hide()
  // Only the hidden audio window may use the microphone; nothing gets other permissions.
  session.defaultSession.setPermissionRequestHandler((wc, permission, cb) => cb(permission === 'media' && wc === audio?.webContents))
  registerLibProtocol()
  registerIpc()
  createOverlays()
  createAudio()
  createPanel()

  tray = new Tray(trayIcon())
  tray.setToolTip('STEVE')
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Open STEVE', click: () => showPanel('chat') },
    { label: 'Tasks', click: () => showPanel('tasks') },
    { label: 'Settings', click: () => showPanel('settings') },
    { type: 'separator' },
    { label: 'Quit STEVE', click: () => app.quit() },
  ]))
  tray.on('click', () => showPanel('chat'))

  const escape = () => {
    if (controlling()) stopControl()
    else if (turn) { interrupt(); setState('idle') }
    else if (listening?.handsFree) pttCancel()
  }
  startHotkeys({ down: pttDown, up: pttUp, cancel: pttCancel, escape, error: report })
  onUsageChange(() => panel.webContents.send('usage', usageSummary()))
  globalShortcut.register('CommandOrControl+Shift+Space', () => showPanel('chat'))

  initTasks({
    changed: (tasks) => panel.webContents.send('tasks', tasks),
    finished: (t) => {
      note(`Background task "${t.goal}" ${t.status}:\n${t.result}`)
      new Notification({ title: t.status === 'done' ? 'STEVE finished a task' : 'STEVE task failed', body: t.goal }).show()
    },
  })

  const s = getSettings()
  if (s.memory) seedHistory(memory.recentTurns())
  panel.webContents.once('did-finish-load', () => { if (!s.onboarded) showPanel('setup') })
})

app.on('before-quit', () => { quitting = true })
app.on('will-quit', () => { globalShortcut.unregisterAll(); stopHotkeys() })
app.on('window-all-closed', () => { /* tray app: keep running */ })
