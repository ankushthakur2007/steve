// Built-in 3D explainers that work without any API key: a first look for new users, and something
// judges and reviewers can try straight away. Each is a scene in the same format the model writes.
import gearbox from './demos/gearbox.jsonl?raw'
import jetEngine from './demos/jet-engine.jsonl?raw'
import raspberryPi from './demos/raspberry-pi.jsonl?raw'

export const DEMOS = [
  { title: 'How a jet engine works', scene: jetEngine },
  { title: 'Inside a Raspberry Pi 5', scene: raspberryPi },
  { title: 'How gears trade speed for force', scene: gearbox },
].map((d) => ({ title: d.title, lines: d.scene.trim().split('\n').filter((l) => l.trim()) }))
