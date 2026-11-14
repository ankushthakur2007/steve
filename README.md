# STEVE

A desktop AI companion for Windows 10/11 and macOS 14+. Hold a key, ask a question, and STEVE looks at your screen, answers out loud, and flies its cursor buddy to what it is talking about. It can open interactive diagrams, charts, step-by-step animations and 3D models, run background research agents, and, when you ask, use your mouse and keyboard.

## Setup

Requires Node.js 22.6 or newer.

```sh
npm install
npm run dev          # run from source
npm run dist:win     # build a Windows installer (on Windows)
npm run dist:mac     # build a macOS .dmg (on a Mac)
```

On first launch STEVE opens a setup screen. You need:

| Key | Used for | Cost |
|---|---|---|
| OpenAI | The brain: GPT-6 Luna for conversation, pointing, visuals and agents | about $0.10 / $0.50 per million tokens in/out, roughly $0.0005 per question with a screenshot |
| Deepgram | Hearing (Nova-3) and voice (Aura-2) | $200 free credit on signup; about $0.0077 per minute of listening and $0.03 per 1,000 spoken characters |
| ElevenLabs (optional) | A more natural premium voice | about $0.04 per 1,000 characters; choose it under Settings > Voice |
| Anthropic / Google (optional) | Alternative models for any role | per their pricing |

Keys stay on your computer, encrypted by the operating system (Keychain on macOS, DPAPI on Windows).

On macOS, grant **Microphone**, **Screen Recording** and **Accessibility** when asked (the setup screen has buttons for each). Accessibility is what lets the talk keys work in other apps and lets STEVE control the mouse.

## Using STEVE

- **Talk:** hold **Ctrl + Alt** (**Control + Option** on Mac), speak, release. Press again while it is talking to interrupt.
- **Reply hands-free:** after a spoken answer STEVE keeps listening for about 6 seconds, so you can just answer back. It looks at your screen again only if you speak. Turn it off under Settings > Conversation.
- **Stop:** **Esc** stops speech, ends hands-free listening, and takes back control of the mouse.
- **Type:** **Ctrl + Shift + Space** (**Cmd + Shift + Space**) opens the panel. The **Screen** toggle decides whether STEVE sees your screen. The suggestions on the empty chat are a quick way to try things.
- **Copied text:** copy something and say "explain what I copied" or "translate this and copy it". STEVE reads the clipboard only when you ask, says so in the chat, and can put its answer back on the clipboard.
- **Visuals:** ask "explain how a jet engine works in 3D" or "show me how merge sort works". STEVE starts explaining straight away while the visual is made in the background. A 3D model builds up on your screen part by part as the AI writes it, with no background, frosted tags and sharp edges; drag to turn it, click a part to ask about it, and use the step bar for the guided tour (camera moves, cutaways, exploded views). Diagrams and charts appear a few seconds later on a dark card. Visuals float on the side of the screen away from your cursor; hover over one to show its toolbar: move it by dragging the title, make it bigger, close it (or press Esc), go back and forward through this session's visuals, or **Save** it as a web page that opens in any browser.
- **Tasks:** ask "research the best open-source rendering engines for my project". The Tasks tab shows progress, questions from the agent, and a Stop button. Agents can use a browser window you can watch.
- **Do it for me:** ask "open my downloads folder and sort the PDFs into a folder". The first time, STEVE asks permission; choose **Always allow** to switch on autopilot so it never asks again (turn it off under Settings > Mouse and keyboard). It shows a red banner and a red screen edge while in control, asks before anything consequential, and stops as soon as you move the mouse or press Esc.
- **Memory:** "remember that I use DaVinci Resolve 20" or "forget that". Settings > Conversation opens or deletes the memory folder. Screenshots are never stored.
- **Cost:** the panel header shows what STEVE has cost today. Settings > Usage breaks this month down by service and lets you set a daily limit; once today reaches it, STEVE stops calling paid services until tomorrow.

Any model role can be changed in Settings > Models, e.g. `anthropic:claude-sonnet-5-5`, or pointed at a local OpenAI-compatible server.

## How it works

```
Electron main process (TypeScript, holds the API keys)
  hotkey.ts   push-to-talk key down/up (uiohook-napi)
  capture.ts  screenshot of the display under the cursor, 1280 px
  stt.ts      Deepgram streaming speech-to-text
  brain.ts    AI SDK: conversation, tools, history, model roles
  tags.ts     splits the reply into sentences and [POINT]/[BOX]/[ARROW]/[LABEL] tags
  tts.ts      per-sentence speech, played in order, tags fire with their sentence
  scene.ts    makes visuals in the background: streams 3D scenes, writes 2D pages
  board.ts    floating visuals window, sandboxed iframe; Three.js, Chart.js, Mermaid, KaTeX bundled
src/visual/steve3d.js  the 3D scene engine: parts library, streaming player, lighting, tags, tours
  agents.ts   background tasks with MCP tools (Playwright browser, your own servers)
  control.ts  mouse and keyboard (nut-js) with permission, banner and kill switches
  memory.ts   plain files: facts.md and daily conversation logs
  usage.ts    the cost meter (usage.json); prices in prices.ts
  log.ts      the debug log (terminal and logs/steve.log) when run from source or with STEVE_DEBUG=1
Windows: overlay per display (click-through), panel, board, hidden audio window
```

