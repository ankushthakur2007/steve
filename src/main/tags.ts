// Splits the model's streamed reply into speakable sentences and pulls out
// inline drawing tags like [POINT:640,360:Export button]. Pure, so it is unit tested.

export type Tag =
  | { kind: 'point'; x: number; y: number; label: string }
  | { kind: 'box'; x: number; y: number; w: number; h: number; label: string }
  | { kind: 'arrow'; x1: number; y1: number; x2: number; y2: number; label: string }
  | { kind: 'label'; x: number; y: number; text: string }
  | { kind: 'clear' }

export type Sentence = { text: string; tags: Tag[] }

const ARITY = { POINT: 2, BOX: 4, ARROW: 4, LABEL: 2 } as const

/** Parses the inside of a tag ("POINT:10,20:label"). Returns null for anything that is not a valid tag. */
export function parseTag(inner: string): Tag | null {
  if (inner.trim() === 'CLEAR') return { kind: 'clear' }
  const [name, nums = '', ...rest] = inner.split(':')
  const arity = ARITY[name as keyof typeof ARITY]
  if (!arity) return null
  const n = nums.split(',').map((v) => Number(v.trim()))
  if (n.length !== arity || n.some((v) => !Number.isFinite(v))) return null
  const label = rest.join(':').trim()
  switch (name) {
    case 'POINT': return { kind: 'point', x: n[0], y: n[1], label }
    case 'BOX': return { kind: 'box', x: n[0], y: n[1], w: n[2], h: n[3], label }
    case 'ARROW': return { kind: 'arrow', x1: n[0], y1: n[1], x2: n[2], y2: n[3], label }
    default: return { kind: 'label', x: n[0], y: n[1], text: label }
  }
}

/** Removes markdown symbols that would otherwise be read aloud. */
export const speakable = (text: string) => text.replace(/[*_#`]/g, '').replace(/\s+/g, ' ').trim()

const MAX_TAG = 200 // a '[' with no ']' within this many chars is plain text

export function createSentenceStream(onSentence: (s: Sentence) => void) {
  let sentence = '' // scanned text of the current sentence
  let rest = '' // not yet scanned
  let tags: Tag[] = []

  const flush = () => {
    const text = sentence.replace(/\s+/g, ' ').replace(/ ([.,!?;:])/g, '$1').trim()
    if (text || tags.length) onSentence({ text, tags })
    sentence = ''
    tags = []
  }

  const drain = (final: boolean) => {
    while (rest) {
      const i = rest.search(/[[.!?\n]/)
      if (i === -1) { sentence += rest; rest = ''; break }
      const ch = rest[i]
      if (ch === '[') {
        const close = rest.indexOf(']', i)
        if (close === -1) {
          if (!final && rest.length - i < MAX_TAG) { sentence += rest.slice(0, i); rest = rest.slice(i); return }
          if (final && /^\[(POINT|BOX|ARROW|LABEL|CLEAR)/.test(rest.slice(i))) { sentence += rest.slice(0, i); rest = ''; break }
        }
        const tag = close === -1 ? null : parseTag(rest.slice(i + 1, close))
        if (tag) { sentence += rest.slice(0, i); tags.push(tag); rest = rest.slice(close + 1) }
        else { sentence += rest.slice(0, i + 1); rest = rest.slice(i + 1) }
        continue
      }
      // . ! ? end a sentence only when followed by whitespace, so wait for the next character.
      if (ch !== '\n' && i + 1 >= rest.length && !final) { sentence += rest.slice(0, i); rest = rest.slice(i); return }
      sentence += rest.slice(0, i + 1)
      rest = rest.slice(i + 1)
      if (ch === '\n' || rest === '' || /\s/.test(rest[0])) flush()
    }
    if (final) flush()
  }

  return {
    push(chunk: string) { rest += chunk; drain(false) },
    end() { drain(true) },
  }
}
