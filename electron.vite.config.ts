import { defineConfig, externalizeDepsPlugin } from 'electron-vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  main: {
    // node-pty is a native module that dynamically requires its prebuilt
    // .node file at runtime (e.g. ./prebuilds/win32-x64/conpty.node).
    // Bundling it via Rollup breaks that lookup with:
    //   "Could not dynamically require ./prebuilds/win32-x64/conpty.node"
    // externalizeDepsPlugin keeps every package.json dependency outside the
    // bundle so they're loaded from node_modules at runtime — which is the
    // right default for main-process deps (electron-updater, node-pty, etc.).
    plugins: [externalizeDepsPlugin()],
    build: { lib: { entry: 'src/main/index.ts' } }
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      lib: { entry: 'src/preload/index.ts' },
      rollupOptions: { output: { format: 'cjs', entryFileNames: '[name].js' } }
    }
  },
  renderer: {
    plugins: [react(), tailwindcss()],
    build: { rollupOptions: { input: 'src/renderer/index.html' } }
  }
})
