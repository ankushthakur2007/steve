// Screenshot pixels <-> screen coordinates. Pure, so it is unit tested.
export type Rect = { x: number; y: number; width: number; height: number }
export type Size = { width: number; height: number }
export type Pt = { x: number; y: number }

const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

/** Point in screenshot pixels -> point relative to the display's top-left, in DIP (what overlay windows use). */
export function imageToLocal(p: Pt, image: Size, bounds: Rect): Pt {
  return {
    x: (clamp(p.x, 0, image.width) * bounds.width) / image.width,
    y: (clamp(p.y, 0, image.height) * bounds.height) / image.height,
  }
}

/** Point in screenshot pixels -> global screen point in DIP (what Electron's screen API uses). */
export function imageToScreen(p: Pt, image: Size, bounds: Rect): Pt {
  const l = imageToLocal(p, image, bounds)
  return { x: bounds.x + l.x, y: bounds.y + l.y }
}

/** Scale a length (box width, etc.) from screenshot pixels to DIP. */
export function imageToLocalSize(s: Size, image: Size, bounds: Rect): Size {
  return { width: (s.width * bounds.width) / image.width, height: (s.height * bounds.height) / image.height }
}

/** Downscale to fit maxEdge on the long side, keeping aspect ratio. Never upscales. */
export function fitSize(width: number, height: number, maxEdge: number): Size {
  const k = Math.min(1, maxEdge / Math.max(width, height))
  return { width: Math.round(width * k), height: Math.round(height * k) }
}
