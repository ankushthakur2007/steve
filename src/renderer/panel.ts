// The panel: typed chat, background tasks, settings, usage and first-run setup. All text is set with
// textContent, never innerHTML, because it comes from the model and from web pages.
import './theme.css'

const { steve } = window
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[]
const h = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text })

const mac = navigator.userAgent.includes('Mac')
const TALK = mac ? 'Control + Option' : 'Ctrl + Alt'
$$('.k-talk').forEach((e) => (e.textContent = TALK))
if (mac) document.documentElement.classList.add('glass') // the window is frosted glass on macOS

// ---------- Tabs ----------
function showTab(name: string) {
  $$('main > section').forEach((s) => (s.hidden = s.id !== `tab-${name}`))
  $$('nav button').forEach((b) => { b.classList.toggle('on', b.dataset.tab === name); b.setAttribute('aria-selected', String(b.dataset.tab === name)) })
  $('#composer').hidden = name !== 'chat'
  $('nav').hidden = name === 'setup'
  if (name === 'settings' || name === 'setup') void loadSettings()
  if (name === 'tasks') void steve.invoke('tasks:list').then(renderTasks)
}
$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab!)))
steve.on('tab', showTab)

// ---------- State ----------
const STATE_TEXT: Record<string, string> = {
  idle: `Hold ${TALK} to talk`, listening: 'Listening…', thinking: 'Thinking…',
  speaking: 'Speaking. Esc stops me.', pointing: 'Showing you…', working: 'Working on it…',
}
let busy = false
steve.on('state', (s: string) => {
  $('#state').textContent = STATE_TEXT[s] ?? s
  $('#face').dataset.state = s
  busy = s !== 'idle'
  $('#stop').hidden = !busy
})

// ---------- Chat ----------
const log = $('#log')
steve.on('transcript', (m: { role: string; text: string; append: boolean }) => {
  const last = log.lastElementChild
  if (m.append && last?.classList.contains(m.role)) last.textContent += m.text
  else if (m.text || m.role === 'assistant') log.append(h('div', `msg ${m.role}`, m.text))
  log.lastElementChild?.scrollIntoView({ block: 'end' })
})

const input = $<HTMLTextAreaElement>('#input')
const ask = (text: string) => steve.send('ask', text, $<HTMLInputElement>('#with-screen').checked)
function send() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  ask(text)
}
$('#send').addEventListener('click', send)
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
$$('[data-ask]').forEach((b) => b.addEventListener('click', () => ask(b.dataset.ask!)))
$$('[data-demo]').forEach((b) => b.addEventListener('click', () => steve.send('demo', Number(b.dataset.demo))))
// Until STEVE can answer (no key yet), the empty chat offers the key-free 3D demos instead of questions.
const refreshCanChat = async () => document.body.classList.toggle('can-chat', (await steve.invoke<View>('settings:get')).canChat)
void refreshCanChat()
$('#stop').addEventListener('click', () => steve.send('stop'))

const talk = $('#talk')
let talking = false
talk.addEventListener('pointerdown', () => { talking = true; talk.classList.add('on'); steve.send('ptt', 'down') })
for (const ev of ['pointerup', 'pointerleave'] as const) {
  talk.addEventListener(ev, () => { if (talking) { talking = false; talk.classList.remove('on'); steve.send('ptt', 'up') } })
}

// ---------- Tasks ----------
type Task = { id: string; goal: string; status: string; log: string[]; result?: string; question?: string }
const STATUS: Record<string, string> = { running: 'Working', waiting: 'Needs your answer', done: 'Done', failed: 'Failed', stopped: 'Stopped' }
function renderTasks(tasks: Task[]) {
  const box = $('#tasks')
  const active = tasks.filter((t) => t.status === 'running' || t.status === 'waiting').length
  $('#task-count').hidden = !active
  $('#task-count').textContent = String(active)
  box.replaceChildren(...tasks.slice().reverse().map((t) => {
    const card = h('article', 'task')
    card.append(h('span', `status ${t.status}`, STATUS[t.status] ?? t.status), h('div', 'goal', t.goal))
    if (t.question) {
      card.append(h('div', 'msg system', t.question))
      const row = h('div', 'ask')
      const answer = h('input') as HTMLInputElement
      answer.placeholder = 'Your answer'
      const btn = h('button', 'primary', 'Answer')
      const submit = () => answer.value.trim() && steve.send('tasks:answer', t.id, answer.value.trim())
      btn.addEventListener('click', submit)
      answer.addEventListener('keydown', (e) => { if (e.key === 'Enter') submit() })
      row.append(answer, btn)
      card.append(row)
    }
    if (t.result) card.append(h('div', 'result', t.result))
    const details = h('details')
    details.append(h('summary', '', `Activity (${t.log.length} ${t.log.length === 1 ? 'step' : 'steps'})`), h('pre', '', t.log.join('\n')))
    card.append(details)
    if (t.status === 'running' || t.status === 'waiting') {
      const stop = h('button', 'quiet danger', 'Stop task')
      stop.style.justifySelf = 'start'
      stop.addEventListener('click', () => steve.send('tasks:stop', t.id))
      card.append(stop)
    }
    return card
  }))
  if (!tasks.length) box.append(h('p', 'empty', 'No tasks yet. Ask STEVE for something bigger, like "compare the best free video editors", and it works on it here while you carry on.'))
}
steve.on('tasks', renderTasks)

