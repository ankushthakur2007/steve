// Debug log: what STEVE is doing, step by step, so problems can be traced. Printed in the terminal and
// written to <user data>/logs/steve.log. On when running from source (npm run dev) or with STEVE_DEBUG=1.
// Never logs API keys, screenshots or audio; long values (what was said, tool results) are cut short.
import { app } from 'electron'
import { appendFileSync, mkdirSync, renameSync, statSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

export const debugOn = !app.isPackaged || process.env.STEVE_DEBUG === '1'
let dir = ''

/** The logs folder, created on first use (after the profile folder is known). */
export function logDir() {
  if (!dir) {
    dir = join(app.getPath('userData'), 'logs')
    mkdirSync(dir, { recursive: true })
    const file = join(dir, 'steve.log')
    try { if (statSync(file).size > 5_000_000) renameSync(file, join(dir, 'steve.old.log')) } catch { /* no log yet */ }
  }
  return dir
}

/** Shortens any value to one readable line. */
export function short(v: unknown, max = 300): string {
  let s: string
  if (typeof v === 'string') s = v
  else if (v instanceof Error) s = v.stack ?? v.message
  else { try { s = JSON.stringify(v) ?? String(v) } catch { s = String(v) } }
  s = s.replace(/\s*\n\s*/g, ' | ')
  return s.length > max ? `${s.slice(0, max)}… (${s.length} chars)` : s
}

export function log(scope: string, msg: string, detail?: unknown) {
  if (!debugOn) return
  const d = new Date() // local time, to match the clock when you noticed the problem
  const line = `${d.toTimeString().slice(0, 8)}.${String(d.getMilliseconds()).padStart(3, '0')} [${scope}] ${msg}${detail === undefined ? '' : ` ${short(detail)}`}`
  console.log(line)
  try { appendFileSync(join(logDir(), 'steve.log'), `${d.toLocaleDateString('sv')} ${line}\n`) } catch { /* the terminal still has it */ }
}

/** Errors keep their full stack in the log. */
export const logError = (scope: string, e: unknown) => log(scope, 'ERROR', e instanceof Error ? short(e, 4000) : e)

/** Keeps a copy of a file worth inspecting (e.g. the last visual the model wrote) in the logs folder. */
export function keep(name: string, content: string) {
  if (!debugOn) return
  try { writeFileSync(join(logDir(), name), content); log('log', `saved ${join(logDir(), name)}`) } catch { /* not essential */ }
}

/** Runs fn and logs how long it took, its result or its error. */
export async function timed<T>(scope: string, what: string, fn: () => Promise<T>, result?: (v: T) => unknown): Promise<T> {
  const t0 = Date.now()
  log(scope, `${what}…`)
  try {
    const v = await fn()
    log(scope, `${what} done in ${Date.now() - t0} ms`, result ? result(v) : undefined)
    return v
  } catch (e) {
    log(scope, `${what} failed after ${Date.now() - t0} ms`, e instanceof Error ? short(e, 4000) : e)
    throw e
  }
}
