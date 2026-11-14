import { resolve } from 'node:path'
import { defineConfig } from 'electron-vite'

const page = (name: string) => resolve(import.meta.dirname, `src/renderer/${name}.html`)

export default defineConfig({
  main: {},
  // Sandboxed preloads must be CommonJS.
  preload: { build: { rolldownOptions: { output: { format: 'cjs', entryFileNames: '[name].cjs' } } } },
  renderer: {
    build: {
      rolldownOptions: {
        input: { overlay: page('overlay'), panel: page('panel'), audio: page('audio'), board: page('board') },
      },
    },
  },
})
