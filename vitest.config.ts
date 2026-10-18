import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    // e2e setup builds the Nuxt app once per test file.
    hookTimeout: 300_000,
    testTimeout: 30_000,
  },
})
