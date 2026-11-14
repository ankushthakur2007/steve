// Hidden window: microphone capture (webm/opus chunks -> main -> Deepgram) and mp3 playback.
const { steve } = window

let recorder: MediaRecorder | null = null
let stopRequested = -1

steve.on('mic-start', async (id: number) => {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true } })
    if (stopRequested === id) { stream.getTracks().forEach((t) => t.stop()); steve.send('mic-done', id); return }
    const rec = new MediaRecorder(stream, { mimeType: 'audio/webm;codecs=opus' })
    let sent = Promise.resolve() // chunks go out strictly in order, and 'mic-done' after the last one
    rec.ondataavailable = (e) => {
      if (e.data.size) sent = sent.then(async () => steve.send('mic-chunk', id, await e.data.arrayBuffer()))
    }
    rec.onstop = () => {
      stream.getTracks().forEach((t) => t.stop())
      sent = sent.then(() => steve.send('mic-done', id))
    }
    rec.start(100) // 100 ms chunks keep transcription latency low
    recorder = rec
  } catch (e) {
    steve.send('mic-error', e instanceof Error ? e.message : String(e))
  }
})

steve.on('mic-stop', (id: number) => {
  stopRequested = id
  if (recorder?.state === 'recording') recorder.stop()
  recorder = null
})

const ctx = new AudioContext()
let source: AudioBufferSourceNode | null = null

let generation = 0 // bumped by 'stop', so audio still decoding when interrupted never plays

steve.on('play', async (data: ArrayBuffer | Uint8Array) => {
  const gen = generation
  try {
    const buf = data instanceof ArrayBuffer ? data : data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength)
    if (ctx.state === 'suspended') await ctx.resume()
    const audio = await ctx.decodeAudioData(buf as ArrayBuffer)
    if (gen !== generation) return
    const s = ctx.createBufferSource()
    s.buffer = audio
    s.connect(ctx.destination)
    s.onended = () => { if (source === s) { source = null; steve.send('played') } }
    source = s
    s.start()
  } catch {
    steve.send('played') // never leave the speech queue waiting
  }
})

steve.on('stop', () => {
  generation++
  const s = source
  source = null
  s?.stop()
})

export {}
