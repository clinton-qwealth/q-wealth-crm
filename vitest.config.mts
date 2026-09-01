import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  // Resolves the `@/*` alias from tsconfig, so tests import components by the
  // same specifier the app uses rather than by relative path. The Next.js guide
  // still recommends the vite-tsconfig-paths plugin for this; Vite 7 does it
  // natively and warns that the plugin is redundant.
  resolve: { tsconfigPaths: true },
  test: {
    environment: 'jsdom',
    setupFiles: ['./vitest.setup.ts'],
    // Next builds the app; Vitest has no business walking its output.
    exclude: ['node_modules/**', '.next/**'],
  },
})
