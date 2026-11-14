import { describe, expect, it } from 'vitest'
import { createSentenceStream, parseTag, speakable, type Sentence } from '../src/main/tags'

function run(chunks: string[]): Sentence[] {
  const out: Sentence[] = []
  const s = createSentenceStream((x) => out.push(x))
  chunks.forEach((c) => s.push(c))
  s.end()
  return out
}

describe('parseTag', () => {
  it('parses every tag kind', () => {
    expect(parseTag('POINT:10,20:Export')).toEqual({ kind: 'point', x: 10, y: 20, label: 'Export' })
    expect(parseTag('BOX:1,2,3,4:Panel')).toEqual({ kind: 'box', x: 1, y: 2, w: 3, h: 4, label: 'Panel' })
    expect(parseTag('ARROW:1,2,3,4:')).toEqual({ kind: 'arrow', x1: 1, y1: 2, x2: 3, y2: 4, label: '' })
    expect(parseTag('LABEL:5,6:note: with colon')).toEqual({ kind: 'label', x: 5, y: 6, text: 'note: with colon' })
    expect(parseTag('CLEAR')).toEqual({ kind: 'clear' })
  })
  it('rejects malformed tags', () => {
    expect(parseTag('POINT:10:x')).toBeNull()
    expect(parseTag('POINT:a,b:x')).toBeNull()
    expect(parseTag('link')).toBeNull()
  })
})

describe('createSentenceStream', () => {
  it('splits sentences and attaches tags to the sentence they appear in', () => {
    const out = run(['Click Export [POINT:100,50:Export]. Then save', ' it! Done'])
    expect(out).toEqual([
      { text: 'Click Export.', tags: [{ kind: 'point', x: 100, y: 50, label: 'Export' }] },
      { text: 'Then save it!', tags: [] },
      { text: 'Done', tags: [] },
    ])
  })

  it('handles a tag split across chunks', () => {
    const out = run(['Here [PO', 'INT:1', '0,20:A', 'pply] it is.'])
    expect(out).toEqual([{ text: 'Here it is.', tags: [{ kind: 'point', x: 10, y: 20, label: 'Apply' }] }])
  })

  it('waits for the character after a period before splitting', () => {
    const out = run(['Version 3.', '5 is out.'])
    expect(out.map((s) => s.text)).toEqual(['Version 3.5 is out.'])
  })

  it('keeps non-tag brackets as text and drops a truncated tag at the end', () => {
    expect(run(['Use arr[0] here.'])[0].text).toBe('Use arr[0] here.')
    expect(run(['Look here [POINT:10,'])).toEqual([{ text: 'Look here', tags: [] }])
  })

  it('splits on newlines and emits tag-only sentences', () => {
    expect(run(['One\n[CLEAR]\nTwo'])).toEqual([
      { text: 'One', tags: [] },
      { text: '', tags: [{ kind: 'clear' }] },
      { text: 'Two', tags: [] },
    ])
  })
})

it('speakable strips markdown symbols', () => {
  expect(speakable('**Bold** and `code` # x')).toBe('Bold and code x')
})
