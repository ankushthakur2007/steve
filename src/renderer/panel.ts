// The panel: typed chat, background tasks, settings and first-run setup. All text is set with
// textContent, never innerHTML, because it comes from the model and from web pages.
const { steve } = window
const $ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => root.querySelector(sel) as T
const $$ = <T extends HTMLElement = HTMLElement>(sel: string, root: ParentNode = document) => [...root.querySelectorAll(sel)] as T[]
const h = (tag: string, cls = '', text = '') => Object.assign(document.createElement(tag), { className: cls, textContent: text })

// ---------- Tabs ----------
function showTab(name: string) {
  $$('main > section').forEach((s) => (s.hidden = s.id !== `tab-${name}`))
  $$('nav button').forEach((b) => b.classList.toggle('on', b.dataset.tab === name))
  $('#composer').hidden = name !== 'chat'
  $('nav').hidden = name === 'setup'
  if (name === 'settings' || name === 'setup') void loadSettings()
  if (name === 'tasks') void steve.invoke('tasks:list').then(renderTasks)
}
$$('nav button').forEach((b) => b.addEventListener('click', () => showTab(b.dataset.tab!)))
steve.on('tab', showTab)

// ---------- Chat ----------
const log = $('#log')
const STATE_TEXT: Record<string, string> = {
  idle: 'Hold Ctrl + Alt (Control + Option on Mac) and speak.', listening: 'Listening…', thinking: 'Thinking…',
  speaking: 'Speaking… (Esc to stop)', pointing: 'Pointing…', working: 'Working on it…',
}
steve.on('state', (s: string) => { $('#state').textContent = STATE_TEXT[s] ?? s })

steve.on('transcript', (m: { role: string; text: string; append: boolean }) => {
  const last = log.lastElementChild
  if (m.append && last?.classList.contains(m.role)) last.textContent += m.text
  else if (m.text || m.role === 'assistant') log.append(h('div', `msg ${m.role}`, m.text))
  log.lastElementChild?.scrollIntoView({ block: 'end' })
})

const input = $<HTMLTextAreaElement>('#input')
function send() {
  const text = input.value.trim()
  if (!text) return
  input.value = ''
  steve.send('ask', text, $<HTMLInputElement>('#with-screen').checked)
}
$('#send').addEventListener('click', send)
input.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); send() } })
$('#stop').addEventListener('click', () => steve.send('stop'))
const talk = $('#talk')
let talking = false
talk.addEventListener('pointerdown', () => { talking = true; steve.send('ptt', 'down') })
for (const ev of ['pointerup', 'pointerleave'] as const) {
  talk.addEventListener(ev, () => { if (talking) { talking = false; steve.send('ptt', 'up') } })
}

// ---------- Tasks ----------
type Task = { id: string; goal: string; status: string; log: string[]; result?: string; question?: string }
function renderTasks(tasks: Task[]) {
  const box = $('#tasks')
  box.replaceChildren(...tasks.slice().reverse().map((t) => {
    const card = h('div', 'task')
    card.append(h('div', 'status', t.status.toUpperCase()), h('div', '', t.goal))
    if (t.question) {
      const q = h('div', 'msg system', `Question: ${t.question}`)
      const answer = h('input') as HTMLInputElement
      const btn = h('button', 'btn', 'Answer')
      btn.addEventListener('click', () => answer.value.trim() && steve.send('tasks:answer', t.id, answer.value.trim()))
      card.append(q, answer, btn)
    }
    if (t.result) card.append(h('div', 'msg', t.result))
    const details = h('details')
    details.append(h('summary', 'hint', `Activity (${t.log.length})`), h('pre', '', t.log.join('\n')))
    card.append(details)
    if (t.status === 'running' || t.status === 'waiting') {
      const stop = h('button', 'btn danger', 'Stop')
      stop.addEventListener('click', () => steve.send('tasks:stop', t.id))
      card.append(stop)
    }
    return card
  }))
  if (!tasks.length) box.append(h('p', 'hint', 'No tasks yet.'))
}
steve.on('tasks', renderTasks)

// ---------- Settings ----------
type View = { settings: Record<string, any>; keysSet: Record<string, boolean>; platform: string }
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
    el.placeholder = v.keysSet[el.dataset.key!] ? 'saved' : 'not set'
  }
  await renderPerms()
}

/** Reads the fields of one section into a settings patch and a keys patch. */
function collect(section: HTMLElement) {
  const patch: Record<string, any> = {}
  for (const el of $$<HTMLInputElement>('[data-setting]', section)) {
    const [a, b] = el.dataset.setting!.split('.')
    let val: unknown = el.type === 'checkbox' ? el.checked : el.value.trim()
    if (a === 'mcpServers') {
      val = el.value.trim() ? JSON.parse(el.value) : {}
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
  try { await save($('#tab-settings')); $('#saved').textContent = 'Saved.'; await loadSettings() }
  catch (e) { $('#saved').textContent = e instanceof Error ? e.message : String(e) }
})
$('#finish').addEventListener('click', async () => { await save($('#tab-setup'), { onboarded: true }); showTab('chat') })
$('#mem-open').addEventListener('click', () => steve.invoke('memory:open'))
$('#mem-wipe').addEventListener('click', async () => {
  if (confirm('Delete everything STEVE remembers? This cannot be undone.')) await steve.invoke('memory:wipe')
})

// ---------- macOS permissions ----------
const PERMS: [string, string][] = [['microphone', 'Microphone'], ['screen', 'Screen Recording'], ['accessibility', 'Accessibility (talk keys, computer control)']]
async function renderPerms() {
  const status = await steve.invoke<Record<string, string> | null>('perm:status')
  $('#perm-title').hidden = !status
  for (const box of [$('#perms'), $('#perms2')]) {
    box.replaceChildren()
    if (!status) continue
    for (const [key, name] of PERMS) {
      const ok = status[key] === 'granted'
      const row = h('div', 'perm')
      row.append(h('span', ok ? 'ok' : 'no', `${ok ? '✓' : '•'} ${name}`))
      if (!ok) {
        const b = h('button', 'btn ghost', 'Allow')
        b.addEventListener('click', async () => { await steve.invoke('perm:request', key); setTimeout(renderPerms, 1500) })
        row.append(b)
      }
      box.append(row)
    }
  }
}

export {}
