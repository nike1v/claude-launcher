import { fileURLToPath } from 'node:url'
import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      // Tests transitively import the main process, which imports `electron`.
      // Outside the electron runtime that module throws unless its binary
      // postinstall wrote path.txt (flaky across pnpm/CI). Redirect to a
      // lightweight stub so tests never need the real binary. Per-test
      // vi.mock('electron', …) still takes precedence where richer behaviour
      // is needed. Production is bundled via electron.vite.config, not this.
      electron: fileURLToPath(new URL('./tests/electron-stub.ts', import.meta.url))
    }
  },
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/renderer/**', 'happy-dom'],
      ['tests/**', 'node']
    ]
  }
})