// ---------- Usage ----------
type Usage = {
  today: number; month: number; byService: Record<string, number>; limit: number
  todayDetail: { tokens: number; unpricedTokens: number; listenSeconds: number; spokenChars: number }
}
const NAMES: Record<string, string> = { openai: 'OpenAI', anthropic: 'Anthropic', google: 'Google', deepgram: 'Deepgram', elevenlabs: 'ElevenLabs' }
const dollars = (n: number) => (n === 0 ? '$0.00' : n < 0.01 ? `$${n.toFixed(3)}` : `$${n.toFixed(2)}`)
const num = (n: number) => n.toLocaleString()

function renderUsage(u: Usage) {
  $('#today').textContent = `${dollars(u.today)} today`
  $('#spend-today').textContent = dollars(u.today)
  $('#spend-month').textContent = dollars(u.month)
  const entries = Object.entries(u.byService).sort((a, b) => b[1] - a[1])
  const max = Math.max(...entries.map(([, v]) => v), 1e-9)
  $('#bars').replaceChildren(...entries.map(([s, v]) => {
    const row = h('div', 'bar')
    const track = h('i')
    track.style.setProperty('--w', `${Math.max(2, (100 * v) / max)}%`)
    row.append(h('span', '', NAMES[s] ?? s), track, h('em', '', dollars(v)))
    return row
  }))
  const d = u.todayDetail
  const parts = [`${num(d.tokens)} tokens`, `${Math.round(d.listenSeconds / 6) / 10} min of listening`, `${num(d.spokenChars)} characters spoken`]
  let text = `Today: ${parts.join(', ')}.`
  if (d.unpricedTokens) text += ` ${num(d.unpricedTokens)} tokens are from models without a price on file, so they aren't in the dollar totals.`
  $('#usage-detail').textContent = entries.length ? text : 'Nothing spent yet this month.'
}
steve.on('usage', renderUsage)
void steve.invoke<Usage>('usage:get').then(renderUsage)
$('#today').addEventListener('click', () => { showTab('settings'); $('#usage-group').scrollIntoView() })

// ---------- Settings ----------
type View = { settings: Record<string, any>; keysSet: Record<string, boolean>; platform: string; canChat: boolean }
const getPath = (o: any, path: string) => path.split('.').reduce((v, k) => v?.[k], o)

async function loadSettings() {
  const v = await steve.invoke<View>('settings:get')
  for (const el of $$<HTMLInputElement>('[data-setting]')) {
    const val = getPath(v.settings, el.dataset.setting!)
    if (el.type === 'checkbox') el.checked = !!val
    else el.value = typeof val === 'object' ? JSON.stringify(val, null, 2) : String(val ?? '')
  }
  for (const el of $$<HTMLInputElement>('[data-key]')) {
    el.value = ''
    el.placeholder = v.keysSet[el.dataset.key!] ? 'Saved' : 'Not set'
  }
  // Until STEVE can answer, the empty chat offers the key-free 3D demos instead of questions.
  document.body.classList.toggle('can-chat', v.canChat)
  await renderPerms()
}

