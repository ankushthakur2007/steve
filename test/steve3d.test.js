// Fuzz test for the 3D scene engine's parts library: whatever the model writes, every shape must
// build a finite object quickly, or be skipped. Runs in Node (geometry only, no WebGL).
import * as THREE from 'three'
import { expect, it } from 'vitest'

// The few browser bits the shapes touch.
globalThis.matchMedia ??= () => ({ matches: false })
const ctx = { createLinearGradient: () => ({ addColorStop() {} }), fillRect() {}, fillStyle: '' }
globalThis.document ??= { createElement: () => ({ width: 0, height: 0, getContext: () => ctx }) }
const { SHAPE_NAMES, buildShape, vec3 } = await import('../src/visual/steve3d.js')

const stage = { mat: () => new THREE.MeshStandardMaterial(), onFrame() {} }
const finite = (o) => {
  const b = new THREE.Box3().setFromObject(o)
  return !b.isEmpty() && [b.min.x, b.min.y, b.min.z, b.max.x, b.max.y, b.max.z].every(Number.isFinite)
}
const vertices = (o) => { let n = 0; o.traverse((m) => { if (m.isMesh) n += m.geometry.attributes.position.count }); return n }

it('every library shape builds a finite object from its defaults', () => {
  expect(SHAPE_NAMES.length).toBeGreaterThan(20)
  for (const shape of SHAPE_NAMES) {
    const o = buildShape(stage, { shape })
    expect(o && finite(o), shape).toBe(true)
  }
})

it('whatever the model writes, a shape builds quickly and stays finite and bounded, or is skipped', () => {
  const junk = [
    { r: '0.7', h: '2', size: ['1', 2, 3], at: ['1', 2], rot: [90], scale: 'big' }, // numbers as strings, short vectors
    { r: -1, h: 0, size: [0, 0, 0], thickness: 0, length: -2 }, // zero and negative sizes
    { r: 'huge', size: 'cube', profile: 'round', points: [[1], ['a', 'b'], null], at: 'origin', rot: { x: 1 } }, // wrong types
    { blades: 1e9, teeth: 1e9, count: 1e9, turns: 1e9, pins: 1e9, rows: 1e9, cols: 1e9, spokes: 1e9, sides: 1e9 }, // runaway counts
    { array: { count: 1e9, step: [0.1] }, ring: { count: 'many', radius: 'wide' } },
  ]
  for (const shape of [...SHAPE_NAMES, 'no-such-shape']) {
    for (const params of junk) {
      const t0 = performance.now()
      const o = buildShape(stage, { shape, ...params })
      const ms = performance.now() - t0
      expect(ms, `${shape} ${JSON.stringify(params)} took ${ms} ms`).toBeLessThan(1500)
      if (o === null) continue // skipped with a warning: fine
      expect(finite(o), `${shape} ${JSON.stringify(params)}`).toBe(true)
      expect(vertices(o), `${shape} vertex count`).toBeLessThan(3_000_000)
    }
  }
})

it('reads vectors leniently but never invents numbers', () => {
  expect(vec3([1, 2, 3])).toEqual([1, 2, 3])
  expect(vec3(['1', '2'])).toEqual([1, 2, 0])
  expect(vec3([90])).toBeNull()
  expect(vec3(['a', 1, 2])).toBeNull()
  expect(vec3('1,2,3')).toBeNull()
})

it('the built-in demos are valid scenes whose every shape builds', async () => {
  const { readFileSync, readdirSync } = await import('node:fs')
  const dir = new URL('../src/main/demos/', import.meta.url)
  const files = readdirSync(dir).filter((f) => f.endsWith('.jsonl'))
  expect(files.length).toBe(3)
  for (const f of files) {
    const lines = readFileSync(new URL(f, dir), 'utf8').trim().split('\n').map((l) => JSON.parse(l))
    expect(lines.filter((l) => l.part).length, f).toBeGreaterThanOrEqual(4)
    expect(lines.filter((l) => l.step).length, f).toBeGreaterThanOrEqual(2)
    for (const l of lines.filter((x) => x.part || x.to)) expect(buildShape(stage, l), `${f}: ${JSON.stringify(l).slice(0, 60)}`).not.toBeNull()
  }
})
