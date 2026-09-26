import { defineConfig } from 'vitest/config';
import path from 'node:path';
import { testEnv } from './tests/env';
export default defineConfig({
  resolve: { alias: { '@': path.resolve('src'), 'server-only': path.resolve('tests/empty.ts') } },
  test: {
    env: testEnv,
    include: ['tests/unit/**/*.test.ts'],
    setupFiles: ['./tests/setup.ts'],
    coverage: {
      provider: 'v8',
      include: [
        'src/server/security/policy.ts',
        'src/features/settings/schema.ts',
        'src/server/env.ts',
        'src/features/sync/schema.ts',
        'src/features/sync/reconcile.ts',
        'src/features/sync/vault.ts',
        'src/features/pwa/install-policy.ts',
        'src/features/work/schema.ts',
        'src/features/work/domain.ts',
      ],
      thresholds: { lines: 80, functions: 80, branches: 80, statements: 80 },
    },
  },
});