**3D: a scene engine on Three.js.** The slow part of a 3D answer was never drawing it (the first frame takes well under a second) but the AI writing a whole page of code before anything could show. So the AI now writes a short scene description, one JSON line per part (`{"part":"Fan","shape":"fan","blades":22,"axis":"x",...}`), and `src/visual/steve3d.js` draws each line the moment it arrives. Its parts library turns one line into a detailed object: gear, fan (twisted blades), discs (bladed compressor stages), spring, bolt (hex head and thread), wheel, circuit board, chip (with pins), pin header, ports (USB, USB-C, HDMI, Ethernet, audio), screen, DNA helix and planet, plus boxes, cylinders, lathes, tubes and extrusions, any of them repeated in a row or a ring. The engine adds the finish the same way every time, in the spirit of Apple's product drawings: studio lighting with a rim light, hairline edges, crisp anti-aliasing, frosted tags with a colour dot, Apple's system colours for arrows, and the frosted step bar. It also does the explaining: clickable parts, tags kept apart on screen, flow arrows, cutaways, camera moves, exploded views and guided tours. The scene prompt is `SCENE_PROMPT` in `prompts.ts`; model-written code can still use the same kit with `import { stage } from 'steve3d'`.

**Design.** STEVE is a small yellow character with an ink outline. Its eyes follow what it's looking at, and everything it draws on screen is in the same yellow "marker" ink, with a dark under-stroke so it reads on any background. Anything STEVE says (captions, labels, its chat replies) is set in Recursive Casual, a free variable font bundled with the app. The rest of the interface uses the system font and follows the system's light or dark mode, with frosted glass on macOS. The colours live in `src/renderer/theme.css`; the app icon is `build/icon.svg`, rendered to `build/icon.png` with `npx electron build/icon.mjs`.

Phases from the plan and where they live: see/talk/point (`index.ts`, `brain.ts`, `overlay.ts`), 2D and 3D visuals (`board.ts`, `visual.ts`), memory and privacy (`memory.ts`, panel setup), agents and browser (`agents.ts`), computer control (`control.ts`), connected apps (Settings > Agents > MCP servers).

## Checks

```sh
npm test                 # unit tests + a full conversation turn with a mock model
npm run typecheck
npm run build && npm run e2e    # end-to-end test of the real app (see below)
npm run eval:pointing -- openai:gpt-6-luna anthropic:claude-sonnet-5-5   # pointing accuracy
```

**End-to-end test (`npm run e2e`).** Launches the built app against a mock model server and drives it with the real mouse and keyboard (26 checks):
- **Pointing:** the cursor buddy follows the mouse, and a typed question with a screenshot makes it land on the exact pixel.
- **Visuals:** the board loads Chart.js, Three.js, Mermaid and KaTeX with network access blocked; clicking a visual asks STEVE about it; a PubChem molecule renders; back/forward moves between visuals and Save writes a copy that loads its libraries from a CDN.
- **3D kit:** a kit scene floats on top with no background, a real mouse click on a part asks STEVE about that part, the tour's next step cuts the model open, Save keeps the kit inside the file, and Close hides the window.
- **Streamed 3D:** a scene arriving in small pieces (with prose and a broken line mixed in) is drawn part by part with library shapes and edges, STEVE answers without waiting for it, and back/forward replays it from the saved lines.
- **Visual failures:** a model with broken shapes and a model call that fails both show a message on the visual (never an empty window) and appear in the debug log.
- **Clipboard:** an unrelated question doesn't send the clipboard; "explain what I copied" does, and an answer can be copied back.
- **Memory and tasks:** memory and a background task work.
- **Computer control:** a real click lands on the right spot, a fresh screenshot follows each action, "Always allow" skips the question next time, and it stops on mouse movement and on Esc.
- **Keys and talk keys:** API keys are stored encrypted and never written to the debug log; Ctrl+Alt is detected and Ctrl+Alt+T is ignored.
- **Voice:** a full spoken turn runs (microphone to speech-to-text to answer to playback, sentence by sentence with pointing in sync, Deepgram faked inside the app), a hands-free reply is heard without the keys, and Esc stops the voice mid-answer.
- **Cost:** tokens, listening time and speech are metered per service and shown in Settings > Usage, and a daily limit stops further model calls.

By default the mock speaks Chat Completions (the local-server path); `E2E_API=responses npm run e2e` tests the Responses API that real OpenAI uses. Don't touch the computer while it runs. On macOS, give your terminal Screen Recording and Accessibility permission first. On Linux without a display, run it under Xvfb. Both modes pass 26/26 on Linux (Xvfb); run it once on Windows and once on macOS.

