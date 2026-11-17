const os = require('node:os');
const path = require('node:path');
const { defineConfig } = require('@playwright/test');

const PORT = 8181;
const CARDS = path.join(os.tmpdir(), 'badge-e2e-cards.json');

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
  webServer: {
    command: `cargo run --quiet --manifest-path ../server/Cargo.toml -- --port ${PORT} --cards "${CARDS}"`,
    url: `http://localhost:${PORT}/api/cards`,
    timeout: 240_000,
    reuseExistingServer: false,
    stdout: 'ignore',
  },
});
