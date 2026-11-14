import { createAnthropic } from '@ai-sdk/anthropic'
import { createGoogleGenerativeAI } from '@ai-sdk/google'
import { createOpenAI } from '@ai-sdk/openai'
import { createProviderRegistry, isStepCount, streamText, type ModelMessage, type ToolSet } from 'ai'
import type { Shot } from './capture'
import * as memory from './memory'
import { CHAT_PROMPT } from './prompts'
import { getKeys, getSettings, type KeyName } from './settings'
import { addTokens } from './usage'

export type Role = 'chat' | 'visual' | 'agent'

export const openai = () => createOpenAI({ apiKey: getKeys().openai, baseURL: getSettings().openaiBaseURL || undefined })
export const providerOf = (role: Role) => getSettings().models[role].split(':')[0]

/** The model configured for a role, e.g. "openai:gpt-6-luna" or "anthropic:claude-sonnet-5-5". */
export function model(role: Role) {
  const k = getKeys()
  const oa = openai()
  const registry = createProviderRegistry({
    // Local OpenAI-compatible servers (Ollama, LM Studio...) speak Chat Completions, not the Responses API.
    openai: getSettings().openaiBaseURL ? { ...oa, languageModel: (id: string) => oa.chat(id) } : oa,
    anthropic: createAnthropic({ apiKey: k.anthropic }),
    google: createGoogleGenerativeAI({ apiKey: k.google }),
  })
  return registry.languageModel(getSettings().models[role] as `openai:${string}`)
}

// The AI SDK falls back to these environment variables when no key is saved in settings.
const ENV_KEYS: Record<string, string> = { openai: 'OPENAI_API_KEY', anthropic: 'ANTHROPIC_API_KEY', google: 'GOOGLE_GENERATIVE_AI_API_KEY' }

/** Friendly error when the key for a role's provider is missing (a local OpenAI-compatible server needs none). */
export function missingKey(role: Role): string | null {
  const p = providerOf(role) as KeyName
  if (getKeys()[p] || process.env[ENV_KEYS[p]] || (p === 'openai' && getSettings().openaiBaseURL)) return null
  return `Add your ${p} API key in STEVE's settings (the ${role} model is ${getSettings().models[role]}).`
}

const history: ModelMessage[] = []

export function seedHistory(msgs: ModelMessage[]) { history.push(...msgs) }
export function note(text: string) { history.push({ role: 'assistant', content: text }) }

function trim() {
  while (history.length > 30) history.shift()
  while (history.length && history[0].role !== 'user') history.shift() // never start on an orphaned tool result
}

/** Only the newest screenshot is sent; older ones become a placeholder to save tokens. */
function dropOldScreenshots() {
  for (const m of history) {
    if (m.role === 'user' && Array.isArray(m.content)) {
      m.content = m.content.map((p) => (p.type === 'file' || p.type === 'image' ? { type: 'text' as const, text: '[earlier screenshot removed]' } : p))
    }
  }
}

/** Streams the reply text for one user turn (across tool steps) and records it in the history. */
export async function* chat(text: string, shot: Shot | null, tools: ToolSet, signal: AbortSignal): AsyncGenerator<string> {
  dropOldScreenshots()
  history.push({
    role: 'user',
    content: shot
      ? [
          { type: 'text', text: `${text}\n\n(Screenshot of the user's screen attached: ${shot.width}x${shot.height} pixels.)` },
          { type: 'file', data: shot.jpeg, mediaType: 'image/jpeg' },
        ]
      : text,
  })
  const s = getSettings()
  const remembered = s.memory ? memory.facts() : ''
  const result = streamText({
    model: model('chat'),
    system: CHAT_PROMPT + (remembered ? `\n\nWhat you remember about the user:\n${remembered}` : ''),
    messages: history,
    tools,
    stopWhen: isStepCount(6),
    reasoning: 'low', // voice replies need low latency
    abortSignal: signal,
  })
  let reply = ''
  try {
    for await (const part of result.fullStream) {
      if (part.type === 'text-delta') { reply += part.text; yield part.text }
      else if (part.type === 'finish-step') yield '\n' // keeps sentences from separate steps apart
      else if (part.type === 'error') throw part.error
    }
    if (signal.aborted) history.push({ role: 'assistant', content: reply + ' [interrupted]' })
    else {
      history.push(...(await result.response).messages)
      addTokens(s.models.chat, await result.totalUsage) // shortcut: interrupted replies aren't metered (the SDK reports no usage)
    }
  } catch (e) {
    history.push({ role: 'assistant', content: reply + ' [interrupted]' })
    throw e
  } finally {
    trim()
    if (s.memory) { memory.logTurn('user', text); memory.logTurn('assistant', reply) }
  }
}
