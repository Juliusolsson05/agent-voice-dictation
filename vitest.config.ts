import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    projects: [
      {
        test: {
          name: 'core',
          environment: 'node',
          include: [
            'src/**/*.test.ts',
            'apps/flow-electron/src/**/*.test.ts',
          ],
          exclude: ['src/**/*.system.test.ts', 'src/**/*.live.test.ts'],
        },
      },
      {
        test: {
          name: 'system',
          environment: 'node',
          include: ['src/**/*.system.test.ts'],
          passWithNoTests: true,
          fileParallelism: false,
        },
      },
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'json-summary'],
      include: ['src/**/*.ts', 'apps/flow-electron/src/shared/**/*.ts'],
      // WHY the first thresholds use the current honest denominator: live
      // provider paths remain opt-in, so setting a speculative target would
      // either force network tests into CI or block unrelated fixes. This floor
      // protects today's deterministic signal and can only move upward.
      thresholds: { statements: 36, branches: 30, functions: 32, lines: 38 },
    },
  },
})