**Pointing benchmark.** `eval/pointing/` ships 12 labelled cases from live websites (Wikipedia, GitHub, Hacker News, npm, Python docs), made by `npx electron eval/pointing/collect.mjs`. Add screenshots of the apps you care about (Blender, DaVinci Resolve) by hand as described in `eval/pointing/README.md`, then run it with your API keys in the environment.

### Debugging

`npm run dev` turns on a detailed debug log. Each line has the time and what it's about:

| Tag | What it shows |
|---|---|
| `[keys]` `[mic]` `[stt]` | talk keys, which microphone is recording, the Deepgram connection (close codes, audio sent) and every phrase it heard |
| `[turn]` `[model]` `[tool]` | each question, the model called and its token use, time to the first words, every tool call with its input, result and timing |
| `[tts]` `[draw]` `[latency]` | each spoken sentence and how long the voice took, every point or drawing, key-up to first spoken word |
| `[scene]` `[visual]` `[board]` | 3D scenes streaming in (time to the first line, lines skipped), visuals requested and received, where the window is, clicks on them, and console messages and errors from inside the visual itself; `[3D] ready` says how long the model took to draw and which graphics chip drew it |
| `[control]` `[task]` | computer-control steps, permission answers and why it stopped; background task progress |
| `[panel]` `[overlay]` `[audio]` | console messages, errors and crashes from STEVE's own windows |
| `ERROR` | any error, with its stack trace |

The same log is saved in STEVE's data folder, in `logs/steve.log` (the first line in the terminal shows the full path; on a Mac it's under `~/Library/Application Support/STEVE/`, on Windows under `%APPDATA%\STEVE\`). Next to it, `last-scene.jsonl` and `last-visual.html` are the last 3D scene and 2D visual exactly as the model wrote them; open it in a browser to see what went wrong.

The installed app writes the log only when started with `STEVE_DEBUG=1`: on a Mac, `STEVE_DEBUG=1 /Applications/STEVE.app/Contents/MacOS/STEVE`; on Windows (PowerShell), `$env:STEVE_DEBUG=1; & "$env:LOCALAPPDATA\Programs\STEVE\STEVE.exe"`.

The log never contains API keys, screenshots or audio. It does contain your questions and STEVE's answers, and the start of anything STEVE read from the clipboard, so delete the `logs` folder when you're done debugging if that matters to you.

### Testing on a Mac without a paid Apple account

- **From source (best for debugging):** `npm run dev`. The debug log (below) prints in the terminal. macOS gives the permissions to your terminal app (Terminal, iTerm, VS Code), so grant it Microphone, Screen Recording and Accessibility once, then restart the terminal.
- **Inspect the windows:** `npm run dev -- --remoteDebuggingPort 9222`, open `chrome://inspect` in Chrome, add `localhost:9222` under Configure, and inspect the panel, overlay, board or audio page. `npm run dev -- --inspect` does the same for the main process (or attach VS Code to port 5858).
- **As a real app:** `npm run build && npx electron-builder --mac dir` makes `dist/mac-arm64/STEVE.app`, ad-hoc signed, so it runs on the Mac that built it. Each rebuild looks like a new app to macOS, and old permission switches stop working even though they still show as on, so run `tccutil reset All app.steve.companion` before opening a new build.
- **On another Mac:** macOS blocks an ad-hoc signed app downloaded from elsewhere; open it once via System Settings > Privacy & Security > Open Anyway.

### Manual checklist (needs real Windows and macOS hardware)

- [ ] The buddy follows the mouse across two monitors and over a fullscreen app (video, game, fullscreen browser).
- [ ] At 150% (Windows) and Retina (macOS) scaling, "point at the clock" lands on it.
- [ ] Typing with AltGr (e.g. @ on a German keyboard) does not trigger push-to-talk.
- [ ] STEVE's overlay and panel do not appear in its own screenshots.
- [ ] With real keys: you hear the answer, and key-release to first spoken word is under 1.5 s (`[latency]` in the terminal).
- [ ] A research task with the browser agent opens a browser window you can watch.
- [ ] The permission prompts on macOS appear and the setup screen shows them as granted.
- [ ] The panel is frosted glass on macOS and switches between light and dark with the system.
- [ ] "Explain how a jet engine works in 3D": "Making …" shows straight away, then the model floats with no background or black box behind it, turns when dragged, and the toolbar appears when the pointer is over it.
- [ ] On a Mac, ask for a 3D visual while on a second desktop (Space) and while an app is full screen: it appears where you are.
- [ ] After a spoken answer, replying without the keys works, and staying quiet ends listening after about 6 seconds (the orange mic dot goes away).

## What's next

See [ROADMAP.md](ROADMAP.md) for the plan: what to build next, in what order, and what each step costs.
