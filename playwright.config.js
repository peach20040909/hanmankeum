import { defineConfig } from '@playwright/test';

export default defineConfig({
  testDir: './e2e',
  testMatch: '**/*.spec.js',
  outputDir: './tools/out/e2e/results',
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 45_000,
  reporter: 'list',
  use: { baseURL: 'http://127.0.0.1:4173', trace: 'retain-on-failure', screenshot: 'only-on-failure' },
  projects: [
    { name: 'desktop', use: { browserName: 'chromium', viewport: { width: 1300, height: 900 } } },
    { name: 'mobile', testIgnore: '**/tools.spec.js', use: { browserName: 'chromium', viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true } },
  ],
  webServer: [
    { command: 'node tools/e2e-server.mjs --demo-fixtures', url: 'http://127.0.0.1:4173', timeout: 30_000, reuseExistingServer: false, env: { PORT: '4173' } },
    { command: 'node tools/e2e-server.mjs --ai-failure', url: 'http://127.0.0.1:4174', timeout: 30_000, reuseExistingServer: false, env: { PORT: '4174' } },
  ],
});
