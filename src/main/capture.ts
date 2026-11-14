import { desktopCapturer, screen, type Rectangle } from 'electron'
import { fitSize } from './coords'

export type Shot = { jpeg: Buffer; width: number; height: number; bounds: Rectangle; displayId: number }

/** Screenshot of one display (default: the one under the cursor), downscaled to maxEdge pixels on the long side. */
export async function capture(displayId?: number, maxEdge = 1280): Promise<Shot> {
  const display =
    screen.getAllDisplays().find((d) => d.id === displayId) ?? screen.getDisplayNearestPoint(screen.getCursorScreenPoint())
  const { width, height } = display.size
  const sources = await desktopCapturer.getSources({
    types: ['screen'],
    thumbnailSize: fitSize(width * display.scaleFactor, height * display.scaleFactor, maxEdge),
  })
  // display_id can be empty on Linux; fall back to the first screen there.
  const src = sources.find((s) => s.display_id === String(display.id)) ?? sources[0]
  if (!src || src.thumbnail.isEmpty()) {
    throw new Error('Screen capture failed. On macOS, allow STEVE under Privacy & Security > Screen Recording.')
  }
  const size = src.thumbnail.getSize()
  return { jpeg: src.thumbnail.toJPEG(80), width: size.width, height: size.height, bounds: display.bounds, displayId: display.id }
}
