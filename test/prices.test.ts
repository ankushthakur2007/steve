import { describe, expect, it } from 'vitest'
import { dollars, listenCost, speechCost, tokenCost } from '../src/main/prices'

describe('cost meter prices', () => {
  it('prices tokens per million, and leaves unknown models unpriced', () => {
    expect(tokenCost('openai:gpt-6-luna', 1_000_000, 1_000_000)).toBeCloseTo(0.6)
    expect(tokenCost('openai:gpt-6-luna', 10, 5)).toBeCloseTo(3.5e-6)
    expect(tokenCost('someone:unknown', 1000, 1000)).toBeNull()
  })

  it('prices listening by the minute and speech by the character', () => {
    expect(listenCost(60)).toBeCloseTo(0.0077)
    expect(speechCost('deepgram', 1000)).toBeCloseTo(0.03)
    expect(speechCost('elevenlabs', 500)).toBeCloseTo(0.02)
  })

  it('shows small amounts with enough digits to see them move', () => {
    expect(dollars(0)).toBe('$0.00')
    expect(dollars(0.0042)).toBe('$0.004')
    expect(dollars(1.234)).toBe('$1.23')
  })
})
