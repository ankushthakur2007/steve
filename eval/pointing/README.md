# Pointing benchmark

Measures whether a model's `[POINT:x,y]` lands on the right control, how long it takes, and what it costs. Run it before trusting a model with dense apps like Blender, DaVinci Resolve or Unreal.

## Cases

`cases.json` ships with 12 cases from live websites, made by `npx electron eval/pointing/collect.mjs`: it opens each page at 1920x1080, finds each target in the page's DOM, and saves a 1280x720 screenshot with the target's box. Re-run it to refresh them; edit `PAGES` in that file to add sites.

Desktop apps have no DOM, so label those by hand:

1. Take screenshots of real apps (aim for about 30: browser, VS Code, Blender, DaVinci Resolve, at 1080p and 4K).
2. Downscale each to 1280 px on the long side, as STEVE does, and save it in this folder.
3. Open it in any image editor and note the rectangle of the correct target: x, y of the top-left corner, then width and height, in pixels.
4. Add an entry to `cases.json`:

```json
[
  {
    "image": "resolve-playback.png",
    "width": 1280,
    "height": 720,
    "question": "Where do I change the playback resolution?",
    "box": [412, 36, 90, 22]
  }
]
```

## Run

```sh
export OPENAI_API_KEY=...        # and ANTHROPIC_API_KEY / GOOGLE_GENERATIVE_AI_API_KEY for others
npm run eval:pointing -- openai:gpt-6-luna anthropic:claude-sonnet-5-5
```

If Luna misses on dense UIs, switch the `chat` model in STEVE's settings to the model that scores best.
