import { expect, it } from 'vitest'
import { fitSize, imageToLocal, imageToLocalSize, imageToScreen } from '../src/main/coords'
import { parseSdf } from '../src/main/sdf'

it('maps screenshot pixels on a Retina display (1280px image of a 1512x982 DIP screen)', () => {
  const bounds = { x: 0, y: 0, width: 1512, height: 982 }
  const image = fitSize(1512 * 2, 982 * 2, 1280)
  expect(image).toEqual({ width: 1280, height: 831 })
  const p = imageToScreen({ x: 640, y: 415.5 }, image, bounds)
  expect(p.x).toBeCloseTo(756)
  expect(p.y).toBeCloseTo(491, 0)
})

it('adds the monitor offset for a second display at 150% scaling', () => {
  const bounds = { x: 1920, y: -200, width: 1707, height: 960 } // 2560x1440 at 150%
  const image = fitSize(2560, 1440, 1280)
  expect(image).toEqual({ width: 1280, height: 720 })
  expect(imageToScreen({ x: 1280, y: 720 }, image, bounds)).toEqual({ x: 1920 + 1707, y: -200 + 960 })
  expect(imageToLocal({ x: 0, y: 0 }, image, bounds)).toEqual({ x: 0, y: 0 })
})

it('clamps out-of-range points to the screen and scales sizes', () => {
  const bounds = { x: 0, y: 0, width: 1920, height: 1080 }
  const image = { width: 1280, height: 720 }
  expect(imageToLocal({ x: -50, y: 5000 }, image, bounds)).toEqual({ x: 0, y: 1080 })
  expect(imageToLocalSize({ width: 128, height: 72 }, image, bounds)).toEqual({ width: 192, height: 108 })
})

it('never upscales', () => {
  expect(fitSize(800, 600, 1280)).toEqual({ width: 800, height: 600 })
})

it('parses a V2000 molfile', () => {
  const sdf = [
    'water', '  test', '',
    '  3  2  0     0  0  0  0  0  0999 V2000',
    '    0.0000    0.0000    0.0000 O   0  0  0  0  0  0  0  0  0  0  0  0',
    '    0.9572    0.0000    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
    '   -0.2400    0.9266    0.0000 H   0  0  0  0  0  0  0  0  0  0  0  0',
    '  1  2  1  0  0  0  0',
    '  1  3  1  0  0  0  0',
    'M  END',
  ].join('\n')
  const m = parseSdf(sdf)
  expect(m.atoms.map((a) => a.el)).toEqual(['O', 'H', 'H'])
  expect(m.atoms[1].x).toBeCloseTo(0.9572)
  expect(m.bonds).toEqual([{ a: 0, b: 1, order: 1 }, { a: 0, b: 2, order: 1 }])
})
