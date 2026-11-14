// Computer control: the agent model drives the real mouse and keyboard, one visible action at a time.
// Safety: explicit permission per task, an on-screen banner, Esc or moving the mouse stops it,
// and consequential actions need a confirmation dialog.
import type { Key } from '@nut-tree-fork/nut-js'
import { generateText, isStepCount, tool, type ModelMessage } from 'ai'
import { dialog, screen } from 'electron'
import { z } from 'zod'
import { model } from './brain'
import { capture, type Shot } from './capture'
import { imageToScreen } from './coords'
import { CONTROL_PROMPT } from './prompts'
import { errorText, sleep } from './windows'

let active: AbortController | null = null
let acting = false // true while STEVE itself is moving the mouse or typing

export const controlling = () => active !== null
/** Esc handler: ignores the Esc key that STEVE itself presses. */
export function stopControl() { if (!acting) active?.abort() }

const NAMED: Record<string, keyof typeof Key> = {
  ctrl: 'LeftControl', control: 'LeftControl', alt: 'LeftAlt', option: 'LeftAlt', shift: 'LeftShift',
  cmd: 'LeftCmd', command: 'LeftCmd', meta: 'LeftSuper', win: 'LeftSuper', super: 'LeftSuper',
  enter: 'Enter', return: 'Enter', tab: 'Tab', esc: 'Escape', escape: 'Escape', backspace: 'Backspace',
  delete: 'Delete', space: 'Space', up: 'Up', down: 'Down', left: 'Left', right: 'Right',
  home: 'Home', end: 'End', pageup: 'PageUp', pagedown: 'PageDown',
}

function toKey(keys: typeof Key, name: string): Key {
  const n = name.trim().toLowerCase()
  if (n in NAMED) return keys[NAMED[n]]
  if (/^[a-z]$/.test(n)) return keys[n.toUpperCase() as keyof typeof Key]
  if (/^[0-9]$/.test(n)) return keys[`Num${n}` as keyof typeof Key]
  if (/^f([1-9]|1[0-2])$/.test(n)) return keys[n.toUpperCase() as keyof typeof Key]
  throw new Error(`Unknown key "${name}"`)
}

export type ControlUi = { banner(text: string | null): void; point(x: number, y: number, shot: Shot): void }

