import { sleep } from './windows'

export type Stt = { send(chunk: ArrayBuffer): void; finish(): Promise<string>; cancel(): void }

/**
 * Deepgram live transcription. Audio is webm/opus from MediaRecorder, which Deepgram
 * detects from the container, so no encoding parameters are sent.
 */
export function openStt(key: string, onText: (soFar: string) => void, onSpeechEnd?: () => void): Stt {
  // Hands-free listening ends on a pause, so Deepgram waits for 900 ms of silence before calling the speech finished.
  const url = 'wss://api.deepgram.com/v1/listen?model=nova-3&smart_format=true&interim_results=true' + (onSpeechEnd ? '&endpointing=900' : '')
  const ws = new WebSocket(url, {
    headers: { Authorization: `Token ${key}` },
  } as unknown as string[]) // Node's WebSocket accepts headers; the DOM typings do not know that.
  const pending: (string | ArrayBuffer)[] = []
  const finals: string[] = []
  let interim = ''
  let failed = false
  const closed = new Promise<void>((r) => ws.addEventListener('close', () => r()))

  ws.addEventListener('error', () => { failed = true })
  ws.addEventListener('open', () => { pending.forEach((m) => ws.send(m)); pending.length = 0 })
  ws.addEventListener('message', (e) => {
    let m: any
    try { m = JSON.parse(String(e.data)) } catch { return }
    if (m.type !== 'Results') return
    const t: string = m.channel?.alternatives?.[0]?.transcript ?? ''
    if (m.is_final) { if (t) finals.push(t); interim = '' } else interim = t
    onText([...finals, interim].join(' ').trim())
    if (m.speech_final && finals.length) onSpeechEnd?.()
  })

  const send = (m: string | ArrayBuffer) => {
    if (ws.readyState === WebSocket.OPEN) ws.send(m)
    else if (ws.readyState === WebSocket.CONNECTING) pending.push(m)
  }

  return {
    send,
    async finish() {
      send(JSON.stringify({ type: 'CloseStream' })) // Deepgram flushes the last results, then closes
      await Promise.race([closed, sleep(4000)])
      ws.close()
      const text = [...finals, interim].join(' ').trim()
      if (!text && failed) throw new Error('Could not reach Deepgram. Check the Deepgram API key and your connection.')
      return text
    },
    cancel: () => ws.close(),
  }
}
