import { systemPreferences } from 'electron'

export type HotkeyHandlers = { down(): void; up(): void; cancel(): void; escape(): void; error(e: unknown): void }

let hook: typeof import('uiohook-napi').uIOhook | null = null

/**
 * Push-to-talk: hold Left Ctrl + Left Alt (Control + Option on macOS).
 * Left Alt only, because AltGr on Windows sends Ctrl + Right Alt while typing.
 * Electron's globalShortcut reports no key release, so a low-level hook is used.
 * It is loaded lazily: if the native module cannot load, only the talk keys are lost.
 */
export async function startHotkeys(h: HotkeyHandlers) {
  let mod: typeof import('uiohook-napi')
  try { mod = await import('uiohook-napi') } catch (e) {
    h.error(`Talk keys are unavailable on this system (${e instanceof Error ? e.message : e}). Use the panel's Hold button.`)
    return
  }
  const { uIOhook, UiohookKey: K } = mod
  const MODIFIERS = new Set<number>([K.Ctrl, K.CtrlRight, K.Alt, K.AltRight, K.Shift, K.ShiftRight, K.Meta, K.MetaRight])
  const held = new Set<number>()
  let active = false
  const combo = () => held.has(K.Ctrl) && held.has(K.Alt)

  uIOhook.on('keydown', (e) => {
    if (e.keycode === K.Escape) h.escape()
    if (!MODIFIERS.has(e.keycode)) {
      // Ctrl+Alt+<key> is a shortcut, not push-to-talk.
      if (active) { active = false; h.cancel() }
      return
    }
    held.add(e.keycode)
    // Resync with the event's modifier flags in case a key-up was missed (e.g. lock screen).
    if (e.keycode === K.Alt && !e.ctrlKey) held.delete(K.Ctrl)
    if (e.keycode === K.Ctrl && !e.altKey) held.delete(K.Alt)
    if (!active && combo()) { active = true; h.down() }
  })
  uIOhook.on('keyup', (e) => {
    held.delete(e.keycode)
    if (active && !combo()) { active = false; h.up() }
  })

  const start = () => { try { uIOhook.start(); hook = uIOhook } catch (e) { h.error(e) } }
  // macOS needs Accessibility permission before a keyboard hook can see other apps' keys.
  if (process.platform === 'darwin' && !systemPreferences.isTrustedAccessibilityClient(false)) {
    const timer = setInterval(() => {
      if (systemPreferences.isTrustedAccessibilityClient(false)) { clearInterval(timer); start() }
    }, 2000)
  } else start()
}

export const stopHotkeys = () => hook?.stop()
