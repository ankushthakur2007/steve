// Memory is plain files the user can open, read and delete:
//   facts.md          one remembered fact per line
//   log-YYYY-MM-DD.jsonl  conversation text (never screenshots)
import { app } from 'electron'
import { appendFileSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const memoryDir = () => join(app.getPath('userData'), 'memory')
const factsFile = () => join(memoryDir(), 'facts.md')
export const ensureDir = () => { mkdirSync(memoryDir(), { recursive: true }); return memoryDir() }
const ensure = ensureDir

/** Remembered facts for the prompt. Every request carries them, so past `max` characters only the newest are kept. */
export function facts(max = 4000): string {
  const all = existsSync(factsFile()) ? readFileSync(factsFile(), 'utf8').trim() : ''
  if (all.length <= max) return all
  const tail = all.slice(-max)
  return tail.slice(tail.indexOf('\n') + 1) // whole lines only
}

export function remember(fact: string) {
  ensure()
  appendFileSync(factsFile(), `- ${fact.replace(/\s+/g, ' ').trim()}\n`)
}

/** Deletes every fact containing `text` (case-insensitive). Returns how many were removed. */
export function forget(text: string): number {
  const needle = text.toLowerCase().trim()
  if (!needle) return 0
  const lines = facts().split('\n').filter(Boolean)
  const kept = lines.filter((l) => !l.toLowerCase().includes(needle))
  if (kept.length !== lines.length) writeFileSync(factsFile(), kept.map((l) => l + '\n').join(''))
  return lines.length - kept.length
}

export function logTurn(role: 'user' | 'assistant', text: string) {
  if (!text.trim()) return
  ensure()
  const day = new Date().toISOString().slice(0, 10)
  appendFileSync(join(memoryDir(), `log-${day}.jsonl`), JSON.stringify({ at: new Date().toISOString(), role, text }) + '\n')
}

/** The last `n` logged messages, so a new session can continue where the last one stopped. */
export function recentTurns(n = 10): { role: 'user' | 'assistant'; content: string }[] {
  if (!existsSync(memoryDir())) return []
  const logs = readdirSync(memoryDir()).filter((f) => /^log-.*\.jsonl$/.test(f)).sort().slice(-2)
  const rows = logs.flatMap((f) =>
    readFileSync(join(memoryDir(), f), 'utf8').split('\n').filter(Boolean).flatMap((l) => {
      try { return [JSON.parse(l)] } catch { return [] }
    }),
  )
  const turns = rows.slice(-n).map((r) => ({ role: r.role, content: String(r.text) }))
  while (turns[0]?.role === 'assistant') turns.shift() // history must start with the user
  return turns
}

export function wipe() {
  rmSync(memoryDir(), { recursive: true, force: true })
}