export async function controlComputer(goal: string, ui: ControlUi, outer?: AbortSignal): Promise<string> {
  // Loaded lazily: if the native module cannot load, only computer control is lost.
  let nut: typeof import('@nut-tree-fork/nut-js')
  try { nut = await import('@nut-tree-fork/nut-js') } catch (e) {
    return `Computer control is unavailable on this system: ${errorText(e)}`
  }
  const { Button, Key: Keys, keyboard, mouse, Point } = nut
  const answer = await dialog.showMessageBox({
    type: 'question',
    buttons: ['Allow', 'Cancel'],
    defaultId: 1,
    cancelId: 1,
    message: 'Let STEVE use your mouse and keyboard?',
    detail: `Task: ${goal}\n\nPress Esc or move your mouse at any time to take back control.`,
  })
  if (answer.response !== 0) return 'The user declined to give control.'
  if (active) return 'STEVE is already controlling the computer.'

  const abort = new AbortController()
  active = abort
  outer?.addEventListener('abort', () => abort.abort())
  ui.banner('STEVE is using your mouse and keyboard · press Esc or move the mouse to stop')
  keyboard.config.autoDelayMs = 15

  let shot = await capture()
  let expected = screen.getCursorScreenPoint()
  // The user grabbing the mouse means "stop".
  const watcher = setInterval(() => {
    const p = screen.getCursorScreenPoint()
    if (!acting && Math.hypot(p.x - expected.x, p.y - expected.y) > 8) abort.abort()
  }, 150)

  const native = (x: number, y: number) => {
    const p = imageToScreen({ x, y }, shot, shot.bounds)
    const n = process.platform === 'win32' ? screen.dipToScreenPoint(p) : p // nut-js uses physical pixels on Windows
    return new Point(Math.round(n.x), Math.round(n.y))
  }
  const act = async (fn: () => Promise<unknown>) => {
    if (abort.signal.aborted) throw new Error('Stopped')
    acting = true
    try { await fn() } finally { expected = screen.getCursorScreenPoint(); acting = false }
    await sleep(700) // let the UI settle before looking again
    shot = await capture(shot.displayId)
    return { text: 'done', image: shot.jpeg.toString('base64'), size: `${shot.width}x${shot.height}` }
  }
  // Every action returns a fresh screenshot to the model.
  const withScreenshot = {
    toModelOutput: ({ output }: { output: any }) => ({
      type: 'content' as const,
      value: [
        { type: 'text' as const, text: `${output.text}. New screenshot (${output.size}):` },
        { type: 'file' as const, data: { type: 'data' as const, data: output.image }, mediaType: 'image/jpeg' },
      ],
    }),
  }
  const xy = { x: z.number().describe('x in screenshot pixels'), y: z.number().describe('y in screenshot pixels') }

  const tools = {
    click: tool({
      description: 'Move the mouse to a point and click.',
      inputSchema: z.object({ ...xy, button: z.enum(['left', 'right']).default('left'), double: z.boolean().default(false) }),
      execute: ({ x, y, button, double }) => act(async () => {
        ui.point(x, y, shot)
        await mouse.setPosition(native(x, y))
        await sleep(250)
        const b = button === 'right' ? Button.RIGHT : Button.LEFT
        await (double ? mouse.doubleClick(b) : mouse.click(b))
      }),
      ...withScreenshot,
    }),
    type_text: tool({
      description: 'Type text with the keyboard into the focused field.',
      inputSchema: z.object({ text: z.string() }),
      execute: ({ text }) => act(() => keyboard.type(text)),
      ...withScreenshot,
    }),
    press_keys: tool({
      description: 'Press a key or shortcut, e.g. "enter", "ctrl+s", "cmd+shift+t".',
      inputSchema: z.object({ keys: z.string() }),
      execute: ({ keys }) => act(async () => {
        const k = keys.split('+').map((name) => toKey(Keys, name))
        await keyboard.pressKey(...k)
        await keyboard.releaseKey(...k)
      }),
      ...withScreenshot,
    }),
    scroll: tool({
      description: 'Scroll at a point.',
      inputSchema: z.object({ ...xy, direction: z.enum(['up', 'down']), amount: z.number().min(1).max(20).default(5) }),
      execute: ({ x, y, direction, amount }) => act(async () => {
        await mouse.setPosition(native(x, y))
        await (direction === 'up' ? mouse.scrollUp(amount) : mouse.scrollDown(amount))
      }),
      ...withScreenshot,
    }),
    wait: tool({
      description: 'Wait for something to load.',
      inputSchema: z.object({ seconds: z.number().min(0.5).max(10) }),
      execute: ({ seconds }) => act(() => sleep(seconds * 1000)),
      ...withScreenshot,
    }),
    confirm_with_user: tool({
      description: 'Ask the user to approve a consequential action before doing it.',
      inputSchema: z.object({ action: z.string() }),
      execute: async ({ action }) => {
        acting = true // the user will move the mouse to answer; that is not a takeover
        try {
          const r = await dialog.showMessageBox({ type: 'warning', buttons: ['Approve', 'Deny'], defaultId: 1, cancelId: 1, message: 'STEVE wants to:', detail: action })
          return r.response === 0 ? 'approved' : 'denied: do not do it'
        } finally {
          expected = screen.getCursorScreenPoint()
          acting = false
        }
      },
    }),
  }

  try {
    const res = await generateText({
      model: model('agent'),
      system: CONTROL_PROMPT,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: `Goal: ${goal}\nCurrent screenshot (${shot.width}x${shot.height}):` },
          { type: 'file', data: shot.jpeg, mediaType: 'image/jpeg' },
        ],
      }],
      tools,
      stopWhen: isStepCount(40),
      abortSignal: abort.signal,
      prepareStep: ({ messages }) => ({ messages: keepRecentScreenshots(messages, 2) }),
    })
    return res.text || 'Done.'
  } catch (e) {
    return abort.signal.aborted ? 'Stopped: the user took back control.' : `Computer control failed: ${errorText(e)}`
  } finally {
    clearInterval(watcher)
    active = null
    ui.banner(null)
  }
}

/** Replaces screenshots in all but the newest `keep` tool results, to bound tokens and latency. */
function keepRecentScreenshots(messages: ModelMessage[], keep: number): ModelMessage[] {
  let seen = 0
  return messages
    .slice()
    .reverse()
    .map((m) => {
      if (m.role !== 'tool') return m
      return {
        ...m,
        content: m.content.map((p) =>
          p.type === 'tool-result' && p.output.type === 'content' && ++seen > keep
            ? { ...p, output: { type: 'text' as const, value: 'done (old screenshot removed)' } }
            : p,
        ),
      }
    })
    .reverse()
}
