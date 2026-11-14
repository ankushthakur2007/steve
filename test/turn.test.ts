// End-to-end test of one conversation turn without Electron or network:
// mock model stream -> brain.chat -> speaker -> ordered sentences, tags and audio.
import { tool } from 'ai'
import { afterEach, expect, it, vi } from 'vitest'
import { z } from 'zod'

const h = vi.hoisted(() => {
  const { mkdtempSync } = require('node:fs') as typeof import('node:fs')
  const { join } = require('node:path') as typeof import('node:path')
  const { tmpdir } = require('node:os') as typeof import('node:os')
  return { dir: mkdtempSync(join(tmpdir(), 'steve-test-')), calls: [] as any[], next: [] as any[][] }
})

vi.mock('electron', () => ({
  app: { getPath: () => h.dir, isPackaged: true }, // packaged: no debug log during tests
  safeStorage: {
    isAsyncEncryptionAvailable: async () => true,
    encryptStringAsync: async (s: string) => Buffer.from(s),
    decryptStringAsync: async (b: Buffer) => ({ result: b.toString(), shouldReEncrypt: false }),
  },
}))

vi.mock('@ai-sdk/openai', async () => {
  const { MockLanguageModelV4, MockProviderV4 } = await import('ai/test')
  const model = new MockLanguageModelV4({
    doStream: async (opts: any) => {
      h.calls.push(opts)
      const parts = h.next.shift() ?? []
      return {
        stream: new ReadableStream({
          async start(c) {
            for (const p of parts) {
              if (p === 'hang') return // never closes: only an abort can end this stream
              c.enqueue(p)
              await new Promise((r) => setTimeout(r, 1))
            }
            c.close()
          },
        }),
      }
    },
  })
  return { createOpenAI: () => new MockProviderV4({ languageModels: { 'gpt-6-luna': model } }) }
})

const { chat, missingKey } = await import('../src/main/brain')
const { createSpeaker } = await import('../src/main/tts')
const { getSettings, setKeys, saveSettings } = await import('../src/main/settings')

const usage = { inputTokens: { total: 10, noCache: 10, cacheRead: 0, cacheWrite: 0 }, outputTokens: { total: 5, text: 5, reasoning: 0 } }
const text = (...deltas: string[]) => [
  { type: 'stream-start', warnings: [] },
  { type: 'text-start', id: 't' },
  ...deltas.map((d) => ({ type: 'text-delta', id: 't', delta: d })),
  { type: 'text-end', id: 't' },
  { type: 'finish', usage, finishReason: { unified: 'stop', raw: 'stop' } },
]

await setKeys({ openai: 'test', deepgram: 'dg-key' })
saveSettings({ memory: false })
afterEach(() => vi.unstubAllGlobals())

it('speaks sentences in order, with tags firing on their own sentence, even when synthesis finishes out of order', async () => {
  const requests: { url: string; auth: string }[] = []
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => {
    const t = JSON.parse(String(init.body)).text as string
    requests.push({ url: String(url), auth: (init.headers as Record<string, string>).Authorization })
    await new Promise((r) => setTimeout(r, t.startsWith('Click') ? 40 : 1)) // first sentence is slowest
    return new Response(new TextEncoder().encode(t))
  })
  h.next.push(text('Click **Export** [POI', 'NT:640,360:Export] now. Then save', ' it.'))

  const events: string[] = []
  const abort = new AbortController()
  const speaker = createSpeaker({
    onSentence: (s) => events.push(`say:${s.text}|tags:${s.tags.map((t) => t.kind).join(',')}`),
    play: async (a) => { events.push(`play:${new TextDecoder().decode(a)}`) },
    onError: (e) => events.push(`error:${e}`),
  }, abort.signal)
  for await (const chunk of chat('Where is export?', null, {}, abort.signal)) speaker.push(chunk)
  await speaker.end()

  expect(events).toEqual([
    'say:Click **Export** now.|tags:point',
    'play:Click Export now.',
    'say:Then save it.|tags:',
    'play:Then save it.',
  ])
  expect(requests[0].url).toContain('https://api.deepgram.com/v1/speak?model=aura-2-thalia-en&encoding=mp3')
  expect(requests[0].auth).toBe('Token dg-key')
})

