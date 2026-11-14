// List prices in US dollars. Pure, so the pointing benchmark and the unit tests can use it.
// shortcut: copied by hand from the providers' pricing pages (Nov 2026); update them when prices change.

/** Dollars per million tokens: [input, output]. Models missing here are counted in tokens only. */
export const MODEL_PRICES: Record<string, [number, number]> = {
  'openai:gpt-6-luna': [0.1, 0.5],
}

export const VOICE_PRICES = {
  listenPerMinute: 0.0077, // Deepgram Nova-3 streaming
  deepgramPer1kChars: 0.03, // Deepgram Aura-2
  elevenlabsPer1kChars: 0.04, // ElevenLabs Flash v2.5
}

export function tokenCost(model: string, input = 0, output = 0): number | null {
  const p = MODEL_PRICES[model]
  return p ? (input * p[0] + output * p[1]) / 1e6 : null
}

export const listenCost = (seconds: number) => (seconds / 60) * VOICE_PRICES.listenPerMinute

export const speechCost = (service: 'deepgram' | 'elevenlabs', chars: number) =>
  (chars / 1000) * (service === 'deepgram' ? VOICE_PRICES.deepgramPer1kChars : VOICE_PRICES.elevenlabsPer1kChars)

/** "$0.004", "$0.12", "$3.40": enough digits to see small amounts move. */
export function dollars(n: number): string {
  if (n === 0) return '$0.00'
  if (n < 0.01) return `$${n.toFixed(3)}`
  return `$${n.toFixed(2)}`
}
