// STEVE main process: wires push-to-talk -> screenshot + speech-to-text -> model -> speech + pointing.
import { generateText, tool, type ToolSet } from 'ai'
import {
  app, BrowserWindow, desktopCapturer, globalShortcut, ipcMain, Menu, nativeImage, Notification, screen, session, shell,
  systemPreferences, Tray,
} from 'electron'
import { z } from 'zod'
import { answerTask, initTasks, listTasks, startTask, stopTask } from './agents'
import { currentVisual, moleculeHtml, registerLibProtocol, showVisual } from './board'
import { extractHtml } from './visual'
import { chat, missingKey, model, note, seedHistory } from './brain'
import { capture, type Shot } from './capture'
import { controlComputer, controlling, stopControl } from './control'
import { startHotkeys, stopHotkeys } from './hotkey'
import * as memory from './memory'
import { createOverlays, draw, toOverlays } from './overlay'
import { VISUAL_PROMPT } from './prompts'
import { getKeys, getSettings, loadKeys, saveSettings, setKeys, type KeyName } from './settings'
import { openStt, type Stt } from './stt'
import { createSpeaker } from './tts'
import { errorText, loadPage, PRELOAD } from './windows'

type State = 'idle' | 'listening' | 'thinking' | 'speaking' | 'working' | 'pointing'

let panel: BrowserWindow
let audio: BrowserWindow
let tray: Tray
let quitting = false

// ---------- UI helpers ----------
function setState(s: State) {
  toOverlays('state', s)
  panel?.webContents.send('state', s)
}
const caption = (text: string | null) => toOverlays('caption', text)
const transcript = (role: 'user' | 'assistant' | 'system', text: string, append = false) =>
  panel?.webContents.send('transcript', { role, text, append })

