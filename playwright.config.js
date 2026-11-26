const { defineConfig } = require('@playwright/test');
const fs = require('fs');
// config.js 由部署流程產生（已 gitignore）；本機與 CI 測試沒有時，用範例檔補上，避免 404
if (!fs.existsSync('config.js')) fs.copyFileSync('config.example.js', 'config.js');
module.exports = defineConfig({
  testDir: './tests',
  timeout: 30000,
  webServer: { command: 'npx http-server . -p 4173 -c-1 --silent', url: 'http://127.0.0.1:4173', reuseExistingServer: true },
  use: { baseURL: 'http://127.0.0.1:4173', serviceWorkers: 'block' },
});
