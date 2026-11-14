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
- **Stop:** **Esc** stops speech and takes back control of the mouse.
- **Type:** **Ctrl + Shift + Space** (**Cmd + Shift + Space**) opens the panel. "include my screen" decides whether STEVE sees your screen.
- **Visuals:** ask "show me how merge sort works" or "explain how a car engine works in 3D". Click parts of a visual to ask about them.
- **Tasks:** ask "research the best open-source rendering engines for my project". The Tasks tab shows progress, questions from the agent, and a Stop button. Agents can use a browser window you can watch.
- **Do it for me:** ask "open my downloads folder and sort the PDFs into a folder". STEVE asks permission first, shows a red banner while in control, asks before anything consequential, and stops as soon as you move the mouse or press Esc.
- **Memory:** "remember that I use DaVinci Resolve 20" or "forget that". Settings > Memory opens or deletes the memory folder. Screenshots are never stored.

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
  board.ts    visuals in a sandboxed iframe; Three.js, Chart.js, Mermaid, KaTeX bundled
  agents.ts   background tasks with MCP tools (Playwright browser, your own servers)
  control.ts  mouse and keyboard (nut-js) with permission, banner and kill switches
  memory.ts   plain files: facts.md and daily conversation logs
Windows: overlay per display (click-through), panel, board, hidden audio window
```

Phases from the plan and where they live: see/talk/point (`index.ts`, `brain.ts`, `overlay.ts`), 2D and 3D visuals (`board.ts`, `visual.ts`), memory and privacy (`memory.ts`, panel setup), agents and browser (`agents.ts`), computer control (`control.ts`), connected apps (Settings > Agents > MCP servers).

## Checks

```sh
npm test                 # unit tests + a full conversation turn with a mock model
npm run typecheck
npm run build && npm run e2e    # end-to-end test of the real app (see below)
npm run eval:pointing -- openai:gpt-6-luna anthropic:claude-sonnet-5-5   # pointing accuracy
```

**End-to-end test (`npm run e2e`).** Launches the built app against a mock model server and drives it with the real mouse and keyboard (17 checks):
- **Pointing:** the cursor buddy follows the mouse, and a typed question with a screenshot makes it land on the exact pixel.
- **Visuals:** the board loads Chart.js, Three.js, Mermaid and KaTeX with network access blocked; clicking a visual asks STEVE about it; a PubChem molecule renders.
- **Memory and tasks:** memory and a background task work.
- **Computer control:** a real click lands on the right spot, a fresh screenshot follows each action, and it stops on mouse movement and on Esc.
- **Keys and talk keys:** API keys are stored encrypted; Ctrl+Alt is detected and Ctrl+Alt+T is ignored.
- **Voice:** a full spoken turn runs (microphone to speech-to-text to answer to playback, sentence by sentence with pointing in sync, Deepgram faked inside the app), and Esc stops the voice mid-answer.

By default the mock speaks Chat Completions (the local-server path); `E2E_API=responses npm run e2e` tests the Responses API that real OpenAI uses. Don't touch the computer while it runs. On macOS, give your terminal Screen Recording and Accessibility permission first. On Linux without a display, run it under Xvfb. Both modes pass 17/17 on Linux (Xvfb); run it once on Windows and once on macOS.

**Pointing benchmark.** `eval/pointing/` ships 12 labelled cases from live websites (Wikipedia, GitHub, Hacker News, npm, Python docs), made by `npx electron eval/pointing/collect.mjs`. Add screenshots of the apps you care about (Blender, DaVinci Resolve) by hand as described in `eval/pointing/README.md`, then run it with your API keys in the environment.

### Testing on a Mac without a paid Apple account

- **From source (best for debugging):** `npm run dev`. Main-process logs, including `[latency]`, print in the terminal. macOS gives the permissions to your terminal app (Terminal, iTerm, VS Code), so grant it Microphone, Screen Recording and Accessibility once, then restart the terminal.
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

## Not yet done

- Code signing and notarization (needed before sharing installers; Apple charges $99/year).
- A curated pack of labelled 3D models for flagship demos (engines, etc.); today 3D models are built from primitives by the AI or come from PubChem.
- "Hey Steve" wake word, offline speech models, auto-update.
