import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  test: {
    globals: true,
    include: ['tests/**/*.test.ts', 'src/**/*.test.tsx', 'src/**/*.test.ts'],
    environmentMatchGlobs: [
      ['src/renderer/**', 'happy-dom'],
      ['tests/**', 'node']
    ]
  }
})
