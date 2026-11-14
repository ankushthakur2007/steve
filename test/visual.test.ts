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

it('extracts HTML from a fenced reply', () => {
  expect(extractHtml('Here you go:\n```html\n<p>x</p>\n```\nEnjoy')).toBe('<p>x</p>')
  expect(extractHtml('<p>plain</p>')).toBe('<p>plain</p>')
})
