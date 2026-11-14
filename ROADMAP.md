# STEVE roadmap

What it would take to make STEVE the best desktop companion there is, using the stack it already has (Electron, the AI SDK, Deepgram, Three.js, MCP) and keeping running costs close to zero. Ordered by value for the effort; each item says what it reuses and what it costs to run.

## Done in this round

- **A look of its own.** A yellow ink-outlined character whose eyes follow what it points at; it bobs, blinks, glows red while listening, looks around while thinking and moves its mouth while speaking. Its drawings are marker-style ink that reads on any background, and its words are set in its own casual typeface. The panel, visuals window and setup follow the system's light or dark mode (frosted glass on macOS). There's a new app icon and tray icon.
- **Hands-free follow-ups.** After a spoken answer, STEVE listens for 6 more seconds. Costs about $0.0008 per answer in Deepgram time; free when switched off.
- **Cost meter and daily limit.** Spend per service today and this month, and a hard daily cap.
- **Visual gallery.** Back/forward through this session's visuals; Save writes a web page that opens in any browser.
- **Copied-text helper.** "Explain what I copied", "translate this and copy it", including copied images.

## Next: make pointing great on pro apps

The promise of STEVE is "it shows me where things are in Blender, Resolve or Unreal". That lives or dies on pointing accuracy on dense screens, which the benchmark measures (`npm run eval:pointing`).

1. **Collect 30 real cases** from the apps that matter to you (`eval/pointing/README.md`). Half an hour of screenshots; no cost.
2. **Zoom pass.** When STEVE points, crop a 400 px square around its first guess at full resolution and ask again for the exact spot. Reuses `capture.ts` (it already has the full-size image) and `tags.ts`. Roughly doubles the cost of a pointing answer (from about $0.0005 to $0.001) but should fix most near-misses. Turn it on only if the benchmark shows a gain.
3. **"Look here."** Hold the talk keys and drag a box to ask about one part of the screen. The crop is sent at full resolution, so small text becomes readable and the request uses fewer tokens. Needs the overlay to take mouse input briefly while the keys are held.
4. **Per-app memory.** Facts tagged with the app in front ("in Resolve I edit on the Cut page"), so answers fit how you work. A small change to `memory.ts`, plus a small native call per OS to learn which app is in front (Electron has no API for it).

## Then: feel instant

5. **Streaming voice.** Deepgram's speak WebSocket starts audio before the sentence is fully synthesized; today each sentence is a separate request. Cuts roughly 150 to 300 ms from the first word. Same price.
6. **Don't send the screen when it isn't needed.** A one-line check in the prompt or a tiny classifier ("what's 15% of 80?" needs no screenshot). Saves about 70% of input tokens on those questions and makes them faster.
7. **Prompt caching.** Keep the system prompt and memory first and unchanged between turns so OpenAI's automatic caching applies; cached input is billed at a fraction of the normal rate (check the current price for Luna).

## Then: do more for you

8. **Selected text without copying.** Press the copy shortcut for the user (nut-js), read the clipboard, then put back what was there. Reuses `control.ts` and the clipboard tools.
9. **One-click connected apps.** A short list of trusted MCP servers (calendar, notes, files, GitHub) with an Add button instead of hand-written JSON. The MCP plumbing exists in `agents.ts`.
10. **Task results you can keep.** Save a finished task's report as Markdown, and reopen past tasks after a restart.
11. **Saved gallery.** Keep visuals across restarts in the user-data folder (the gallery is in memory today, marked with a `shortcut:` comment in `board.ts`).
12. **Launch at login**, a setting using Electron's `setLoginItemSettings`.

## Then: free to run

13. **Offline mode.** Local speech-to-text (Moonshine or Whisper via sherpa-onnx), local voice (Kokoro or Piper) and a local model through the existing OpenAI-compatible URL setting (Ollama, LM Studio). Running cost drops to $0; quality and pointing accuracy drop too, so the benchmark decides which roles can go local.
14. **"Hey Steve" wake word** with openWakeWord (free, runs on the CPU). It needs an always-on microphone, so it stays off unless the user turns it on.

## Before sharing STEVE with other people

15. **Signing.** Apple Developer ID ($99/year) for macOS; on Windows, Azure Trusted Signing (about $10/month) or a free SignPath open-source certificate. Without them, other people's computers warn or block the installer.
16. **Auto-update** through GitHub Releases with electron-updater (free).
17. **Crash and error reports** that the user can read and choose to send. No silent telemetry, in keeping with STEVE's privacy rules.
18. **A curated 3D pack.** A dozen CC-licensed glTF models with named parts (engine, heart, cell, solar system) for the "explain X in 3D" moments where primitives look too simple.

## Measuring "world class"

- Pointing: at least 90% hits on your own 30 pro-app cases.
- Speed: key-up to first word under 1.2 s at the median (`[latency]` lines).
- Cost: under $0.002 per spoken question on average (Settings > Usage).
- Trust: every screenshot, clipboard read and mouse action is visible to the user when it happens; all of these are covered by the end-to-end test.
