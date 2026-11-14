// Background tasks: an agent model with tools (web search, page reading, MCP servers such as
// a Playwright browser the user can watch). Each task has a log, a stop button, and can ask the user.
import { createMCPClient, type MCPClient } from '@ai-sdk/mcp'
import { StdioMCPTransport } from '@ai-sdk/mcp/mcp-stdio'
import { generateText, isStepCount, tool, type ToolSet } from 'ai'
import { app } from 'electron'
import { join } from 'node:path'
import { z } from 'zod'
import { model, openai, providerOf } from './brain'
import { log as debugLog } from './log'
import { AGENT_PROMPT } from './prompts'
import { getSettings, type McpServer } from './settings'
import { addTokens } from './usage'
import { errorText } from './windows'

export type TaskView = {
  id: string
  goal: string
  status: 'running' | 'waiting' | 'done' | 'failed' | 'stopped'
  log: string[]
  result?: string
  question?: string
}
type Task = TaskView & { abort: AbortController; answer?: (text: string) => void }

const tasks = new Map<string, Task>()
const view = ({ abort: _a, answer: _b, ...v }: Task): TaskView => v
let events = { changed: (_t: TaskView[]) => {}, finished: (_t: TaskView) => {} }

export const initTasks = (e: typeof events) => { events = e }
export const listTasks = () => [...tasks.values()].map(view)
const changed = () => events.changed(listTasks())

export function stopTask(id: string) { tasks.get(id)?.abort.abort() }
export function answerTask(id: string, text: string) { tasks.get(id)?.answer?.(text) }

/** MCP servers from settings, plus the bundled Playwright browser (run with Electron's own Node). */
function mcpServers(): Record<string, McpServer> {
  const s = getSettings()
  const servers = { ...s.mcpServers }
  if (s.browserAgent) {
    const env = Object.fromEntries(Object.entries(process.env).filter((e): e is [string, string] => e[1] !== undefined))
    servers.browser = {
      command: process.execPath,
      args: [
        join(app.getAppPath(), 'node_modules/@playwright/mcp/cli.js'),
        `--browser=${s.browserChannel}`,
        `--user-data-dir=${join(app.getPath('userData'), 'agent-browser')}`,
      ],
      env: { ...env, ELECTRON_RUN_AS_NODE: '1' },
    }
  }
  return servers
}

// Agents read untrusted web pages, so page fetching is limited to public http(s) hosts.
const PRIVATE_HOST = /^(localhost|127\.|10\.|192\.168\.|172\.(1[6-9]|2\d|3[01])\.|169\.254\.|0\.|\[?::1\]?$|.*\.local$)/i

const htmlToText = (html: string) =>
  html
    .replace(/<(script|style|noscript)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/\s+/g, ' ')
    .trim()

export function startTask(goal: string): TaskView {
  const t: Task = { id: crypto.randomUUID().slice(0, 8), goal, status: 'running', log: [], abort: new AbortController() }
  tasks.set(t.id, t)
  changed()
  void run(t)
  return view(t)
}

async function run(t: Task) {
  const log = (line: string) => { t.log.push(line.length > 300 ? line.slice(0, 300) + '…' : line); debugLog('task', `${t.id} ${line}`); changed() }
  debugLog('task', `${t.id} started: ${t.goal}`)
  const clients: MCPClient[] = []
  try {
    const tools: ToolSet = {
      fetch_page: tool({
        description: 'Download a public web page and return its readable text (first 20,000 characters).',
        inputSchema: z.object({ url: z.string().url() }),
        execute: async ({ url }, { abortSignal }) => {
          const u = new URL(url)
          if (!/^https?:$/.test(u.protocol) || PRIVATE_HOST.test(u.hostname)) return 'Only public http(s) pages can be fetched.'
          const res = await fetch(u, { signal: abortSignal, headers: { 'user-agent': 'Mozilla/5.0 (STEVE research agent)' } })
          return `HTTP ${res.status}\n` + htmlToText(await res.text()).slice(0, 20000)
        },
      }),
      ask_user: tool({
        description: 'Ask the user a question and wait for the answer. Use for decisions, missing details or permission.',
        inputSchema: z.object({ question: z.string() }),
        execute: ({ question }, { abortSignal }) =>
          new Promise<string>((resolve, reject) => {
            t.status = 'waiting'
            t.question = question
            t.answer = (a) => { t.status = 'running'; t.question = undefined; t.answer = undefined; changed(); resolve(a) }
            abortSignal?.addEventListener('abort', () => reject(new Error('Stopped')))
            changed()
          }),
      }),
    }
    if (providerOf('agent') === 'openai' && !getSettings().openaiBaseURL) tools.web_search = openai().tools.webSearch({})
    for (const [name, cfg] of Object.entries(mcpServers())) {
      try {
        const c = await createMCPClient({ transport: new StdioMCPTransport(cfg) })
        clients.push(c)
        Object.assign(tools, await c.tools())
        log(`Connected tool server "${name}"`)
      } catch (e) {
        log(`Could not start tool server "${name}": ${errorText(e)}`)
      }
    }
    const res = await generateText({
      model: model('agent'),
      system: AGENT_PROMPT,
      prompt: t.goal,
      tools,
      stopWhen: isStepCount(50),
      abortSignal: t.abort.signal,
      onStepFinish: (step) => {
        addTokens(getSettings().models.agent, step.usage)
        for (const c of step.toolCalls) log(`→ ${c.toolName} ${JSON.stringify(c.input)}`)
        if (step.text) log(step.text)
      },
    })
    t.result = res.text
    t.status = 'done'
  } catch (e) {
    t.status = t.abort.signal.aborted ? 'stopped' : 'failed'
    t.result = t.status === 'stopped' ? 'Stopped by you.' : errorText(e)
  } finally {
    await Promise.all(clients.map((c) => c.close().catch(() => {})))
    changed()
    debugLog('task', `${t.id} ${t.status}`, t.result)
    if (t.status !== 'stopped') events.finished(view(t))
  }
}
