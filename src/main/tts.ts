import { getKeys, getSettings } from './settings'
import { createSentenceStream, speakable, type Sentence } from './tags'

/** One sentence of speech as mp3, or null when the voice is off. */
export async function synth(text: string, signal: AbortSignal): Promise<ArrayBuffer | null> {
  const s = getSettings()
  const k = getKeys()
  if (s.voice === 'off') return null
  let res: Response
  if (s.voice === 'elevenlabs') {
    if (!k.elevenlabs) throw new Error('Add an ElevenLabs key in settings, or switch the voice to Deepgram.')
    res = await fetch(
      `https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(s.elevenVoiceId)}/stream?output_format=mp3_44100_128`,
      {
        method: 'POST',
        signal,
        headers: { 'xi-api-key': k.elevenlabs, 'content-type': 'application/json' },
        body: JSON.stringify({ text, model_id: 'eleven_flash_v2_5' }),
      },
    )
  } else {
    if (!k.deepgram) throw new Error('Add a Deepgram key in settings to hear STEVE, or set the voice to off.')
    res = await fetch(`https://api.deepgram.com/v1/speak?model=${encodeURIComponent(s.deepgramVoice)}&encoding=mp3`, {
      method: 'POST',
      signal,
      headers: { Authorization: `Token ${k.deepgram}`, 'content-type': 'application/json' },
      body: JSON.stringify({ text }),
    })
  }
  if (!res.ok) throw new Error(`Voice service error ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return res.arrayBuffer()
}

/**
 * Turns streamed model text into speech, sentence by sentence. Each sentence is synthesized
 * as soon as it is complete (in parallel) but played strictly in order; its drawing tags
 * fire when that sentence starts playing, so pointing stays in sync with the voice.
 */
export function createSpeaker(
  io: { onSentence(s: Sentence): void; play(audio: ArrayBuffer): Promise<void>; onError(e: unknown): void },
  signal: AbortSignal,
) {
  let chain = Promise.resolve()
  let reported = false
  const stream = createSentenceStream((s) => {
    const text = speakable(s.text)
    const audio = (text ? synth(text, signal) : Promise.resolve(null)).catch((e) => {
      if (!signal.aborted && !reported) { reported = true; io.onError(e) }
      return null
    })
    chain = chain.then(async () => {
      const a = await audio
      if (signal.aborted) return
      io.onSentence(s)
      if (a) await io.play(a)
    })
  })
  return {
    push: (text: string) => stream.push(text),
    async end() { stream.end(); await chain },
  }
}
