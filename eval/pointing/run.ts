// Pointing benchmark: how often does each model put its [POINT] inside the right on-screen element?
// Usage:  node eval/pointing/run.ts openai:gpt-6-luna anthropic:claude-sonnet-5-5 google:gemini-3.8-flash
// Keys come from OPENAI_API_KEY, ANTHROPIC_API_KEY, GOOGLE_GENERATIVE_AI_API_KEY.
// Cases live in eval/pointing/cases.json (see README.md in this folder).
import { anthropic } from '@ai-sdk/anthropic'
import { google } from '@ai-sdk/google'
import { openai } from '@ai-sdk/openai'
import { createProviderRegistry, generateText } from 'ai'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { CHAT_PROMPT } from '../../src/main/prompts.ts'
import { createSentenceStream } from '../../src/main/tags.ts'
import { tokenCost } from '../../src/main/prices.ts' // add the models you test to MODEL_PRICES there

type Case = { image: string; width: number; height: number; question: string; box: [number, number, number, number] }

const dir = import.meta.dirname
const cases: Case[] = JSON.parse(readFileSync(join(dir, 'cases.json'), 'utf8'))
const models = process.argv.slice(2)
if (!models.length || !cases.length) {
  console.log(cases.length ? 'Usage: node eval/pointing/run.ts provider:model [...]' : 'Add cases to eval/pointing/cases.json first (see eval/pointing/README.md).')
  process.exit(1)
}
const registry = createProviderRegistry({ openai, anthropic, google })

function firstPoint(text: string) {
  let point: { x: number; y: number } | undefined
  const s = createSentenceStream((sentence) => {
    for (const t of sentence.tags) if (!point && t.kind === 'point') point = { x: t.x, y: t.y }
  })
  s.push(text)
  s.end()
  return point
}

for (const id of models) {
  console.log(`\n${id}`)
  let hits = 0, ms = 0, inTok = 0, outTok = 0, errors = 0
  for (const c of cases) {
    const t0 = performance.now()
    try {
      const { text, usage } = await generateText({
        model: registry.languageModel(id as `openai:${string}`),
        system: CHAT_PROMPT,
        reasoning: 'low', // same setting as the app
        messages: [{
          role: 'user',
          content: [
            { type: 'text', text: `${c.question}\n\n(Screenshot of the user's screen attached: ${c.width}x${c.height} pixels.)` },
            { type: 'file', data: readFileSync(join(dir, c.image)), mediaType: c.image.endsWith('.png') ? 'image/png' : 'image/jpeg' },
          ],
        }],
      })
      ms += performance.now() - t0
      inTok += usage.inputTokens ?? 0
      outTok += usage.outputTokens ?? 0
      const p = firstPoint(text)
      const [x, y, w, h] = c.box
      const hit = !!p && p.x >= x && p.x <= x + w && p.y >= y && p.y <= y + h
      if (hit) hits++
      console.log(`  ${hit ? 'hit ' : 'miss'} ${c.image}: ${p ? `${p.x},${p.y}` : 'no point'}`)
    } catch (e) {
      errors++
      console.log(`  error ${c.image}: ${e instanceof Error ? e.message : e}`)
    }
  }
  const n = cases.length
  const total = tokenCost(id, inTok, outTok)
  const cost = total === null ? 'unknown $' : `$${(total / n).toFixed(5)}`
  console.log(`=> ${hits}/${n} hits (${Math.round((100 * hits) / n)}%), ${(ms / n / 1000).toFixed(2)} s average, ${cost} per call, ${errors} errors`)
}