/** Reads the fields of one section into a settings patch and a keys patch. */
function collect(section: HTMLElement) {
  const patch: Record<string, any> = {}
  for (const el of $$<HTMLInputElement>('[data-setting]', section)) {
    const [a, b] = el.dataset.setting!.split('.')
    let val: unknown = el.type === 'checkbox' ? el.checked : el.type === 'number' ? Math.max(0, Number(el.value) || 0) : el.value.trim()
    if (a === 'models' && !/^(openai|anthropic|google):\S+$/.test(String(val))) {
      throw new Error(`"${val}" isn't a model name. Write it as provider:model, e.g. openai:gpt-6-luna or anthropic:claude-sonnet-5-5.`)
    }
    if (a === 'mcpServers') {
      try { val = el.value.trim() ? JSON.parse(el.value) : {} } catch (e) {
        throw new Error(`The tool servers setting isn't valid JSON: ${e instanceof Error ? e.message : e}`)
      }
      for (const [name, s] of Object.entries(val as Record<string, any>)) {
        if (typeof s?.command !== 'string') throw new Error(`MCP server "${name}" needs a "command" string.`)
      }
    }
    if (b) patch[a] = { ...(patch[a] ?? {}), [b]: val }
    else patch[a] = val
  }
  const keys: Record<string, string> = {}
  for (const el of $$<HTMLInputElement>('[data-key]', section)) {
    const v = el.value.trim()
    if (v) keys[el.dataset.key!] = v === '-' ? '' : v
  }
  return { patch, keys }
}

async function save(section: HTMLElement, extra: Record<string, unknown> = {}) {
  const { patch, keys } = collect(section)
  if (patch.models) patch.models = { ...(await steve.invoke<View>('settings:get')).settings.models, ...patch.models }
  if (Object.keys(keys).length) await steve.invoke('keys:save', keys)
  await steve.invoke('settings:save', { ...patch, ...extra })
}

$('#save').addEventListener('click', async () => {
  try { await save($('#tab-settings')); $('#saved').textContent = 'Saved.'; await loadSettings(); renderUsage(await steve.invoke<Usage>('usage:get')) }
  catch (e) { $('#saved').textContent = e instanceof Error ? e.message : String(e) }
})
$('#finish').addEventListener('click', async () => {
  try { await save($('#tab-setup'), { onboarded: true }); showTab('chat'); void refreshCanChat() }
  catch (e) { $('#finish-error').textContent = e instanceof Error ? e.message : String(e) } // e.g. no secure password store
})
$('#mem-open').addEventListener('click', () => steve.invoke('memory:open'))
$('#mem-wipe').addEventListener('click', async () => {
  if (confirm('Delete everything STEVE remembers? This cannot be undone.')) await steve.invoke('memory:wipe')
})
// Links open in the real browser (this window never navigates).
$$<HTMLAnchorElement>('a[data-link]').forEach((a) => a.addEventListener('click', (e) => { e.preventDefault(); steve.send('open-link', a.href) }))

// ---------- macOS permissions ----------
/** A filled circle with a tick when granted, an empty ring when not. */
function statusIcon(ok: boolean) {
  const NS = 'http://www.w3.org/2000/svg'
  const svg = document.createElementNS(NS, 'svg')
  svg.setAttribute('viewBox', '0 0 18 18')
  svg.setAttribute('aria-hidden', 'true')
  const c = document.createElementNS(NS, 'circle')
  Object.entries({ cx: '9', cy: '9', r: ok ? '9' : '7.5', fill: ok ? 'currentColor' : 'none', stroke: 'currentColor', 'stroke-width': ok ? '0' : '2' }).forEach(([k, v]) => c.setAttribute(k, v))
  svg.append(c)
  if (ok) {
    const tick = document.createElementNS(NS, 'path')
    Object.entries({ d: 'M5 9.4l2.6 2.6L13 6.6', fill: 'none', stroke: '#fff', 'stroke-width': '2', 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }).forEach(([k, v]) => tick.setAttribute(k, v))
    svg.append(tick)
  }
  return svg
}

const PERMS: [string, string][] = [['microphone', 'Microphone'], ['screen', 'Screen Recording'], ['accessibility', 'Accessibility (talk keys, mouse and keyboard)']]
async function renderPerms() {
  const status = await steve.invoke<Record<string, string> | null>('perm:status')
  $('#perm-group').hidden = !status
  $('#setup-perms').hidden = !status
  for (const box of [$('#perms'), $('#perms2')]) {
    box.replaceChildren()
    if (!status) continue
    for (const [key, name] of PERMS) {
      const ok = status[key] === 'granted'
      const row = h('div', 'perm')
      const label = h('span', ok ? 'ok' : 'no', name)
      label.prepend(statusIcon(ok))
      row.append(label)
      if (!ok) {
        const b = h('button', 'quiet', 'Allow')
        b.addEventListener('click', async () => { await steve.invoke('perm:request', key); setTimeout(renderPerms, 1500) })
        row.append(b)
      }
      box.append(row)
    }
  }
}

export {}
