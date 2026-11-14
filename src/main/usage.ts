// The cost meter: what each service has cost, per day, kept in usage.json next to the settings.
import { app } from 'electron'
import { existsSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { dollars, listenCost, speechCost, tokenCost } from './prices'
import { getSettings } from './settings'

type Day = { usd: Record<string, number>; tokens: number; unpricedTokens: number; listenSeconds: number; spokenChars: number }
type Usage = Record<string, Day> // keyed by local date, YYYY-MM-DD

const file = () => join(app.getPath('userData'), 'usage.json')
let cache: Usage | null = null
let onChange = () => {}
export const onUsageChange = (fn: () => void) => { onChange = fn }

const today = () => new Date().toLocaleDateString('sv') // local YYYY-MM-DD
function load(): Usage {
  if (!cache) {
    try { cache = existsSync(file()) ? JSON.parse(readFileSync(file(), 'utf8')) : {} } catch { cache = {} }
  }
  return cache!
}

function add(fn: (d: Day) => void) {
  const u = load()
  const d = (u[today()] ??= { usd: {}, tokens: 0, unpricedTokens: 0, listenSeconds: 0, spokenChars: 0 })
  fn(d)
  try { writeFileSync(file(), JSON.stringify(u)) } catch { /* the meter must never break a conversation */ }
  onChange()
}
const spend = (d: Day, service: string, usd: number) => { d.usd[service] = (d.usd[service] ?? 0) + usd }

/** model is a provider:model string; usage is the AI SDK's token counts. */
export function addTokens(model: string, usage: { inputTokens?: number; outputTokens?: number } | undefined) {
  const input = usage?.inputTokens ?? 0, output = usage?.outputTokens ?? 0
  if (!input && !output) return
  add((d) => {
    d.tokens += input + output
    const cost = tokenCost(model, input, output)
    if (cost === null) d.unpricedTokens += input + output
    else spend(d, model.split(':')[0], cost)
  })
}

export function addListening(seconds: number) {
  if (seconds > 0) add((d) => { d.listenSeconds += seconds; spend(d, 'deepgram', listenCost(seconds)) })
}

export function addSpeech(service: 'deepgram' | 'elevenlabs', chars: number) {
  add((d) => { d.spokenChars += chars; spend(d, service, speechCost(service, chars)) })
}

const total = (d?: Day) => Object.values(d?.usd ?? {}).reduce((a, b) => a + b, 0)

export function usageSummary() {
  const u = load(), day = today(), month = day.slice(0, 7)
  const monthDays = Object.entries(u).filter(([k]) => k.startsWith(month)).map(([, d]) => d)
  const byService: Record<string, number> = {}
  for (const d of monthDays) for (const [s, v] of Object.entries(d.usd)) byService[s] = (byService[s] ?? 0) + v
  const t = u[day]
  return {
    today: total(t),
    month: monthDays.reduce((a, d) => a + total(d), 0),
    byService, // this month
    todayDetail: { tokens: t?.tokens ?? 0, unpricedTokens: t?.unpricedTokens ?? 0, listenSeconds: Math.round(t?.listenSeconds ?? 0), spokenChars: t?.spokenChars ?? 0 },
    limit: getSettings().dailyLimit,
  }
}

/** A message when today's spending has reached the user's daily limit (0 means no limit). */
export function overLimit(): string | null {
  const limit = getSettings().dailyLimit
  if (!limit || total(load()[today()]) < limit) return null
  return `You've reached today's ${dollars(limit)} spending limit. Raise it in Settings > Usage to keep going.`
}
