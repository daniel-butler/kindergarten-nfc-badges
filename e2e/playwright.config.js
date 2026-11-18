const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const PORT = 8181;
// Fresh registry per run. Set via env so worker processes see the same path.
process.env.BADGE_E2E_CARDS ??= path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'badge-e2e-')), 'cards.json');
const CARDS = process.env.BADGE_E2E_CARDS;

module.exports = defineConfig({
  testDir: './tests',
  // One shared server holds the card registry, so tests run one at a time.
  workers: 1,
  fullyParallel: false,
  retries: process.env.CI ? 1 : 0,
  reporter: process.env.CI ? 'github' : 'list',
  timeout: 30_000,
  use: {
    baseURL: `http://localhost:${PORT}`,
    viewport: { width: 1920, height: 1080 },
    trace: 'off',
  },
  projects: [
    { name: 'chromium', use: { browserName: 'chromium' } },
    // The classroom Mac shows the projector page in Firefox: its live connection is checked there too.
    { name: 'firefox', use: { browserName: 'firefox' }, testMatch: /connection\.spec\.js/ },
  ],
  webServer: {
    command: `cargo run --quiet --manifest-path ../server/Cargo.toml -- --port ${PORT} --cards "${CARDS}"`,
    url: `http://localhost:${PORT}/api/cards`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
