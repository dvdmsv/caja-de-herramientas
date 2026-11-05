import { defineConfig, devices } from '@playwright/test';

export default defineConfig({
  testDir: 'tests/android',
  timeout: 60_000,
  projects: [
    { name: 'vertical', use: { viewport: { width: 360, height: 780 } } },
    { name: 'horizontal', use: { viewport: { width: 844, height: 390 } } },
  ],
  use: { ...devices['Pixel 5'], baseURL: 'http://127.0.0.1:8765', trace: 'retain-on-failure',
    launchOptions: { executablePath: process.env['PLAYWRIGHT_CHROMIUM_EXECUTABLE'] } },
  webServer: { command: 'python3 scripts/servir-android.py', port: 8765, reuseExistingServer: false },
});