it('continues after a tool call, and only the newest screenshot is sent', async () => {
  const shot = { jpeg: Buffer.from([0xff, 0xd8, 0xff]), width: 1280, height: 720, bounds: { x: 0, y: 0, width: 1280, height: 720 }, displayId: 1 }
  const saved: string[] = []
  const tools = { remember: tool({ inputSchema: z.object({ fact: z.string() }), execute: async ({ fact }) => { saved.push(fact); return 'Saved.' } }) }
  h.next.push(
    [
      { type: 'stream-start', warnings: [] },
      { type: 'tool-call', toolCallId: 'c1', toolName: 'remember', input: '{"fact":"likes cats"}' },
      { type: 'finish', usage, finishReason: { unified: 'tool-calls', raw: 'tool_calls' } },
    ],
    text('Got it.'),
    text('Sure.'),
  )
  let out = ''
  const signal = new AbortController().signal
  for await (const c of chat('Remember I like cats', shot, tools, signal)) out += c
  expect(saved).toEqual(['likes cats'])
  expect(out.trim()).toBe('Got it.')

  for await (const c of chat('And now?', shot, tools, signal)) out += c
  const prompt = h.calls.at(-1).prompt as any[]
  const files = prompt.flatMap((m) => (Array.isArray(m.content) ? m.content : [])).filter((p: any) => p.type === 'file')
  expect(files).toHaveLength(1)
  expect(JSON.stringify(prompt)).toContain('[earlier screenshot removed]')
  expect(JSON.stringify(prompt)).toContain('Got it.') // the previous reply is in the history
})

it('an interrupt ends a reply that is still streaming', async () => {
  h.next.push([{ type: 'stream-start', warnings: [] }, { type: 'text-start', id: 't' }, { type: 'text-delta', id: 't', delta: 'Let me explain' }, 'hang'])
  const abort = new AbortController()
  const got: string[] = []
  const run = (async () => {
    try { for await (const c of chat('Explain', null, {}, abort.signal)) { got.push(c); abort.abort() } } catch { /* aborted */ }
  })()
  await Promise.race([run, new Promise((_, rej) => setTimeout(() => rej(new Error('interrupt did not stop the stream')), 2000))])
  expect(got).toEqual(['Let me explain'])

  h.next.push(text('Ok.'))
  for await (const _ of chat('Next', null, {}, new AbortController().signal)) { /* drain */ }
  expect(JSON.stringify(h.calls.at(-1).prompt)).toContain('Let me explain [interrupted]')
})

it('sends ElevenLabs requests with the Flash model, mp3 output and the xi-api-key header', async () => {
  const { synth } = await import('../src/main/tts')
  await setKeys({ elevenlabs: 'el-key' })
  saveSettings({ voice: 'elevenlabs', elevenVoiceId: 'voice123' })
  let req: { url: string; init: RequestInit } | undefined
  vi.stubGlobal('fetch', async (url: string, init: RequestInit) => { req = { url: String(url), init }; return new Response(new Uint8Array([1, 2, 3])) })
  const audio = await synth('Hello there.', new AbortController().signal)
  expect(new Uint8Array(audio!)).toEqual(new Uint8Array([1, 2, 3]))
  expect(req!.url).toBe('https://api.elevenlabs.io/v1/text-to-speech/voice123/stream?output_format=mp3_44100_128')
  expect((req!.init.headers as Record<string, string>)['xi-api-key']).toBe('el-key')
  expect(JSON.parse(String(req!.init.body))).toEqual({ text: 'Hello there.', model_id: 'eleven_flash_v2_5' })
  saveSettings({ voice: 'off' })
  expect(await synth('x', new AbortController().signal)).toBeNull()
})

it('explains a malformed model name instead of asking for a key that does not exist', () => {
  const models = getSettings().models
  expect(missingKey('chat')).toBeNull()
  for (const bad of ['gpt-6-luna', 'openai:', 'mistral:large', ' ']) {
    saveSettings({ models: { ...models, visual: bad } })
    expect(missingKey('visual'), bad).toMatch(/should look like openai:gpt-6-luna/)
  }
  saveSettings({ models })
})

it('keeps only the newest remembered facts once there are too many for every request', async () => {
  const memory = await import('../src/main/memory')
  for (let i = 0; i < 300; i++) memory.remember(`fact number ${i} about the user`)
  const f = memory.facts()
  expect(f.length).toBeLessThanOrEqual(4000)
  expect(f.startsWith('- fact number')).toBe(true) // whole lines
  expect(f.endsWith('fact number 299 about the user')).toBe(true)
  memory.wipe()
})
