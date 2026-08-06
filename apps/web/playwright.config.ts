import { defineConfig, devices } from '@playwright/test';

// Points at whatever is already running on :3000/:3001 (dev server + local
// backend, e.g. via `node scratchpad/run-backend.mjs` + preview). Does not
// spawn its own servers — this is a manual-verification suite, not CI-yet.
export default defineConfig({
  testDir: './e2e',
  timeout: 30_000,
  fullyParallel: false,
  workers: 1,
  reporter: [['list']],
  use: {
    baseURL: 'http://localhost:3000',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
  },
  projects: [{ name: 'chromium', use: { ...devices['Desktop Chrome'] } }],
});
