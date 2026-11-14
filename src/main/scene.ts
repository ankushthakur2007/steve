// Visuals are made in the background, so STEVE keeps talking instead of waiting for them.
// 3D scenes stream in as short JSON lines that the board draws part by part; 2D visuals are HTML
// pages that appear when the model has written them.
import { generateText, streamText } from 'ai'
import { randomUUID } from 'node:crypto'
import { endScene, moleculeHtml, sceneLine, showMaking, showVisual, startScene, visualFailed } from './board'
import { model } from './brain'
import { keep, log, logError } from './log'
import { SCENE_PROMPT, VISUAL_PROMPT } from './prompts'
import { getSettings } from './settings'
import { addTokens } from './usage'
import { extractHtml, takeObjects, usesStage } from './visual'
import { errorText } from './windows'

let current: AbortController | null = null

/** Stops the visual being made: a newer one replaces it, or the user closed the board. */
export function cancelVisual() {
  current?.abort()
  current = null
}
// A stalled connection must not leave "Making ..." on screen forever.
const FIRST_LINE_MS = 45_000, TOTAL_MS = 150_000
class TooSlow extends Error {}

function begin(ms = TOTAL_MS) {
  cancelVisual()
  const abort = (current = new AbortController())
  const timer = setTimeout(() => abort.abort(new TooSlow(`the model took longer than ${ms / 1000} seconds`)), ms)
  abort.signal.addEventListener('abort', () => clearTimeout(timer))
  return abort
}
function failed(abort: AbortController, title: string, e: unknown) {
  const reason = abort.signal.reason
  if (reason instanceof TooSlow) e = reason // timed out: say so, unlike a cancel
  else if (abort.signal.aborted) return log('visual', `"${title}" stopped`)
  logError('visual', e)
  visualFailed(`Couldn't make "${title}": ${errorText(e)}`)
}

/** A 3D model, drawn part by part while the model is still writing it. */
export async function make3d(title: string, brief: string) {
  const abort = begin()
  const id = randomUUID().slice(0, 8), t0 = Date.now(), lines: string[] = []
  let skipped = 0
  try {
    await startScene(title, id)
    log('scene', `asking ${getSettings().models.visual} for "${title}"`, brief)
    // Low reasoning: the first part should be on screen within a second or two.
    const result = streamText({ model: model('visual'), system: SCENE_PROMPT, prompt: brief, reasoning: 'low', abortSignal: abort.signal })
    const waiting = setTimeout(() => { if (!lines.length) abort.abort(new TooSlow(`the model sent nothing for ${FIRST_LINE_MS / 1000} seconds`)) }, FIRST_LINE_MS)
    abort.signal.addEventListener('abort', () => clearTimeout(waiting))
    let buf = ''
    for await (const part of result.fullStream) {
      if (part.type === 'error') throw part.error
      if (part.type === 'abort') break
      if (part.type !== 'text-delta') continue
      const { objects, rest } = takeObjects(buf + part.text)
      buf = rest
      for (const o of objects) {
        try { JSON.parse(o) } catch { skipped++; log('scene', 'skipped a broken line', o); continue }
        if (!lines.length) log('scene', `first line after ${Date.now() - t0} ms`)
        lines.push(o)
        sceneLine(id, o)
      }
    }
    // A cancelled stream ends quietly instead of throwing: never keep or finish a half-built model.
    clearTimeout(waiting)
    if (abort.signal.aborted) throw new Error('cancelled')
    const usage = await result.totalUsage
    addTokens(getSettings().models.visual, usage)
    log('scene', `"${title}" finished in ${Date.now() - t0} ms: ${lines.length} lines${skipped ? `, ${skipped} skipped` : ''}`, { in: usage.inputTokens, out: usage.outputTokens })
    keep('last-scene.jsonl', lines.join('\n')) // what the model wrote, when a model looks wrong
    if (!lines.some((l) => /"(part|to)"\s*:/.test(l))) throw new Error('the model described no parts to draw')
    endScene(id, title, lines)
  } catch (e) {
    failed(abort, title, e)
  } finally {
    if (current === abort) current = null
    abort.abort() // done either way: frees the timeout timers
  }
}

/** A 2D visual (diagram, chart, animation) written as one HTML page. */
export async function make2d(title: string, brief: string) {
  const abort = begin()
  try {
    await showMaking(title)
    log('visual', `asking ${getSettings().models.visual} for "${title}"`, brief)
    const { text, totalUsage } = await generateText({ model: model('visual'), system: VISUAL_PROMPT, prompt: brief, reasoning: 'low', abortSignal: abort.signal })
    addTokens(getSettings().models.visual, totalUsage)
    const html = extractHtml(text)
    log('visual', `got ${html.length} chars of HTML${usesStage(html) ? ' (3D kit)' : ''}`, { in: totalUsage.inputTokens, out: totalUsage.outputTokens })
    keep('last-visual.html', html) // open it in a browser, or read it, when a visual looks wrong
    if (!/<(script|svg|canvas|body|div|html)\b/i.test(html)) throw new Error('the model replied without a visual')
    if (!abort.signal.aborted) await showVisual(title, html)
  } catch (e) {
    failed(abort, title, e)
  } finally {
    if (current === abort) current = null
    abort.abort() // done either way: frees the timeout timers
  }
}

/** A real molecule from PubChem. */
export async function makeMolecule(name: string) {
  const abort = begin()
  try {
    await showMaking(name)
    const html = await moleculeHtml(name)
    if (!abort.signal.aborted) await showVisual(name, html)
  } catch (e) {
    failed(abort, name, e)
  } finally {
    if (current === abort) current = null
    abort.abort() // done either way: frees the timeout timers
  }
}
