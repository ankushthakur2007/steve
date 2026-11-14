import { app, safeStorage } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export type KeyName = 'openai' | 'anthropic' | 'google' | 'deepgram' | 'elevenlabs'
export type McpServer = { command: string; args?: string[]; env?: Record<string, string> }

export const defaults = {
  // provider:model strings. Swap any role to another provider without code changes.
  models: { chat: 'openai:gpt-6-luna', visual: 'openai:gpt-6-luna', agent: 'openai:gpt-6-luna' },
  openaiBaseURL: '', // set to use a local OpenAI-compatible server (Ollama, LM Studio...)
  voice: 'deepgram' as 'deepgram' | 'elevenlabs' | 'off',
  deepgramVoice: 'aura-2-thalia-en',
  elevenVoiceId: 'JBFqnCBsd6RMkjVDRZzb',
  memory: true,
  browserAgent: true,
  autopilot: false, // set by "Always allow": computer control starts without asking each time
  followUps: true, // after a spoken answer, keep listening a few seconds for a reply without the keys
  dailyLimit: 0, // dollars per day across all services; 0 means no limit

  browserChannel: process.platform === 'win32' ? 'msedge' : 'chrome',
  mcpServers: {} as Record<string, McpServer>,
  onboarded: false,
}
export type Settings = typeof defaults

const file = () => join(app.getPath('userData'), 'settings.json')
type Stored = Settings & { keys?: string }
let cache: Stored | null = null

function load(): Stored {
  if (!cache) {
    let saved = {}
    try { if (existsSync(file())) saved = JSON.parse(readFileSync(file(), 'utf8')) } catch { /* corrupt file: start fresh */ }
    cache = { ...structuredClone(defaults), ...saved }
  }
  return cache
}

export function getSettings(): Settings {
  const { keys: _, ...s } = load()
  return s
}

export function saveSettings(patch: Partial<Settings>) {
  cache = { ...load(), ...patch }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}

// API keys are encrypted with the OS keychain (Keychain on macOS, DPAPI on Windows, libsecret on Linux)
// and decrypted once at startup into memory.
type Keys = Partial<Record<KeyName, string>>
let keys: Keys = {}

export const getKeys = (): Keys => keys

/** Call once after app 'ready', before anything reads keys. */
export async function loadKeys() {
  const enc = load().keys
  if (!enc) return
  try {
    const { result, shouldReEncrypt } = await safeStorage.decryptStringAsync(Buffer.from(enc, 'base64'))
    keys = JSON.parse(result)
    if (shouldReEncrypt) await setKeys({})
  } catch {
    keys = {} // unreadable (e.g. copied from another computer): the user re-enters them
  }
}

export async function setKeys(patch: Keys) {
  const next = { ...keys, ...patch }
  for (const k of Object.keys(next) as KeyName[]) if (!next[k]) delete next[k]
  if (!(await safeStorage.isAsyncEncryptionAvailable())) {
    throw new Error('This computer has no secure password store, so STEVE cannot save API keys safely.')
  }
  const enc = await safeStorage.encryptStringAsync(JSON.stringify(next))
  keys = next
  cache = { ...load(), keys: enc.toString('base64') }
  writeFileSync(file(), JSON.stringify(cache, null, 2))
}