function report(e: unknown) {
  const msg = errorText(e)
  console.error('[steve]', msg)
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
      description: 'Open an interactive visual (diagram, chart, graph, timeline, step-by-step animation, 3D model) on the board.',
      inputSchema: z.object({
        title: z.string(),
        brief: z.string().describe('Everything the visual should show and let the user do, including all data, labels, steps and which parts are clickable.'),
      }),
      execute: async ({ title, brief }, { abortSignal }) => {
        setState('working')
        const { text } = await generateText({ model: model('visual'), system: VISUAL_PROMPT, prompt: brief, abortSignal })
        await showVisual(title, extractHtml(text))
        return `The visual "${title}" is open on the board.`
      },
    }),
    show_molecule: tool({
      description: 'Show an interactive 3D model of a real molecule (from PubChem) on the board.',
      inputSchema: z.object({ name: z.string().describe('Common or IUPAC name, e.g. "caffeine"') }),
      execute: async ({ name }) => {
        await showVisual(name, await moleculeHtml(name))
        return `A 3D model of ${name} is open on the board. The user can click atoms.`
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
    control_computer: tool({
      description: 'Take over the mouse and keyboard to do something on this computer. Only when the user explicitly asks you to do it.',
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

async function runTurn(text: string, shot: Shot | null, keyUpAt = Date.now()) {
  interrupt()
  const blocked = missingKey('chat')
  if (blocked) { report(blocked); showPanel('settings'); setState('idle'); return }
  const abort = new AbortController()
  turn = abort
  toOverlays('draw', [{ kind: 'clear' }])
  setState('thinking')
  transcript('user', text)
  transcript('assistant', '')
  let first = true
  const speaker = createSpeaker({
    onSentence: (s) => {
      if (first) { first = false; console.log(`[latency] key-up to first sentence: ${Date.now() - keyUpAt} ms`) }
      if (shot && s.tags.length) draw(s.tags, shot)
      setState(s.tags.some((t) => t.kind === 'point') ? 'pointing' : 'speaking')
      if (s.text) { caption(s.text); transcript('assistant', s.text + ' ', true) }
    },
    play,
    onError: report,
  }, abort.signal)
  try {
    for await (const chunk of chat(text, shot, chatTools(abort.signal), abort.signal)) speaker.push(chunk)
    await speaker.end()
  } catch (e) {
    if (!abort.signal.aborted) report(e)
  } finally {
    if (turn === abort) {
      turn = null
      setState('idle')
      setTimeout(() => { if (!turn && !listening) caption(null) }, 4000)
    }
  }
}

// ---------- Push-to-talk ----------
type Listening = { id: number; shot: Promise<Shot | null>; stt: Stt; at: number }
let listening: Listening | null = null
let micId = 0

function pttDown() {
  interrupt()
  stopControl()
  pttCancel() // a new question replaces one still being recorded or transcribed
  const key = getKeys().deepgram
  if (!key) { report('Add a Deepgram key in settings to talk to STEVE, or type in the panel.'); showPanel('settings'); return }
  setState('listening')
  caption(null)
  toOverlays('flash') // visible "screen captured" indicator
  const shot = capture().catch((e) => { report(e); return null })
  const id = ++micId
  listening = { id, shot, at: Date.now(), stt: openStt(key, (t) => caption(t || '…')) }
  audio.webContents.send('mic-start', id)
}

function pttUp() {
  if (!listening) return
  setState('thinking')
  listening.at = Date.now() // key-up: start of the latency budget
  audio.webContents.send('mic-stop', listening.id)
}

function pttCancel() {
  if (!listening) return
  audio.webContents.send('mic-stop', listening.id)
  listening.stt.cancel()
  listening = null
  setState('idle')
  caption(null)
}

async function micDone(id: number) {
  const l = listening
  if (!l || l.id !== id) return
  listening = null
  try {
    const text = await l.stt.finish()
    if (listening) return // the user already started a new question
    if (!text) { caption("I didn't catch that."); setState('idle'); return }
    await runTurn(text, await l.shot, l.at)
  } catch (e) {
    report(e)
    setState('idle')
  }
}

// ---------- Windows ----------
function createPanel() {
  const area = screen.getPrimaryDisplay().workArea
  panel = new BrowserWindow({
    width: 440, height: 660, x: area.x + area.width - 460, y: area.y + area.height - 680,
    show: false, title: 'STEVE', backgroundColor: '#0f1115', webPreferences: { preload: PRELOAD },
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
  // A small filled circle drawn in code, so no image asset is needed.
  const size = 32
  const px = Buffer.alloc(size * size * 4)
  for (let y = 0; y < size; y++) for (let x = 0; x < size; x++) {
    const d = Math.hypot(x - 15.5, y - 15.5)
    const i = (y * size + x) * 4
    px.fill(160, i, i + 3)
    px[i + 3] = d < 12 ? 255 : d < 13 ? 128 : 0
  }
  const img = nativeImage.createFromBitmap(px, { width: size, height: size, scaleFactor: 2 })
  img.setTemplateImage(true)
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
  ipcMain.handle('settings:save', (_e, patch) => { saveSettings(patch); return settingsView() })
  ipcMain.handle('keys:save', async (_e, patch: Partial<Record<KeyName, string>>) => { await setKeys(patch); return settingsView() })
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
    const label = String(sel.label).slice(0, 200)
    const detail = String(sel.detail ?? '').slice(0, 500)
    void runTurn(`(I clicked "${label}" in the visual "${currentVisual}"${detail ? `: ${detail}` : ''}.) Explain what it is and how it fits in, briefly.`, null)
  })
}

// ---------- App ----------
app.on('web-contents-created', (_e, wc) => {
  wc.setWindowOpenHandler(() => ({ action: 'deny' }))
  wc.on('will-navigate', (e) => e.preventDefault())
})

// A separate profile folder (settings, keys, memory), e.g. for the end-to-end test.
if (process.env.STEVE_PROFILE) app.setPath('userData', process.env.STEVE_PROFILE)
if (!app.requestSingleInstanceLock()) app.quit()

app.whenReady().then(async () => {
  await loadKeys()
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

  startHotkeys({ down: pttDown, up: pttUp, cancel: pttCancel, escape: () => { if (controlling()) stopControl(); else if (turn) { interrupt(); setState('idle') } }, error: report })
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
