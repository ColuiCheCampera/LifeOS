import { defineConfig, devices } from '@playwright/test';
import { testEnv } from './tests/env';
export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  workers: 1,
  timeout: 60000,
  expect: { timeout: 10000 },
  use: { baseURL: 'http://localhost:3000', trace: 'retain-on-failure' },
  reporter: [['list'], ['html', { open: 'never' }]],
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
  webServer: [
    {
      command: 'node --conditions=react-server --import tsx tests/services.ts',
      url: 'http://localhost:4011/ready',
      timeout: 120000,
      reuseExistingServer: false,
      env: testEnv,
    },
    {
      command: 'npm run dev',
      url: 'http://localhost:3000/login',
      timeout: 120000,
      reuseExistingServer: false,
      env: { ...testEnv, NEXT_TELEMETRY_DISABLED: '1' },
    },
  ],
});
